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

Cutover rule: once a capability is authoritative in TypeScript and parity is verified, Telegram must call that API or become read/notification-only for that capability.

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
