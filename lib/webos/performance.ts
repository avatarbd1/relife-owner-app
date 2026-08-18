import "server-only";

import { getPayments } from "@/lib/data";
import {
  fetchSheetRanges,
  type Workbook,
} from "@/lib/data/googleSheets";
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

export interface PerformancePointBreakdown {
  sessionPoints: number;
  attendancePoints: number;
  registrationPoints: number;
  paymentPoints: number;
  bookingPoints: number;
  totalPoints: number;
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
  rewardAmount: number;
}

export interface PerformanceEntry {
  staffId: string;
  fullName: string;
  roleLabel: string;
  departmentLabel: string;
  rank: number;
  points: number;
  todayPoints: number;
  metrics: PerformanceMetricSummary;
  pointBreakdown: PerformancePointBreakdown;
  milestones: PerformanceMilestone[];
  pendingRewardPreview: number;
  scoreCoverage: "live" | "partial";
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

function pointsForMetrics(
  identity: WebStaffIdentity,
  metrics: PerformanceMetricSummary
): PerformancePointBreakdown {
  const clinician =
    identity.roles.includes("Therapist") || identity.roles.includes("Dentist");
  const receptionist = identity.roles.includes("Receptionist");

  // Phase 1 only scores signals already verifiable from canonical clinic data.
  // Additional rules from the product spec are deliberately not guessed.
  const sessionPoints = clinician ? metrics.completedSessions : 0;
  const attendancePoints = metrics.onTimeDays;
  const registrationPoints = receptionist ? Math.floor(metrics.registrations / 5) : 0;
  const paymentPoints = receptionist ? Math.floor(metrics.paymentsProcessed / 10) : 0;
  const bookingPoints = receptionist ? Math.floor(metrics.bookingsCreated / 5) : 0;
  return {
    sessionPoints,
    attendancePoints,
    registrationPoints,
    paymentPoints,
    bookingPoints,
    totalPoints:
      sessionPoints +
      attendancePoints +
      registrationPoints +
      paymentPoints +
      bookingPoints,
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
      rewardLabel: "Badge + 2-hour break certificate",
      rewardAmount: 0,
    },
  ];

  if (clinician) {
    milestones.unshift({
      key: "first_session",
      icon: "🎯",
      title: "First Session",
      description: "Complete 1 session",
      progress: Math.min(metrics.completedSessions, 1),
      target: 1,
      unlocked: metrics.completedSessions >= 1,
      rewardLabel: "Badge + 100 XP preview",
      rewardAmount: 0,
    });
    milestones.push(
      {
        key: "golden_hands",
        icon: "🏆",
        title: "Golden Hands",
        description: "Complete 10+ sessions this week",
        progress: Math.min(metrics.completedSessions, 10),
        target: 10,
        unlocked: metrics.completedSessions >= 10,
        rewardLabel: "৳500 reward preview",
        rewardAmount: 500,
      },
      {
        key: "speed_demon",
        icon: "⚡",
        title: "Speed Demon",
        description: "Complete 3 sessions before noon",
        progress: Math.min(metrics.completedBeforeNoon, 3),
        target: 3,
        unlocked: metrics.completedBeforeNoon >= 3,
        rewardLabel: "Coffee voucher preview",
        rewardAmount: 0,
      }
    );
  }

  return milestones;
}

function scoreCoverage(identity: WebStaffIdentity): "live" | "partial" {
  if (
    identity.roles.includes("Therapist") ||
    identity.roles.includes("Dentist") ||
    identity.roles.includes("Receptionist")
  ) {
    return "live";
  }
  return "partial";
}

function buildEntry(
  identity: WebStaffIdentity,
  events: PerformanceEvents,
  weekStart: string,
  weekEnd: string,
  today: string
): PerformanceEntry {
  const metrics = metricsForWindow(identity, events, weekStart, weekEnd);
  const pointBreakdown = pointsForMetrics(identity, metrics);
  const todayMetrics = metricsForWindow(identity, events, today, today);
  const todayPoints = pointsForMetrics(identity, todayMetrics).totalPoints;
  const milestones = milestonesFor(identity, metrics);
  return {
    staffId: identity.staffId,
    fullName: identity.fullName || identity.staffId,
    roleLabel: roleLabel(identity),
    departmentLabel: departmentLabel(identity),
    rank: 0,
    points: pointBreakdown.totalPoints,
    todayPoints,
    metrics,
    pointBreakdown,
    milestones,
    pendingRewardPreview: milestones
      .filter((milestone) => milestone.unlocked)
      .reduce((sum, milestone) => sum + milestone.rewardAmount, 0),
    scoreCoverage: scoreCoverage(identity),
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

function scopeLabelForDepartments(
  departments: Array<"Physio" | "Dental">
): string {
  if (departments.length >= 2) return "Combined";
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
  const [directory, appointments, payments, attendanceSheet, registrations] =
    await Promise.all([
      getWebStaffDirectory(),
      getAppointmentsForContext(context, "combined"),
      getPayments(),
      fetchSheetRanges("physio", ["03_Attendance"]),
      loadRegistrationEvents(departments),
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
      performanceRole(identity).length > 0 &&
      identityVisibleInDepartments(identity, departments)
  );

  const entries = candidates
    .map((identity) => buildEntry(identity, events, week.start, week.end, today))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.metrics.completedSessions !== a.metrics.completedSessions) {
        return b.metrics.completedSessions - a.metrics.completedSessions;
      }
      if (b.metrics.paymentsProcessed !== a.metrics.paymentsProcessed) {
        return b.metrics.paymentsProcessed - a.metrics.paymentsProcessed;
      }
      if (b.metrics.bookingsCreated !== a.metrics.bookingsCreated) {
        return b.metrics.bookingsCreated - a.metrics.bookingsCreated;
      }
      return a.fullName.localeCompare(b.fullName);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const current =
    entries.find((entry) => entry.staffId === context.staffId) ||
    buildEntry(currentIdentity, events, week.start, week.end, today);

  return {
    weekStart: week.start,
    weekEnd: week.end,
    today,
    scopeLabel: scopeLabelForDepartments(departments),
    generatedAt: new Date().toISOString(),
    current,
    leaderboard: canReadLeaderboard ? entries.slice(0, 10) : [current],
    canReadTeam,
    rewardPayoutEnabled: false,
    scoringNote:
      "Phase 1 uses only verified clinic events: completed sessions, on-time attendance, receptionist registrations, payments and bookings. Other spec metrics stay unscored until their source data is wired.",
  };
}
