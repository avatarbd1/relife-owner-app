# Relife Clinic OS Migration Audit

## Authority decision

- Web/PWA (`relife-owner-app`) is the PRIMARY operational UI.
- Telegram (`relife-clinic-os`) is OPTIONAL: notifications, quick actions, fallback, or a thin API client.
- Business rules and write authority converge on the TypeScript backend. Do not create a second business engine in Telegram or in parallel Web pages.
- Google Sheets remains the current operational source of truth during the App-primary migration.
- Supabase remains available for distributed locking and finance shadow/audit. A future Supabase-primary database migration, if desired, is a separate controlled project.

## Current production-safety facts

- `withMutationLock()` defaults to distributed lock mode (`required`) and uses the Supabase/Postgres lease-lock Edge Function when configured.
- Process-local fallback is only for explicitly enabled compatibility/local/test scenarios.
- Finance production commands wrap payment, expense, cash and salary mutations with mutation locks and audited domain logic.
- `RELIFE_FINANCE_DB_MODE` supports `sheets`, `shadow`, and `supabase`; App/Bot feature parity must not silently change database authority.
- High-risk writes are online/fail-closed unless a workflow has a separately proven replay/idempotency design. Finance writes are not blanket-queued offline.

## Dual-writer risk

Python Telegram and the TypeScript App can still touch overlapping operational data. Until each capability is cut over, independent writers remain a migration risk even when the App itself uses distributed locks.

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
| Shift scheduling | `Staff_Shifts` (new, issue #153) | TypeScript domain/API — no Python writer exists |
| Leave management | `Leave_Requests` (new, issue #153) | TypeScript domain/API — no Python writer exists |

Cutover rule: once a capability is authoritative in TypeScript and parity is verified, Telegram must call that API or become read/notification-only for that capability.

## Batch 2 verified Bot/App writer parity

Evidence reviewed against Owner App `ee1c5857` and Python Bot `49f7f054` on
2026-08-22. The Python call sites and writer bodies were inspected directly;
this is not a cutover authorization.

The Bot's `async_runtime.run_sheets_write()` uses an in-process
`asyncio.Lock` per clinic. It serializes writes inside one Bot process, but it
does not coordinate with the App's Supabase-backed distributed mutation lock,
another Bot instance, or a direct Sheets writer. Therefore every active pair
below remains a cross-process dual-writer risk.

| Capability | TypeScript canonical path | Active Python writer | Verified parity state |
|---|---|---|---|
| Patient registration | patient API -> `registerPatient` | `sheets.add_patient` | Bot allocates the next ID and appends under only its local lock; no request marker or cross-App lock. |
| Appointment booking | appointments API -> capacity/reception writers | `sheets.add_appointment` | Bot allocates resources and appends under only its local lock; no request marker or cross-App lock. |
| Attendance | attendance API -> normal/action writers | `sheets.attendance_check_in` and break/check-out writers | Bot checks the staff/day business key, but only its local lock protects the read/write. App uses the durable shared staff/day lock. |
| Physio/Dental treatment | clinical APIs -> canonical clinical writers | `sheets.add_treatment_note` / `add_treatment_plan` | Bot rejects a repeated plan/session business key in some flows, but treatment append and plan-session increment are separate writes. App Physio sessions use a stable `SESSIONREQ` marker and one Sheets batch for treatment + plan count; Dental uses `DENTALREQ`. |
| Payments | finance payment API/domain | `sheets.record_payment_transaction` | Bot has `REQ:<Telegram update_id>` replay protection and a local tenant lock. App uses its own request identity plus distributed patient-scoped mutation lock. The two marker/lock systems do not coordinate. |
| Salary | finance salary API/domain | `sheets.add_salary_payment_checked` | Bot re-reads due before append but has no request marker and only its local lock. |
| Expenses | finance expense/control APIs/domain | `sheets.add_expense` / shared-expense flow | Bot validates workflow fields but has no request marker and only its local lock. |
| Cash movement | finance cash/control APIs/domain | `sheets.add_cash_movement` | Bot creates a pending movement without a request marker and uses only its local lock. |
| Inventory | inventory API/domain | `sheets.adjust_inventory_stock` | Bot read-modify-writes under only its local lock, clamps shortages to zero, and writes the stock log separately. App uses an item-scoped distributed lock, rejects insufficient stock, and batches stock/log/audit. |

Batch 2 also verified that the App service worker queues no mutations: it
intercepts `GET` requests only, so unsafe offline replay is not an additional
writer. No Python writer was disabled and no authority was changed in this
batch. The safe next migration step is capability-by-capability parity tests,
then converting each retained Telegram action into a thin TypeScript API
client before disabling the corresponding Python business writer.

## Batch 4A — Shift Scheduling + Leave Management (new capability, issue #153)

First new Phase 1A workforce domain. Confirmed by repository search (`rg -liE
"shift.?schedul|staff_shift|leave_request"`) that no canonical Shift or Leave
domain, writer, schema, or route existed on `main` before this batch — this
is additive, not a migration of existing behavior.

**Authority**: TypeScript-only, per issue #153. Two new Google Sheets tabs —
`Staff_Shifts` and `Leave_Requests` — living in the `physio` workbook
alongside `08_Staff` / `Staff_Department_Access` / `20_Data_Audit` (the same
workbook convention `lib/webos/staffManagement.ts` already uses for the
staff master, since staff span both departments and these are staff-master-
adjacent records, not per-department ledgers). No existing sheet/column was
changed. **Live tab provisioning has not been performed** — writers fail
closed with `WORKFORCE_SCHEMA_NOT_PROVISIONED` until the tabs and their
exact headers exist, per issue #153's "implementation and tests must not
create or mutate live sheets" instruction.

**Canonical path**: `lib/domain/workforce/{shifts,leave}.ts` →
`app/api/workforce/{shifts,leave}/**` → `app/(dashboard)/workforce/page.tsx`.
Reuses `getWebStaffDirectory`, `withMutationLock` (distributed, per-row and
per-staff lock keys), the existing Sheets batch-request helpers, and the
`20_Data_Audit` convention — no new persistence mechanism.

**Idempotency**: every mutation carries a stable client `requestId`
(`/^[A-Za-z0-9_-]{8,100}$/`, same pattern as `SESSIONREQ`/`DENTALREQ`/`WEBREQ`
elsewhere). The create marker remains immutable in the dedicated `Request_ID`
column; update/publish/cancel/decision markers are retained in their atomic
`20_Data_Audit.After_Value` payloads. This preserves retry recognition even
after a later transition. Reusing a request ID for a different actor/action/
entity fails closed.

**Truth boundaries preserved**: Shift = planned work, Leave =
requested/approved absence, Attendance = actual presence, Salary = finance
truth, Performance rewards/claims = incentive truth
(`lib/webos/performanceRewards.ts`'s `two_hour_early_leave` /
`priority_weekly_off` / `half_day_family_time` reward kinds are Supabase-
backed gamification perk claims, not this Leave_Requests workflow). Workforce
mutations never touch attendance, salary, rewards, appointments, clinical,
inventory, or patient records — verified by structural test
(`tests/workforceWriters.test.ts`).

**Python parity**: explicitly none. No Python writer exists for shift
scheduling or leave management anywhere in `relife-clinic-os` (this is a new
capability, not a migrated one), so there is no dual-writer risk to
reconcile for this batch — the "no Python writer exists" note in the table
above is a fact about the source, not an aspiration.

**RBAC**: seven new narrow `WebAction`s (`shift.read`, `shift.manage`,
`leave.read`, `leave.request`, `leave.decide`, `leave.cancel`,
`leave.cancel_own`) added to
`lib/webos/access.ts`. Owner/Manager manage department shifts and decide
department leave; Receptionist/Therapist/Dentist read only their own
Published shifts and their own leave; Auditor reads Published coverage and
leave status/date summaries only, with `Notes`/`Reason`/`Decision_Note`
redacted and no mutation actions; only Owner can cancel another staff
member's Pending leave; Dental_Assistant/System Admin have none.
Self-decision on one's own leave request is blocked for Manager (only Owner
may decide their own, since no role sits above Owner) — see `REVIEW.md` in
the Batch 4A handoff artifact for the full rationale.

**Pending before "production ready"**: live tab provisioning (separately
controlled operation, not performed here), Render deploy verification, and
an authenticated Android smoke test with synthetic/test-isolated records —
all explicitly out of this artifact's scope per issue #153.

## App-primary convergence status

### A1 — Multi-date / multi-time Appointment Booking — COMPLETE

Merged to `main` in PR #100. The Web UI supports multiple dates and up to two selected time slots per day, preflight validation, Physio modality/bed/machine/capacity checks, stable per-slot request identity, sequential canonical `/api/appointments` writes, partial-result reporting, and retry-failed-only.

### A2 — Calendar / Date-range Reports — COMPLETE

Merged in PR #100. Reports support Today / Yesterday / 7 Days / This Month / Custom range, server-authorized department scope, Dhaka date handling, invalid-range rejection, and actual calendar-day overhead/salary accrual across month boundaries.

### A3 — Same-as-last Treatment + Pain Tracking — COMPLETE

Merged in PR #100. The canonical Physio clinical workspace provides an editable same-as-last draft, pain 0–10, pain trend, and stale pain follow-up while retaining `/api/clinical/session` as the write authority.

### A4 — Photo-assisted Patient Registration — COMPLETE

Merged in PR #100. Camera/upload can produce an AI-assisted registration draft through a server-side vision endpoint. AI extraction cannot create a patient; human review is mandatory and final creation still uses the existing patient API. Dental phone remains optional.

### A5 — Dedicated Inventory — COMPLETE

Merged in PR #100. Inventory is a first-class Physio workspace with stock status, low-stock visibility, movement history, reasoned adjustments, distributed mutation locking, atomic Sheets log/audit writes, and insufficient-stock rejection.

## Review of later prototype branches

The remote branches named `feature/A6-*` through `feature/A9-*` were created from the pre-PR-#100 base. Their numeric labels are legacy prototype branch names and are not the authoritative migration sequence below. Do not merge them directly over current `main`.

### Legacy `feature/A6-daily-register` — REVIEWED / SAFE UX FOLDED FORWARD

Useful idea: surface a compact Daily Register summary inside Daily Operations.

Reviewed implementation rules:
- Keep `/register` as the canonical full register; Daily gets a summary, not a duplicate register engine.
- `clinicalActivity.patients` means patients treated, not new registrations.
- Respect `payment.read_amount`; money is hidden when the role lacks amount visibility.
- Do not subtract Discount from `06_Payments.Amount` again when displaying collected amount.
- Register/inventory summary failures must not take down attendance or clinical Daily Ops.
- Quick actions are rendered from server-authorized capabilities.

### Legacy `feature/A7-expense-cash-approvals` — RAW WRITERS REJECTED

The prototype branch contains TODO/throw actions for expense approval/rejection and cash movement requests. Those files must not be merged.

Current authority already exists on `main`:
- expense request/pay through the canonical finance API/domain,
- cash request through the canonical finance API/domain,
- Owner expense decisions through `/api/control/expense`,
- cash receiver confirmation through `/api/control/cash-movement`,
- PIN, rejection reason, actual-received discrepancy, audit and locking remain enforced by the existing implementation.

Future approval UX improvements must sit on those writers rather than create a new server-action business path.

### Legacy `feature/A8-salary-payment` — MOCK WRITER REJECTED; READ-ONLY REPORT UX ACCEPTED

The prototype `salary/actions.ts` returns a synthetic `SAL-${Date.now()}` result without recording the canonical salary ledger and must never be used.

Reviewed forward-port:
- existing `/api/finance/salary` remains the only salary payment path,
- existing PIN/online/idempotency rules remain unchanged,
- add read-only payroll settlement table,
- add CSV export with spreadsheet-formula injection protection,
- add escaped printable report,
- exports never create or alter salary payments.

### Legacy `feature/A9-treatment-entry` — MOCK ENGINE REJECTED

The prototype contains mock/TODO treatment, AI, case-study and read functions. It must not create a second treatment engine.

Current canonical implementation remains:
- assessment → `/api/clinical/assessment`,
- plan → `/api/clinical/plan`,
- session/treatment → `/api/clinical/session`,
- Physio/Dental clinical separation remains enforced,
- Clinical AI, case-study/report tooling reuse existing App capabilities rather than a parallel `/treatment` writer.

## Next product step — Role-specific Home workspace

This is the next canonical migration/product step (the original A6 in the App-primary plan):

- Reception: patient, appointment, payment, register, cash shortcuts.
- Therapist: today's patients, Chamber, treatment and clinical shortcuts.
- Dentist: Dental patients, appointments and Dental clinical shortcuts.
- Owner: finance, approvals, reports, audit/controls.
- RBAC/department checks remain server authoritative; hiding a button is never authorization.

## After App parity — Telegram thin client / optional companion

For each retained Telegram action:

`Telegram transport -> TypeScript API -> shared domain logic -> distributed lock/idempotency -> Sheets + Supabase shadow/audit`

Telegram may retain notifications, inline keyboards, quick shortcuts and lightweight fallback transport. It should not retain an independent implementation of migrated business mutations.

## Finance non-negotiables

- Collection source remains payment records; internal cash transfers are neither revenue nor expense.
- Reception -> Home Treasury/Bank is an internal transfer, not an expense.
- Pending cash handovers do not affect accepted custody balances until accepted.
- Rejected expenses do not reduce business position.
- Salary fixed commitment and paid/advance history remain distinct.
- Physio and Dental accounting remain department-separated; Combined is a reporting view for authorized users.
- Corrections use reversal/audit semantics rather than silent destructive edits.

## Validation gate

Before any follow-up is merged:

1. Reuse existing authority instead of creating parallel business logic.
2. RBAC and department isolation remain server-enforced.
3. Relevant concurrency/idempotency behavior is preserved.
4. Failure modes do not silently corrupt Sheets state.
5. `npm run lint`, the full test suite, and `npm run build` pass.
6. No unrelated Sheets schema or Supabase authority change is bundled in.
7. Merge only after exact-head CI review.
