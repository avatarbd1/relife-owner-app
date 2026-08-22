import "server-only";

import { getPayments } from "@/lib/data";
import {
  fetchSheetRanges,
  type Workbook,
} from "@/lib/data/googleSheets";
import {
  gamificationSupabaseConfigured,
  getGamificationConfig,
  type GamificationConfigSnapshot,
} from "@/lib/data/supabaseGamification";
import {
  parseRoleScoreConfig,
  type RoleScoreConfig,
} from "@/lib/domain/gamification/config";
import {
  calculateNormalizedScore,
  percentOfTarget,
  rankNormalizedScores,
  type GamificationRole,
} from "@/lib/domain/gamification/rules";
import { isGamificationEligibleStaffId } from "@/lib/domain/gamification/monthlyPolicy";
import type { Department } from "@/lib/types";
import {
  assertCanPerform,
  canAccessDepartment,
  canPerform,
  type AccessContext,
  type WebRole,
} from "@/lib/webos/access";
import {
  getAppointmentsForContext,
  todayDhaka,
  type AppointmentRecord,
} from "@/lib/webos/reception";
import {
  getWebStaffDirectory,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";

const PERFORMANCE_ROLES = new Set<WebRole>([
  "Owner",
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
]);

const COMPLETED_STATUSES = new Set(["completed", "done", "session completed"]);

export interface PerformanceMetricSummary {
  completedSessions: number;
  completedBeforeNoon: number;
  onTimeDays: number;
  attendanceDays: number;
  registrations: number;
  paymentsProcessed: number;
  bookingsCreated: number;
}

export interface PerformanceXpBreakdown {
  sessionXp: number;
  attendanceXp: number;
  registrationXp: number;
  paymentXp: number;
  bookingXp: number;
  totalXp: number;
}

export interface PerformanceMilestone {
  key: "first_session" | "right_on_time" | "golden_hands" | "speed_demon";
  icon: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
  rewardLabel: string;
}

export type PerformanceScoreCoverage = "complete" | "partial" | "disabled";

export interface PerformanceEntry {
  staffId: string;
  fullName: string;
  roleLabel: string;
  scoringRole: GamificationRole | null;
  departmentLabel: string;
  rank: number | null;
  normalizedScore: number | null;
  provisionalScore: number | null;
  scoreCoveredWeight: number;
  missingScoreMetrics: string[];
  scoreCoverage: PerformanceScoreCoverage;
  xpEarnedThisWeek: number;
  xpEarnedToday: number;
  metrics: PerformanceMetricSummary;
  xpBreakdown: PerformanceXpBreakdown;
  milestones: PerformanceMilestone[];
}

export interface PerformanceSnapshot {
  weekStart: string;
  weekEnd: string;
  today: string;
  scopeLabel: string;
  generatedAt: string;
  current: PerformanceEntry;
  leaderboard: PerformanceEntry[];
  canReadTeam: boolean;
  rewardPayoutEnabled: false;
  scoringConfigReady: boolean;
  scoringNote: string;
}

type AttendanceEvent = {
  date: string;
  staffId: string;
  lateMinutes: number;
};

type RegistrationEvent = {
  date: string;
  createdBy: string;
  department: "Physio" | "Dental";
};

type PerformanceEvents = {
  appointments: AppointmentRecord[];
  attendance: AttendanceEvent[];
  registrations: RegistrationEvent[];
  payments: Awaited<ReturnType<typeof getPayments>>;
};

type ConfigByDepartment = Map<"Physio" | "Dental", GamificationConfigSnapshot>;

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function dateFromKey(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_PERFORMANCE_DATE");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number): string {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

export function performanceWeekRange(today: string): { start: string; end: string } {
  const date = dateFromKey(today);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(today, mondayOffset);
  return { start, end: addDays(start, 6) };
}

function inRange(value: string, start: string, end: string): boolean {
  const date = String(value || "").trim().slice(0, 10);
  return Boolean(date && date >= start && date <= end);
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map(normalize);
  for (const name of names) {
    const index = normalized.indexOf(normalize(name));
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function allowedDepartments(context: AccessContext): Array<"Physio" | "Dental"> {
  return (["Physio", "Dental"] as const).filter((department) =>
    canAccessDepartment(context, department)
  );
}

function performanceRole(identity: WebStaffIdentity): WebRole[] {
  return identity.roles.filter((role) => PERFORMANCE_ROLES.has(role));
}

function scoringRole(identity: WebStaffIdentity): GamificationRole | null {
  const roles = performanceRole(identity).filter(
    (role): role is GamificationRole =>
      role === "Owner" ||
      role === "Manager" ||
      role === "Receptionist" ||
      role === "Therapist" ||
      role === "Dentist"
  );
  return roles.length === 1 ? roles[0] : null;
}

function roleLabel(identity: WebStaffIdentity): string {
  const roles = performanceRole(identity);
  return roles.length > 0 ? roles.join(" · ") : identity.roles.join(" · ") || "Staff";
}

function departmentLabel(identity: WebStaffIdentity): string {
  if (identity.primaryDepartment && identity.primaryDepartment !== "All") {
    return identity.primaryDepartment;
  }
  const visible = identity.departmentAccess.filter((value) => value !== "All");
  if (visible.length === 1) return visible[0];
  return "All";
}

function identityVisibleInDepartments(
  identity: WebStaffIdentity,
  departments: Array<"Physio" | "Dental">
): boolean {
  if (identity.departmentAccess.includes("All")) return true;
  if (
    identity.primaryDepartment &&
    identity.primaryDepartment !== "All" &&
    departments.includes(identity.primaryDepartment)
  ) {
    return true;
  }
  return identity.departmentAccess.some(
    (department) => department !== "All" && departments.includes(department)
  );
}

function matchesStaff(value: string, identity: WebStaffIdentity): boolean {
  const needle = normalize(value);
  if (!needle) return false;
  const id = normalize(identity.staffId);
  const name = normalize(identity.fullName);
  if (needle === id || needle === name) return true;
  if (id.length >= 3 && needle.includes(id)) return true;
  if (name.length >= 3 && needle.includes(name)) return true;
  return false;
}

function appointmentMinutes(value: string): number {
  const text = String(value || "").trim().toUpperCase();
  let match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (match) {
    let hour = Number(match[1]) % 12;
    if (match[3] === "PM") hour += 12;
    return hour * 60 + Number(match[2]);
  }
  match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return Number.POSITIVE_INFINITY;
}

function parseAttendance(rows: string[][]): AttendanceEvent[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateIdx = headerIndex(headers, "Date");
  const staffIdx = headerIndex(headers, "Staff_ID");
  const lateIdx = headerIndex(headers, "Late_Minutes");
  if (dateIdx < 0 || staffIdx < 0) return [];

  const latestByStaffDate = new Map<string, AttendanceEvent>();
  for (const row of rows.slice(1)) {
    const date = at(row, dateIdx).slice(0, 10);
    const staffId = at(row, staffIdx);
    if (!date || !staffId) continue;
    const lateRaw = Number(at(row, lateIdx) || 0);
    latestByStaffDate.set(`${staffId}:${date}`, {
      date,
      staffId,
      lateMinutes: Number.isFinite(lateRaw) ? Math.max(0, lateRaw) : 0,
    });
  }
  return [...latestByStaffDate.values()];
}

function parseRegistrations(
  rows: string[][],
  department: "Physio" | "Dental"
): RegistrationEvent[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateIdx = headerIndex(headers, "Registration_Date", "Date");
  const createdByIdx = headerIndex(headers, "Created_By", "Provider_ID");
  if (dateIdx < 0 || createdByIdx < 0) return [];
  return rows.slice(1).flatMap((row) => {
    const date = at(row, dateIdx).slice(0, 10);
    const createdBy = at(row, createdByIdx);
    if (!date || !createdBy) return [];
    return [{ date, createdBy, department }];
  });
}

function metricsForWindow(
  identity: WebStaffIdentity,
  events: PerformanceEvents,
  start: string,
  end: string
): PerformanceMetricSummary {
  const completed = events.appointments.filter(
    (appointment) =>
      inRange(appointment.date, start, end) &&
      COMPLETED_STATUSES.has(normalize(appointment.status)) &&
      matchesStaff(appointment.therapist, identity)
  );

  const attendance = events.attendance.filter(
    (item) =>
      inRange(item.date, start, end) &&
      normalize(item.staffId) === normalize(identity.staffId)
  );

  return {
    completedSessions: completed.length,
    completedBeforeNoon: completed.filter(
      (appointment) => appointmentMinutes(appointment.time) < 12 * 60
    ).length,
    onTimeDays: attendance.filter((item) => item.lateMinutes <= 2).length,
    attendanceDays: attendance.length,
    registrations: events.registrations.filter(
      (item) => inRange(item.date, start, end) && matchesStaff(item.createdBy, identity)
    ).length,
    paymentsProcessed: events.payments.filter(
      (payment) => inRange(payment.date, start, end) && matchesStaff(payment.receivedBy, identity)
    ).length,
    bookingsCreated: events.appointments.filter(
      (appointment) =>
        inRange(appointment.date, start, end) &&
        matchesStaff(appointment.receivedBy, identity)
    ).length,
  };
}

function xpForMetrics(
  identity: WebStaffIdentity,
  metrics: PerformanceMetricSummary
): PerformanceXpBreakdown {
  const clinician =
    identity.roles.includes("Therapist") || identity.roles.includes("Dentist");
  const receptionist = identity.roles.includes("Receptionist");

  // These are verified-source XP signals already available in current clinic data.
  // Unsupported v2 XP rules stay absent until their canonical source is wired.
  const sessionXp = clinician ? metrics.completedSessions : 0;
  const attendanceXp = metrics.onTimeDays;
  const registrationXp = receptionist ? Math.floor(metrics.registrations / 5) : 0;
  const paymentXp = receptionist ? Math.floor(metrics.paymentsProcessed / 10) : 0;
  const bookingXp = receptionist ? Math.floor(metrics.bookingsCreated / 5) : 0;
  return {
    sessionXp,
    attendanceXp,
    registrationXp,
    paymentXp,
    bookingXp,
    totalXp: sessionXp + attendanceXp + registrationXp + paymentXp + bookingXp,
  };
}

function milestonesFor(
  identity: WebStaffIdentity,
  metrics: PerformanceMetricSummary
): PerformanceMilestone[] {
  const clinician =
    identity.roles.includes("Therapist") || identity.roles.includes("Dentist");
  const milestones: PerformanceMilestone[] = [
    {
      key: "right_on_time",
      icon: "⏰",
      title: "Right on Time",
      description: "5 on-time attendance days",
      progress: Math.min(metrics.onTimeDays, 5),
      target: 5,
      unlocked: metrics.onTimeDays >= 5,
      rewardLabel: "Recognition milestone",
    },
  ];

  if (clinician) {
    milestones.unshift({
      key: "first_session",
      icon: "🎯",
      title: "First Session",
      description: "Complete 1 verified session",
      progress: Math.min(metrics.completedSessions, 1),
      target: 1,
      unlocked: metrics.completedSessions >= 1,
      rewardLabel: "Recognition milestone",
    });
    milestones.push(
      {
        key: "golden_hands",
        icon: "🏆",
        title: "Golden Hands",
        description: "Complete 10+ verified sessions this week",
        progress: Math.min(metrics.completedSessions, 10),
        target: 10,
        unlocked: metrics.completedSessions >= 10,
        rewardLabel: "Recognition milestone",
      },
      {
        key: "speed_demon",
        icon: "⚡",
        title: "Speed Demon",
        description: "Complete 3 verified sessions before noon",
        progress: Math.min(metrics.completedBeforeNoon, 3),
        target: 3,
        unlocked: metrics.completedBeforeNoon >= 3,
        rewardLabel: "Recognition milestone",
      }
    );
  }

  return milestones;
}

function configForIdentity(
  identity: WebStaffIdentity,
  configs: ConfigByDepartment
): GamificationConfigSnapshot | null {
  if (identity.primaryDepartment === "Physio" || identity.primaryDepartment === "Dental") {
    return configs.get(identity.primaryDepartment) || null;
  }
  const visible = identity.departmentAccess.filter(
    (department): department is "Physio" | "Dental" =>
      department === "Physio" || department === "Dental"
  );
  for (const department of visible) {
    const config = configs.get(department);
    if (config) return config;
  }
  return configs.values().next().value || null;
}

function scoreComponentsFor(
  role: GamificationRole,
  policy: RoleScoreConfig,
  metrics: PerformanceMetricSummary
): Record<string, number | null> {
  const target = (key: string): number | null => {
    const value = policy.targets[key];
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  if (role === "Therapist" || role === "Dentist") {
    const sessionsTarget = target("sessions_per_week");
    const attendanceTarget = target("attendance_days_per_week");
    return {
      productivity:
        sessionsTarget === null
          ? null
          : percentOfTarget(metrics.completedSessions, sessionsTarget),
      attendance:
        attendanceTarget === null
          ? null
          : percentOfTarget(metrics.onTimeDays, attendanceTarget),
      documentation: null,
      quality: null,
      reliability: null,
    };
  }

  if (role === "Receptionist") {
    const workflowTarget = target("workflow_transactions_per_week");
    const attendanceTarget = target("attendance_days_per_week");
    const workflowTotal =
      metrics.registrations + metrics.paymentsProcessed + metrics.bookingsCreated;
    return {
      workflow:
        workflowTarget === null
          ? null
          : percentOfTarget(workflowTotal, workflowTarget),
      cash_accuracy: null,
      appointment_accuracy: null,
      attendance:
        attendanceTarget === null
          ? null
          : percentOfTarget(metrics.onTimeDays, attendanceTarget),
      error_control: null,
    };
  }

  if (role === "Manager") {
    const attendanceTarget = target("attendance_days_per_week");
    return {
      coordination: null,
      incidents: null,
      schedule: null,
      staff_satisfaction: null,
      attendance:
        attendanceTarget === null
          ? null
          : percentOfTarget(metrics.onTimeDays, attendanceTarget),
    };
  }

  return {};
}

function buildEntry(
  identity: WebStaffIdentity,
  events: PerformanceEvents,
  configs: ConfigByDepartment,
  weekStart: string,
  weekEnd: string,
  today: string
): PerformanceEntry {
  const metrics = metricsForWindow(identity, events, weekStart, weekEnd);
  const xpBreakdown = xpForMetrics(identity, metrics);
  const todayMetrics = metricsForWindow(identity, events, today, today);
  const xpEarnedToday = xpForMetrics(identity, todayMetrics).totalXp;
  const role = scoringRole(identity);
  const configSnapshot = configForIdentity(identity, configs);
  const policy =
    role && configSnapshot
      ? parseRoleScoreConfig(configSnapshot.configs, role)
      : null;

  let normalizedScore: number | null = null;
  let provisionalScore: number | null = null;
  let scoreCoveredWeight = 0;
  let missingScoreMetrics: string[] = [];
  let scoreCoverage: PerformanceScoreCoverage = "disabled";

  if (role && policy) {
    const score = calculateNormalizedScore(
      policy,
      scoreComponentsFor(role, policy, metrics)
    );
    normalizedScore = score.officialScore;
    provisionalScore = score.provisionalScore;
    scoreCoveredWeight = score.coveredWeight;
    missingScoreMetrics = score.missingMetrics;
    scoreCoverage = score.complete ? "complete" : "partial";
  } else if (role && !policy) {
    missingScoreMetrics = ["role_config_or_verified_sources"];
  } else {
    missingScoreMetrics = ["single_scoring_role_required"];
  }

  return {
    staffId: identity.staffId,
    fullName: identity.fullName || identity.staffId,
    roleLabel: roleLabel(identity),
    scoringRole: role,
    departmentLabel: departmentLabel(identity),
    rank: null,
    normalizedScore,
    provisionalScore,
    scoreCoveredWeight,
    missingScoreMetrics,
    scoreCoverage,
    xpEarnedThisWeek: xpBreakdown.totalXp,
    xpEarnedToday,
    metrics,
    xpBreakdown,
    milestones: milestonesFor(identity, metrics),
  };
}

async function loadRegistrationEvents(
  departments: Array<"Physio" | "Dental">
): Promise<RegistrationEvent[]> {
  const snapshots = await Promise.all(
    departments.map(async (department) => {
      const workbook: Workbook = department === "Dental" ? "dental" : "physio";
      const snapshot = await fetchSheetRanges(workbook, ["02_Patients"]);
      return parseRegistrations(snapshot["02_Patients"] || [], department);
    })
  );
  return snapshots.flat();
}

async function loadGamificationConfigs(
  departments: Array<"Physio" | "Dental">
): Promise<ConfigByDepartment> {
  const configs: ConfigByDepartment = new Map();
  if (!gamificationSupabaseConfigured()) return configs;

  const loaded = await Promise.all(
    departments.map(async (department) => {
      try {
        return [department, await getGamificationConfig(department)] as const;
      } catch (error) {
        console.error(`Gamification config unavailable for ${department}`, error);
        return [department, null] as const;
      }
    })
  );
  for (const [department, config] of loaded) {
    if (config) configs.set(department, config);
  }
  return configs;
}

function scopeLabelForDepartments(
  departments: Array<"Physio" | "Dental">
): string {
  if (departments.length >= 2) return "All departments";
  return departments[0] || "No department";
}

export async function getPerformanceSnapshot(
  context: AccessContext
): Promise<PerformanceSnapshot> {
  assertCanPerform(context, "performance.read_self", context.primaryDepartment);
  const departments = allowedDepartments(context);
  if (departments.length === 0) throw new Error("PERFORMANCE_SCOPE_EMPTY");

  const today = todayDhaka();
  const week = performanceWeekRange(today);
  const [
    directory,
    appointments,
    payments,
    attendanceSheet,
    registrations,
    scoreConfigs,
  ] = await Promise.all([
    getWebStaffDirectory(),
    getAppointmentsForContext(context, "combined"),
    getPayments(),
    fetchSheetRanges("physio", ["03_Attendance"]),
    loadRegistrationEvents(departments),
    loadGamificationConfigs(departments),
  ]);

  const currentIdentity = directory.find(
    (identity) => identity.staffId === context.staffId && identity.status === "Active"
  );
  if (!currentIdentity) throw new Error("STAFF_NOT_FOUND");

  const allowed = new Set<Department>(departments);
  const events: PerformanceEvents = {
    appointments: appointments.filter((item) => allowed.has(item.department)),
    attendance: parseAttendance(attendanceSheet["03_Attendance"] || []),
    registrations,
    payments: payments.filter(
      (payment) => payment.department !== "All" && allowed.has(payment.department)
    ),
  };

  const canReadLeaderboard = canPerform(
    context,
    "performance.read_leaderboard",
    context.primaryDepartment
  );
  const canReadTeam = canPerform(
    context,
    "performance.read_team",
    context.primaryDepartment
  );

  const candidates = directory.filter(
    (identity) =>
      identity.status === "Active" &&
      isGamificationEligibleStaffId(identity.staffId) &&
      performanceRole(identity).length > 0 &&
      identityVisibleInDepartments(identity, departments)
  );

  const rawEntries = candidates.map((identity) =>
    buildEntry(identity, events, scoreConfigs, week.start, week.end, today)
  );
  const ranks = rankNormalizedScores(
    rawEntries.map((entry) => ({
      staffId: entry.staffId,
      normalizedScore: entry.normalizedScore,
    }))
  );
  const rankByStaff = new Map(ranks.map((entry) => [entry.staffId, entry.rank]));
  const entries = rawEntries.map((entry) => ({
    ...entry,
    rank: rankByStaff.get(entry.staffId) ?? null,
  }));
  const officialLeaderboard = entries
    .filter(
      (entry): entry is PerformanceEntry & { normalizedScore: number; rank: number } =>
        entry.normalizedScore !== null && entry.rank !== null
    )
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (b.normalizedScore !== a.normalizedScore) {
        return b.normalizedScore - a.normalizedScore;
      }
      return a.fullName.localeCompare(b.fullName);
    });

  const current =
    entries.find((entry) => entry.staffId === context.staffId) ||
    buildEntry(currentIdentity, events, scoreConfigs, week.start, week.end, today);

  const scoringConfigReady = scoreConfigs.size > 0;
  return {
    weekStart: week.start,
    weekEnd: week.end,
    today,
    scopeLabel: scopeLabelForDepartments(departments),
    generatedAt: new Date().toISOString(),
    current,
    leaderboard: canReadLeaderboard ? officialLeaderboard.slice(0, 10) : [],
    canReadTeam,
    rewardPayoutEnabled: false,
    scoringConfigReady,
    scoringNote: scoringConfigReady
      ? "Official Leaderboard uses only complete role-normalized 0-100 scores. Missing documentation, quality, cash-accuracy or other required sources remain partial and receive no rank; verified clinic activity is shown separately as XP progress."
      : "Gamification configuration is unavailable, so no normalized score or official rank is produced. Verified clinic activity remains visible without inventing scoring rules.",
  };
}
