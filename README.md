# Relife Owner Web App

Mobile-first Web/PWA operational system for Relife Clinic (Physio + Dental).
Per `CLAUDE.md`, this app is the **primary** operational system for all
clinic staff and the Owner. The Telegram bot (`relife-clinic-os`) is an
optional notification/convenience layer during migration, not the source of
business logic.

## Architecture and authority

- **Data authority**: Google Sheets remains the operational source of truth
  during the current migration. Supabase provides distributed locking and a
  finance shadow/audit ledger where configured. See `MIGRATION_AUDIT.md` for
  the authority decision and dual-writer risk matrix.
- **Business logic**: lives in the existing `lib/domain/*` and `lib/webos/*`
  service boundaries, not in UI components.
- **Mutation safety**: production App writers use the existing durable
  `withMutationLock()` path where required. Replayable workflows use
  request-identity or business-key deduplication where implemented; remaining
  App/Bot parity gaps are recorded in `MIGRATION_AUDIT.md` rather than hidden.
- **Department isolation**: Physio and Dental data, staff, and finance are
  scoped and reconciled independently; a combined Owner view aggregates
  without collapsing the two into a fabricated third department.
- **Roles**: Owner, Manager, Receptionist, Therapist, Dentist,
  Dental_Assistant, Auditor — defined in `lib/webos/access.ts`
  (`ROLE_ACTIONS`).

For the controlled development workflow (Owner goal → Codex prompt → Claude
artifact → Codex verification → Draft PR → CI → Owner merge), see
`docs/RELIFE_ENGINE_LITE.md`. For the canonical route/domain/writer for any
capability, see `docs/CANONICAL_PATH_REGISTRY.md` — search and read the
existing implementation before adding anything new.

## What's implemented

The app covers real operational routes under `app/(dashboard)/*` and
`app/api/*`, including: Home, Daily register, Attendance/check-in,
Appointments, Chamber (Physio live operations), Clinical
(assessment/plan/session, Dental), Patients (registration, bulk import),
Inventory, Finance (payment, expense, cash movement, salary, approvals,
history/audit), Corrections, Reports, Workforce (shift scheduling, leave
management), and Settings/Security. This is not a sample-data prototype; the
data layer (`lib/data/*`) reads/writes the configured Google Sheets
workbooks, and finance calculations flow through `lib/domain/finance/*` and
`lib/calculations.ts`.

### Workforce (Batch 4A)

Shift scheduling and leave management (`lib/domain/workforce/*`,
`app/api/workforce/*`, `/workforce`) are implementation-complete and
covered by automated tests, per Owner-approved issue #153. **The two
required Google Sheets tabs (`Staff_Shifts`, `Leave_Requests`) have not been
provisioned in any live workbook** — every workforce read/write fails
closed with an explicit "not provisioned" error until that separately
controlled operation happens. See `MIGRATION_AUDIT.md` for the full
authority note and pending items.

### Finance (Batch 1)

The finance domain distinguishes, with dedicated canonical readers/writers
and regression tests under `tests/*finance*`, `tests/p0Finance*`, and
`tests/legacyPayrollReconciliation.test.ts`:

- Billed Services vs. Collections vs. Outstanding vs. Cash Handover as
  separate accounting meanings (Cash Handover is custody, never revenue or
  expense).
- Cash Position (Reception / Home Treasury / Bank) using the 09:00
  Asia/Dhaka business-day rule, carrying forward across day and month
  boundaries.
- Fixed overhead commitment vs. actual paid expense, kept distinct.
- Salary fixed commitment vs. salary paid vs. advance vs. legacy/unknown
  payment type vs. remaining due/overpayment, kept distinct.
- Verified legacy cleaner-payroll expense rows reconciled by matching an
  exact active-staff commitment (department + role + salary amount), so a
  cleaner's salary is not counted as both a salary commitment and a
  variable clinic expense. Ambiguous or conflicting rows are left as
  ordinary expenses and surfaced as a conflict count rather than guessed.

Batch 1 finance work (PRs #141, #145, #148) is implementation-complete and
covered by automated tests on `main`. **Live reconciliation against the
production Google Sheets and a production smoke check have not been
performed from this environment** — see `MIGRATION_AUDIT.md` for what
remains pending before any "production verified" claim.

## Project structure (current)

```
app/
  (dashboard)/        Owner/staff routes (protected)
    home/  daily/  register/  appointments/  chamber/
    patients/  finance/  expenses/  salary/  payments/
    inventory/  reports/  performance/  corrections/
    audit/  security/  settings/  more/  menu/  tools/
  api/                 route handlers — canonical writers per
                       docs/CANONICAL_PATH_REGISTRY.md
lib/
  domain/              business logic (finance/, appointments/, chamber/,
                       clinical/, patients/, inventory/, ...)
  webos/               access control, mutation locks, staff directory
  data/                Google Sheets read/write layer
  calculations.ts      finance aggregation entry points used by the UI
docs/                  migration/canonical-path/engine documentation
tests/                 automated regression tests (`node --test`)
```

## Running locally

```bash
npm install
cp .env.local.example .env.local   # then edit required environment values
npm run dev
```

## Verification

```bash
npm test          # automated test suite
npm run lint       # eslint
npm run build      # production build
```

Deployment, live Google Sheets connectivity, and production credentials are
managed outside this repository's local development environment; this
README does not claim a specific hosting URL or live deployment status.
See `docs/RELIFE_ENGINE_LITE.md` for how a change moves from artifact to
Draft PR to Owner-approved merge and deploy.
