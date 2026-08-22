# Batch 2 Core Operations Audit

Base: guarded `main` at `95e2e34732c04197360f8e809d230118c09b1e9f`.

This audit records only repository evidence. The Python bot source was not
present in the Owner-provided handoff, so Python function parity remains
unverified and no cutover is authorized.

| Capability | Canonical TypeScript path | Verified state |
|---|---|---|
| Daily Register | `/register` readers and `lib/domain/clinical/dailyActivity.ts` | Read-only aggregation; no parallel writer added |
| Attendance | `app/api/attendance/action/route.ts` → `lib/webos/attendanceNormal.ts` / `lib/webos/attendance.ts` | Defect fixed: both writers now share the distributed staff/day mutation lock |
| Appointments | `app/api/appointments/route.ts` → capacity/reception domains | Existing date-scoped distributed lock, duplicate guard and department authorization preserved |
| Patients | `app/api/patients/route.ts` and bulk-import route → `lib/webos/reception.ts` | Existing department-scoped lock and duplicate detection preserved |
| Clinical | `/api/clinical/{assessment,plan,session,dental}` | Existing patient-scoped locks and `clinical.write`; no `/api/treatment` writer |
| Chamber | `app/api/chamber/route.ts` → `lib/domain/chamber/runtime.ts` | Existing distributed runtime lock and active-patient concurrency guard preserved |
| Inventory | `app/api/tools/inventory/route.ts` → `lib/webos/inventory.ts` | Existing item-scoped distributed lock and insufficient-stock rejection preserved |

## Verified defect

Attendance previously used two independent process-local `Map` registries:
one for normal check-in and one for break/check-out actions. Those registries
could not serialize requests across multiple Render instances. Both canonical
writers now use the same durable key:

`attendance:{staffId}:{Dhaka date}`

The existing mutation-lock implementation remains responsible for distributed
lease acquisition and fail-closed production behavior.

## Boundaries

- No new route, writer, action string, storage engine or schema.
- Sheets remains operational authority.
- No Python writer was disabled or changed.
- Exact Python/App parity and authority cutover remain blocked until the Python
  repository is supplied and inspected.
