# Relife Clinic OS Migration Audit

## Authority decision

- Web/PWA (`relife-owner-app`) is the PRIMARY operational UI.
- Telegram (`relife-clinic-os`) is OPTIONAL: notifications, quick actions, fallback, or a thin API client.
- Business rules and write authority converge on the TypeScript backend. Do not create a second business engine in Telegram.
- Google Sheets remains the current operational source of truth during the App-primary migration.
- Supabase remains available for distributed locking and finance shadow/audit. A future Supabase-primary database migration, if desired, is a separate project and must not be coupled to A1-A6.

## Current production-safety facts

- `withMutationLock()` defaults to distributed lock mode (`required`) and uses the Supabase/Postgres lease-lock Edge Function when configured.
- Process-local fallback is only for explicitly enabled compatibility/local/test scenarios.
- Finance production commands already wrap payment, expense, cash and salary mutations with mutation locks.
- `RELIFE_FINANCE_DB_MODE` supports `sheets`, `shadow`, and `supabase`; do not change database authority merely to implement App/Bot feature parity.
- High-risk writes must be online/fail-closed unless a specific workflow has a proven safe replay/idempotency design. Do not blanket-queue finance writes offline.

## Dual-writer risk

Python Telegram and the TypeScript App can currently touch the same operational data. Until each capability is cut over, concurrent independent writers remain a migration risk even when the App itself uses distributed locks.

Priority shared mutation areas include:

| Capability | Operational data | Target authority |
|---|---|---|
| Patient registration | Patient master | TypeScript API/domain |
| Appointment create/status | Appointments | TypeScript API/domain |
| Attendance | Attendance records | TypeScript API/domain |
| Physio/Dental clinical | Assessments/plans/treatments | TypeScript API/domain |
| Payments | `06_Payments` + patient due/session effects | TypeScript finance domain |
| Expenses | `07_Expenses` | TypeScript finance domain |
| Cash movements | `21_Cash_Movement` | TypeScript finance domain |
| Salary | `13_Salary` | TypeScript finance domain |
| Inventory | Inventory + stock log | TypeScript domain/API |
| Corrections/reversals | payment + delete/audit evidence | TypeScript domain/API |

Cutover rule: once a capability is authoritative in TypeScript and parity is verified, Telegram must call that API or become read/notification-only for that capability. Do not leave two independent write implementations active by design.

## Verified App strengths to preserve

Do not rebuild these from scratch merely because the Bot has a similar workflow:

- Appointment workspace already has Schedule, Calendar and Clinicians views.
- Month calendar already shows day-level volume and Physio/Dental split.
- Physio booking already performs bed/machine/capacity validation and safe-slot suggestions.
- Daily Register already supports date selection and department-aware visibility.
- Physio and Dental clinical workspaces already exist separately.
- Finance operations, approvals/history, cash custody, salary, corrections, reports, audit/security and tools already have substantial Web implementations.
- Inventory read/write tooling, Clinical AI, case study, report upload and correction utilities already exist under Tools, though some need first-class UX.

The migration goal is therefore feature-depth convergence and UX consolidation, not a mechanical port of every Telegram screen.

## App-primary convergence sequence

### A1 — Multi-date / multi-time Appointment Booking

Goal: preserve Bot booking convenience while keeping the App's safer booking engine.

Requirements:
- Multi-date selection in the Web UI.
- Up to two time slots per selected date where the workflow permits it.
- Preflight validation for every selected date/time pair before confirmation.
- Preserve existing Physio modality, bed, room, machine and capacity validation.
- Use existing `/api/appointments` as the canonical mutation path; do not create a second booking engine.
- Initial implementation uses independent API calls per slot, ordered deterministically by date/time.
- Each slot gets its own stable request/idempotency key where supported.
- Successful slots remain successful if a later slot fails; no automatic rollback of already-created appointments.
- Final UI must show per-slot success/failure and provide `Retry failed only`.
- Re-check server-side validation on each write; client preflight is advisory, not authority.

### A2 — Calendar / Date-range Reports

Goal: bring Bot's fast temporal querying into the App's richer report screens.

