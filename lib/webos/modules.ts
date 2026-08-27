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

/**
 * Runtime status, not a historical rollout checklist. Keep this list aligned
 * with routes that are actually wired and protected in the current Web/PWA.
 * "partial" means the module exists but a broader Telegram/admin parity gate
 * is intentionally still open.
 */
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
    state: "live",
    source: "WebAuthn/passkey + live 08_Staff identity",
    parityGate: "Active staff authenticate with live mapped identity",
  },
  {
    id: "authorization",
    label: "Role + department authorization",
    phase: "W1",
    state: "live",
    source: "Web role actions + Staff_Department_Access",
    parityGate: "Server reads/writes fail closed by role and department",
  },
  {
    id: "patients",
    label: "Patient registration and files",
    phase: "W2",
    state: "live",
    source: "Patient registration/search/update/history",
    parityGate: "Duplicate-safe create/update and scoped direct-ID lookup",
  },
  {
    id: "appointments",
    label: "Appointments and today schedule",
    phase: "W2",
    state: "live",
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
    label: "Attendance",
    phase: "W4",
    state: "live",
    source: "Web attendance state workflow",
    parityGate: "Duplicate guards, break state, checkout and audit verified",
  },
  {
    id: "daily-register",
    label: "Daily register",
    phase: "W4",
    state: "live",
    source: "Daily register and operational reports",
    parityGate: "Role-scoped operational parity with amount visibility separated",
  },
  {
    id: "physio-clinical",
    label: "Physio clinical",
    phase: "W5",
    state: "live",
    source: "Assessment/plan/treatment/history",
    parityGate: "Clinical writes plus assignment/cross-cover authorization and audit",
  },
  {
    id: "dental-clinical",
    label: "Dental clinical",
    phase: "W6",
    state: "live",
    source: "Dental clinical records",
    parityGate: "Dentist workflow plus explicit temporary Dental-entry policy",
  },
  {
    id: "clinical-ai",
    label: "Clinical AI and case study",
    phase: "W7",
    state: "partial",
    source: "Web clinical AI + case study",
    parityGate: "Minimum-necessary scoped data and external-AI privacy checks",
  },
  {
    id: "inventory",
    label: "Inventory",
    phase: "W8",
    state: "live",
    source: "Inventory + inventory audit workflows",
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
