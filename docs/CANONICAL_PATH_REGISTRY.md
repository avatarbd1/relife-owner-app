# Canonical Path Registry

This registry is a discovery gate, not a replacement for source inspection. Search and read the named implementation before changing it.

| Capability | Canonical entry/path | Required permission | Durable authority |
|---|---|---|---|
| Appointment booking | `app/api/appointments/route.ts` → `lib/domain/appointments/capacityBooking.ts` / `lib/webos/reception.ts` | `appointment.create` | Existing Sheets/Supabase appointment contract |
| Attendance/check-in | Existing attendance APIs/domain discovered by repo search; extend them, never add a second register writer | `attendance.self` / `attendance.read_team` | Existing attendance ledger |
| Daily Register | Existing `/register` read workspace; summary UI must not become a new attendance/clinical writer | `register.read` | Existing operational readers |
| Clinical assessment | `app/api/clinical/assessment` | `clinical.write` | Existing clinical writer |
| Clinical plan | `app/api/clinical/plan` | `clinical.write` | Existing clinical writer |
| Treatment/session | `app/api/clinical/session` and its domain path | `clinical.write` | Existing clinical ledger; no `/api/treatment` parallel writer |
| Patient registration | Existing patient API/domain discovered from current `main` | `patient.create` | Existing patient master |
| Payment | Existing finance payment API → `lib/domain/finance/production.ts` / payment writer | `payment.create` | `06_Payments` during current Sheets authority |
| Expense | Existing finance expense/control APIs → canonical finance domain | expense actions from `access.ts` | `07_Expenses` |
| Cash movement | Existing finance/control APIs → canonical cash domain | cash actions from `access.ts` | `21_Cash_Movement` |
| Salary | `/api/finance/salary` → canonical salary writer | `salary.pay` | `13_Salary` |
| Inventory | Existing inventory API/domain on current `main` | `inventory.write` | Existing inventory + log contract |

## Mandatory discovery evidence

Every runtime PR must state:

- migration audit reviewed;
- exact `rg`/repository searches performed;
- existing canonical route/domain/writer found;
- whether authority changes;
- whether a new canonical writer is introduced;
- the Owner-approved issue if a new writer or authority change is genuinely required.

Absence of a capability from this table is not permission to create it. Search first; then update this registry in the same reviewed PR if the canonical architecture legitimately changes.

## Explicit rejected patterns

- New `/api/treatment` writer beside `/api/clinical/session`.
- New appointment engine beside `/api/appointments`.
- New staff check-in store beside existing attendance.
- Process-local `Map`/`Set` as production record storage or idempotency.
- Invented WebActions such as `treatment.write`.
- A second Sheets/Supabase writer for the same user action.
- “Tests pass” presented as proof of merge, deployment, durability, or live verification.