Requirements:
- Today / Yesterday / This Week / This Month / Custom Range shortcuts.
- Calendar-based start/end selection for custom ranges.
- Department scope stays permission-controlled: Physio / Dental / Combined only when allowed.
- Date filters should apply to the existing canonical report calculations; do not duplicate accounting formulas in React.
- Preserve the rule that internal cash transfers are not business expenses.

### A3 — Same-as-last Treatment + Progress/Pain Tracking

Goal: match the Bot's fast daily-treatment entry without weakening clinical auditability.

Requirements:
- `Same as last session` shortcut that copies the prior treatment into an editable draft, never silently saves it.
- Quick edit of exercise/electro/manual/modality/machine choices as appropriate.
- Pain/progress follow-up with sensible stale-data prompts.
- Preserve separate Physio vs Dental clinical workflows.
- Business/clinical write logic remains in TypeScript domain/API modules, not React components.

### A4 — Photo-assisted Patient Registration

Goal: preserve Bot's `Photo/Report` convenience while keeping human confirmation.

Requirements:
- Manual Entry and Scan Prescription/Report entry points.
- Extracted fields populate a reviewable draft only.
- Human review/confirmation is mandatory before patient creation.
- Duplicate checks and department authorization still run through the canonical registration path.
- Dental phone remains optional. Do not silently make it mandatory.

### A5 — Dedicated Inventory Workspace

Goal: promote existing inventory capability from buried Tools UX into a first-class App workflow.

Requirements:
- Stock list, low-stock status, stock movement history.
- Add/use/adjust actions with reason and audit evidence.
- Keep department scope explicit. Do not expose Physio-only clinical inventory semantics as Dental tools without a business rule.
- Reuse existing inventory domain/API behavior instead of creating parallel stock logic.

### A6 — Role-specific Home Workspace

Goal: make the App as fast as Telegram for daily staff work while retaining a single application.

Requirements:
- Reception: patient, appointment, payment, register, cash quick actions.
- Therapist: today's patients, chamber, treatment, clinical shortcuts.
- Dentist: dental patients, appointments, dental clinical shortcuts.
- Owner: finance, approvals, reports, audit/controls.
- RBAC/department checks remain server authoritative; hiding a button is not authorization.

## After A1-A6 — Telegram thin client / optional companion

For each retained Telegram action:

`Telegram transport -> TypeScript API -> shared domain logic -> distributed lock/idempotency -> Sheets + Supabase shadow/audit`

Telegram may retain:
- notifications/reminders,
- inline keyboards and quick shortcuts,
- lightweight fallback actions,
- formatting and transport-specific UX.

Telegram should not retain an independent implementation of migrated business mutations.

## Data authority and Supabase policy

During A1-A6:

`Web/PWA -> TypeScript API/domain -> distributed lock -> Google Sheets operational data -> optional Supabase shadow/audit`

Do not switch to Supabase-primary merely as part of App/Bot parity work. If a Supabase-primary migration is later approved, handle it as a separate controlled database migration with its own schema, backfill, dual-read/write plan, reconciliation, rollback and cutover tests.

## Finance non-negotiables

- Collection source remains payment records; do not count cash transfers as revenue or expense.
- Reception -> Home Treasury/Bank is an internal transfer, not an expense.
- Pending cash handovers are excluded from accepted custody balances until accepted.
- Rejected expenses do not reduce business position.
- Salary fixed commitment and paid/advance history remain distinct.
- Physio and Dental accounting remain department-separated; Combined is a reporting view for authorized users.
- Corrections use reversal/audit semantics rather than silent destructive edits.

## Validation gates for every A-step

Before an A-step is considered complete:

1. Existing behavior is inventoried and reused where possible.
2. RBAC and department isolation tests pass.
3. Relevant concurrency/idempotency tests pass.
4. Retry/double-submit behavior is tested.
5. Failure modes do not silently corrupt Sheets state.
6. `npm run lint`, relevant tests, and `npm run build` pass.
7. No unrelated redesign or schema change is bundled in.
8. No automatic merge; review the PR first.

## Immediate next action

Start with A1. Do not restart a generic PHASE 1 rebuild of screens that already exist. Implement the missing multi-date/multi-time booking convenience on top of the current safe appointment API and validation stack.
