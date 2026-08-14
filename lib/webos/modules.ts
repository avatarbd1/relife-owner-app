export type MigrationState =
  | "live"
  | "partial"
  | "foundation"
  | "not_migrated"
  | "retired";

export type MigrationPhase =
  | "W0"
  | "W1"
  | "W2"
  | "W3"
  | "W4"
  | "W5"
  | "W6"
  | "W7"
  | "W8"
  | "W9";

export interface WebOsModule {
  id: string;
  label: string;
  phase: MigrationPhase;
  state: MigrationState;
  source: string;
  parityGate: string;
}

export const WEB_OS_MODULES: readonly WebOsModule[] = [
  {
    id: "owner-dashboard",
    label: "Owner dashboard",
    phase: "W0",
    state: "live",
    source: "Owner finance/report/control workflows",
    parityGate: "Production owner calculations and controlled writes reconciled",
  },
  {
    id: "staff-auth",
    label: "Staff authentication",
    phase: "W1",
    state: "foundation",
    source: "Telegram staff identity + 08_Staff",
    parityGate: "Every active staff role can authenticate with mapped identity",
  },
  {
    id: "authorization",
    label: "Role + department authorization",
    phase: "W1",
    state: "foundation",
    source: "roles.py + department-access-final-spec",
    parityGate: "All server reads/writes fail closed by role and department",
  },
  {
    id: "patients",
    label: "Patient registration and files",
    phase: "W2",
    state: "partial",
    source: "Patient registration/search/history",
    parityGate: "Duplicate-safe create/update and scoped direct-ID lookup",
  },
  {
    id: "appointments",
    label: "Appointments and today schedule",
    phase: "W2",
    state: "not_migrated",
    source: "Appointment/today schedule workflows",
    parityGate: "Collision-safe create/update and department-scoped schedule",
  },
  {
    id: "payments",
    label: "Billing and payments",
    phase: "W3",
    state: "partial",
    source: "06_Payments + payment bot workflow",
    parityGate: "Create/receipt/due/void flow audited without destructive deletion",
  },
  {
    id: "expenses",
    label: "Expense lifecycle",
    phase: "W3",
    state: "partial",
    source: "07_Expenses",
    parityGate: "Request/approve/pay/reject lifecycle preserves custody and audit",
  },
  {
    id: "cash-custody",
    label: "Cash custody",
    phase: "W3",
    state: "partial",
    source: "21_Cash_Movement",
    parityGate: "Request/accept/reconcile balances match production bot",
  },
  {
    id: "salary",
    label: "Salary",
    phase: "W3",
    state: "partial",
    source: "08_Staff + 13_Salary",
    parityGate: "Commitment/advance/payment/history reconciled",
  },
  {
    id: "attendance",
    label: "Attendance and location",
    phase: "W4",
    state: "not_migrated",
    source: "Attendance/location bot workflow",
    parityGate: "Location check, duplicate guards and break state verified",
  },
  {
    id: "daily-register",
    label: "Daily register",
    phase: "W4",
    state: "partial",
    source: "Daily register and operational reports",
    parityGate: "Role-scoped operational parity",
  },
  {
    id: "physio-clinical",
    label: "Physio clinical",
    phase: "W5",
    state: "not_migrated",
    source: "Assessment/plan/treatment/history",
    parityGate: "Append-only notes plus assignment/cross-cover authorization",
  },
  {
    id: "dental-clinical",
    label: "Dental clinical",
    phase: "W6",
    state: "not_migrated",
    source: "Dental clinical records",
    parityGate: "Dentist workflow plus approved Dental Assistant allowlist",
  },
  {
    id: "clinical-ai",
    label: "Clinical AI and case study",
    phase: "W7",
    state: "not_migrated",
    source: "clinical_ai.py + case_study_ai.py",
    parityGate: "Minimum-necessary scoped data and external-AI privacy checks",
  },
  {
    id: "inventory",
    label: "Inventory",
    phase: "W8",
    state: "not_migrated",
    source: "Inventory workflows",
    parityGate: "Stock mutations and audit history verified",
  },
  {
    id: "admin",
    label: "Settings and administration",
    phase: "W8",
    state: "partial",
    source: "Settings/staff/admin workflows",
    parityGate: "Controlled staff/access/configuration management",
  },
  {
    id: "telegram",
    label: "Telegram transport",
    phase: "W9",
    state: "live",
    source: "python-telegram-bot runtime",
    parityGate: "All required operational modules are web-primary",
  },
] as const;

export function modulesForPhase(phase: MigrationPhase): readonly WebOsModule[] {
  return WEB_OS_MODULES.filter((module) => module.phase === phase);
}

export function migrationSummary(): Record<MigrationState, number> {
  return WEB_OS_MODULES.reduce<Record<MigrationState, number>>(
    (summary, module) => {
      summary[module.state] += 1;
      return summary;
    },
    { live: 0, partial: 0, foundation: 0, not_migrated: 0, retired: 0 }
  );
}
