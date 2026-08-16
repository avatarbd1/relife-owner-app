# Relife Clinic OS Architecture

## Goal

Relife Clinic OS is a **modular monolith**. One Next.js application owns the UI and server APIs, while each business domain has one authoritative rule layer and one persistence boundary.

The architecture rule is:

> one user action → one command/query → one domain rule → one repository/transaction → one audit event

No screen, API route, or compatibility page may re-implement business rules that already belong to a domain service.

## Domain ownership

| Domain | Owns | Must not own |
|---|---|---|
| Patients | patient identity, department visibility, profile updates, reports/files references | appointment allocation, payment arithmetic |
| Appointments | date/time scheduling intent, clinician assignment, appointment lifecycle | bed/machine runtime logic |
| Chamber | Physio bed allocation, gender-room safety, machine reservations, treatment timeline, runtime session | finance, patient master truth |
| Finance | payments, expenses, cash custody movement, salary, approvals, finance calculations | clinical/chamber rules |
| Clinical | assessment, treatment plan, treatment notes, clinical reports | payment/cash decisions |
| Staff | staff master, roles, department mapping, attendance identity | domain-specific permissions logic |
| Security/Admin | authentication, access policy, audit browsing, system configuration | operational business calculations |

## Layering

```text
app/ + components/          UI and route composition
        ↓
app/api/                    HTTP boundary only
        ↓
lib/domain/<domain>/        business rules, commands, queries
        ↓
lib/repositories/           persistence contracts/adapters
        ↓
Supabase / Google Sheets / Drive
        ↓
audit event
```

### Dependency rule

- UI may call APIs or read application queries.
- API routes authorize input and call domain commands.
- Domain code must not depend on React/components.
- Business rules must not be copied into page components.
- Persistence adapters must not decide business policy.
- Compatibility routes may redirect, but must not own a second implementation.

## Current migration state

The repository predates this contract. During consolidation, old modules remain operational until their replacement is tested. New feature work should not introduce another parallel implementation.

### Finance

Target module:

```text
lib/domain/finance/
  policy.ts
  commands.ts
  queries.ts
  repository.ts
  types.ts
```

`policy.ts` is the first central source of truth. Fixed non-salary overhead and salary eligibility must be defined there, not in pages or multiple services.

Legacy modules such as `lib/controls.ts`, `lib/webos/financeOps.ts`, and `lib/webos/expenseRequests.ts` will be consolidated behind one Finance repository/command layer before removal.

### Chamber

Target module:

```text
lib/domain/chamber/
  rules.ts
  scheduler.ts
  runtime.ts
  commands.ts
  repository.ts
  types.ts
```

The final Chamber scheduler must be the only implementation of:

- one-hour bed occupancy
- dynamic room gender lock
- patient duplicate prevention
- therapist overlap
- machine overlap
- treatment-plan requirements
- fixed modality durations
- booking conflict alternatives

`appointmentScheduling.ts`, `chamberHourlyBooking.ts`, and `chamberFixedHour.ts` are migration-era implementations and must converge rather than continue to grow independently.

## Data ownership

### Primary operational database

Supabase Postgres is the target source of truth for high-frequency transactional domains, beginning with Chamber and then Finance.

### Google Sheets

Google Sheets remains a legacy/reporting/admin-compatible data source during migration. It must not be treated as an unlimited real-time database. Reads must be batched/cached and writes must use schema-safe helpers.

### Google Drive

Drive owns report/media file storage. Database records store references/metadata, not duplicate file bytes.

## Production data safety

Production must **fail closed** when live clinic data is unavailable.

- Never silently replace failed production reads with seed/demo data.
- A stale last-known-good cache may be served only when explicitly designed and time-bounded.
- If neither live nor approved stale data is available, show a data-unavailable state.
- Financial or clinical writes are never silently queued offline.

## Finance invariants

These rules require automated regression tests:

1. Reception → Home Treasury is a cash movement, not an expense.
2. Pending/rejected cash movements do not affect current custody position.
3. Rejected/pending expenses do not count as paid business cost.
4. Household withdrawal is not business liability.
5. Fixed overhead is not counted again as variable expense.
6. Staff represented in salary master must not be duplicated as fixed overhead.
7. Owner is excluded from salary commitment.
8. Salary paid/advance is derived from salary ledger, not inferred from cash movement.

## Chamber invariants

The consolidated Chamber engine must regression-test:

1. Requested bed is authoritative; never silently move a booking.
2. Bed occupancy overlap is rejected.
3. Same-room opposite-gender overlap is rejected.
4. Same patient overlapping active appointment is rejected.
5. Same therapist overlapping active appointment is rejected.
6. Same machine overlapping reservation is rejected.
7. Machine duration comes from the resource policy.
8. A fixed 60-minute session may not truncate a selected clinical modality.
9. Runtime state survives refresh and is server-derived, not timer-only client state.
10. Completed/cancelled sessions release resources.

## Navigation ownership

Target Owner bottom navigation:

```text
Home | Patients | Chamber | Finance | More
```

- Home: owner control tower and attention queue.
- Patients: patient master, clinical entry points, appointments/files/payments links.
- Chamber: Schedule | Live | Team.
- Finance: Overview | Payments | Expenses | Cash | Salary | History | Approvals.
- More: Reports | Security | Audit | Settings | App/PWA diagnostics.

`/operations`, `/menu`, `/expenses`, and other compatibility routes may remain temporarily as redirects only.

## Pull request rules

Before merge:

1. Build must pass.
2. Domain invariant tests must pass.
3. Lint must pass once the baseline is clean.
4. New business rules require tests.
5. A change may not introduce a second writer for an existing entity.
6. Schema changes require a migration and backward-compatible rollout plan.
7. Finance and clinical changes must preserve audit evidence.

## Migration order

1. Architecture foundation + regression tests.
2. Finance consolidation.
3. Chamber consolidation.
4. Navigation/Home simplification.
5. Tools/legacy route cleanup.
6. Typed system configuration.
7. Supabase transactional cutover.
8. Backup, monitoring, E2E tests and rollback tooling.
