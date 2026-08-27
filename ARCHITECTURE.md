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
| Appointments | date/time booking intent, optional clinician assignment, booking-time gender/capacity safety, appointment lifecycle | live bed allocation, machine exclusivity, treatment runtime |
| Chamber | live Physio bed/room allocation, runtime gender safety, machine runtime, treatment flow and session state | booking-time machine reservation, finance, patient master truth |
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
- Compatibility routes may redirect/delegate, but must not own a second implementation.

## Current migration state

The repository predates this contract. During consolidation, old modules remain operational only where required for backward compatibility until their replacement is tested. New feature work must not introduce another parallel implementation.

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

### Appointments / Chamber split

Physio booking and live Chamber operation are deliberately separate workflows.

Canonical booking authority:

```text
lib/domain/appointments/capacityBooking.ts
```

Booking rules:

- Physio planning window is 60 minutes with an operational tolerance of ±5 minutes.
- Booking hard-blocks only automatic unsafe gender/room-capacity conflicts and overlapping duplicate-patient bookings.
- General beds are not pre-assigned at booking time.
- Therapist assignment is optional; therapist overlap may be advisory but must not block booking.
- Machine modalities are expected demand only; booking must not create machine reservations or exact machine timelines.
- Traction is machine demand with a 20-minute expected-use reminder, not a pre-assigned patient bed.
- Reception must not have to resolve therapist workload, machine availability, treatment sequencing, or runtime duration to save an appointment.

Current live-operation boundaries:

```text
lib/domain/chamber/runtime.ts     # receive/start/complete general session state
lib/webos/machineRuntime.ts       # actual machine start/finish/exclusivity (migration-era)
```

`lib/domain/chamber/runtime.ts` is the domain boundary for the general Chamber session. Actual machine operations are still implemented by the migration-era `lib/webos/machineRuntime.ts` behind `/api/chamber/machines`; this remains post-booking operational logic and should later move behind the Chamber domain boundary without changing the booking contract.

Live-operation rules:

- Reception marks the patient Arrived/received.
- General bed allocation happens only when treatment actually starts.
- Live gender-compatible room capacity is enforced at treatment start.
- Therapist/Owner/Manager starts and completes general treatment under access policy.
- Authorized Physio operating staff start/finish actual machine use.
- Actual machine use is exclusive and server-derived.
- Machine timers are reminders; Finish remains explicit and auditable.
- Treatment cannot complete while a machine is still running.

Migration-era booking modules such as `lib/webos/chamberFixedHour.ts`, `lib/webos/appointmentScheduling.ts`, and the old fixed-bed/Supabase booking scheduler must not be active booking writers. Compatibility APIs must delegate to `capacityBooking.ts` and ignore legacy requested-bed/machine-timeline inputs. They may remain temporarily for cached/old clients, but must not define booking policy.

## Data ownership

### Primary operational database

Supabase Postgres is the target source of truth for high-frequency transactional domains, beginning with Chamber runtime and then Finance.

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

## Physio booking invariants

The booking engine must regression-test:

1. Missing patient gender blocks Physio booking.
2. Unsafe opposite-gender room/capacity combinations block booking automatically.
3. More than available general-treatment capacity for an hour blocks booking automatically.
4. Same patient overlapping active appointment is rejected.
5. Therapist overlap does not block booking.
6. Machine demand/overlap does not block booking and creates no machine reservation.
7. No general bed is assigned during booking.
8. No treatment timeline is created during booking.
9. Traction remains expected machine demand, not a fixed booking bed.
10. Booking remains 60 minutes with ±5 minute operational tolerance.

## Chamber live-operation invariants

The live Chamber engine must regression-test:

1. General bed is chosen only when treatment actually starts.
2. Live same-room opposite-gender occupancy is rejected.
3. An occupied physical bed cannot be started for a second patient.
4. Actual physical machine use is exclusive.
5. Traction may run while the patient is waiting.
6. Starting traction after general treatment releases the general bed immediately.
7. Runtime state survives refresh and is server-derived, not timer-only client state.
8. Machine timers are reminders and require explicit Finish.
9. Treatment cannot complete while a machine is still running.
10. Completed/cancelled sessions release live resources.

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
3. Booking/Chamber separation + Chamber runtime consolidation.
4. Navigation/Home simplification.
5. Tools/legacy route cleanup.
6. Typed system configuration.
7. Supabase transactional cutover.
8. Backup, monitoring, E2E tests and rollback tooling.
