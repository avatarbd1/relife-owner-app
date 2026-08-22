# Batch 2: Core Operations Canonical Inventory

**Purpose**: Map exact current canonical paths for each core capability to establish baseline for parity audit and defect testing.

---

## A. Daily Register

**Capability**: Staff check-in/out, patient counter, session counter, real-time board

### Canonical paths
- **Reader**: `/app/(dashboard)/daily/page.tsx`
- **Daily Activity**: `lib/domain/clinical/dailyActivity.ts` → `getDailyClinicalActivity()`
- **Math**: `lib/domain/finance/dailyRegisterMath.ts`
- **No dedicated writer** — reads from attendance + clinical + appointments

### Permission
- `register.read` (via ROLE_ACTIONS in lib/webos/access.ts)

### Authority
- Existing attendance ledger (read-only for this capability)
- Existing clinical session records
- Appointment status (existing)

### Mutation lock
- None required (read-only)

### Idempotency
- N/A

### Audit
- All underlying data changes audited separately (attendance, clinical, appointments)

---

## B. Attendance / Check-in / Check-out

**Capability**: Staff attendance tracking, check-in/out timestamps, location validation

### Canonical paths
- **Route**: `app/api/attendance/action/route.ts`
- **Domain**: Attendance domain (referenced in route)
- **Location validation**: `03_Bot/attendance_location.py` (Python) or equivalent validation logic

### Permission
- `attendance.self` (for own check-in)
- `attendance.read_team` (for team view)

### Authority
- Existing attendance ledger in Sheets
- Location validation rules

### Mutation lock
- Distributed lock required for concurrent check-in prevention
- Current implementation in `app/api/attendance/action/route.ts` must verify

### Idempotency
- Require requestId to prevent duplicate check-ins on retry

### Audit
- 20_Data_Audit (verified via route implementation)

### Defects to verify
- Duplicate check-in prevention (race condition with concurrent requests)
- Team read scope enforcement
- GPS validation (if required)

---

## C. Appointments

**Capability**: Create, view, status update, capacity booking, conflict detection

### Canonical paths
- **Create/capacity booking**: `app/api/appointments/route.ts` + `lib/domain/appointments/capacityBooking.ts`
- **Status update**: `app/api/appointments/status/route.ts` + `lib/domain/appointments/status.ts`
- **Validation**: `app/api/appointments/validate/route.ts`
- **Hourly capacity**: `lib/domain/appointments/therapistCapacity.ts`
- **Reader**: `lib/domain/appointments/read.ts`

### Permission
- `appointment.create` (from ROLE_ACTIONS)

### Authority
- Existing `04_Appointments` sheet (Sheets authority during app-primary migration)
- Existing appointment contract (Physio modality/bed/capacity, Dental behavior)

### Mutation lock
- `withMutationLock()` around capacity booking (key: `capacity-booking:${date}`)
- Verify lock duration is sufficient for multi-slot requests

### Idempotency
- `requestId` passed through to identify retried requests
- Verify deduplication works across partial failures

### Audit
- Audit rows in `20_Data_Audit` via `auditRow()` in capacityBooking.ts

### Defects to verify
- Double-booking same patient/appointment in same time slot
- Physio hourly capacity vs bed/modality conflicts
- Dental appointment capacity enforcement
- Cross-department patient access (Physio patient cannot book Dental appointment)
- Retry idempotency (same requestId, different amounts?)
- Conflict detection accuracy

---

## D. Patients

**Capability**: Register, view, bulk import, duplicate detection, department isolation

### Canonical paths
- **Create**: `app/api/patients/route.ts`
- **Read**: `app/api/patients/[patientId]/route.ts`
- **Bulk import**: `app/api/patients/bulk-import/route.ts`
- **Domain**: Patient registration logic (referenced in routes)

### Permission
- `patient.create` (from ROLE_ACTIONS)

### Authority
- Existing `02_Patients` sheet
- Patient master (Sheets authority during migration)

### Mutation lock
- Distributed lock required around patient creation to detect duplicates
- Current implementation in route must verify

### Idempotency
- Duplicate detection via existing patient ID search
- Verify idempotency on retry with same patient data

### Audit
- 20_Data_Audit (verify audit row creation in patient writer)

### Defects to verify
- Duplicate patient detection (same name/phone)
- Dental patient phone optional (Physio requires?)
- Cross-department patient access (Receptionist sees only own department patients)
- Bulk import duplicate handling
- Patient ID allocation (no collisions)
- Department scoping in patient list

---

## E. Clinical Assessment / Plan / Session (Treatment)

**Capability**: Assessment entry, treatment plan, session/treatment record, photo + note support

### Canonical paths
- **Assessment**: `app/api/clinical/assessment/route.ts`
- **Plan**: `app/api/clinical/plan/route.ts`
- **Session/Treatment**: `app/api/clinical/session/route.ts`
- **Dental clinical**: `app/api/clinical/dental/route.ts`
- **Domain**: Clinical logic referenced in routes

### Permission
- `clinical.write` (from ROLE_ACTIONS)

### Authority
- Existing clinical ledger (Sheets)
- Physio/Dental clinical separation enforced

### Mutation lock
- Verify `withMutationLock()` on session/treatment writes
- Key: `clinical-session:${sessionId}` or similar

### Idempotency
- Verify requestId on treatment writes to prevent duplicate entries on retry

### Audit
- 20_Data_Audit (verify audit trail for assessment/plan/session)

### Defects to verify
- Same session written twice (race condition)
- Duplicate treatment entries
- Cross-department clinical access (Physio therapist cannot access Dental sessions)
- Clinical AI features reuse existing readers (no new writer path)
- Photo upload doesn't bypass clinical entry validation
- Template application doesn't duplicate entries

### No parallel `/api/treatment` writer
- Confirmed: no separate endpoint; only `/api/clinical/session` is canonical

---

## F. Chamber (Physio-only)

**Capability**: Hourly bed/machine board, patient flow (receive → waiting → in treatment → complete), concurrent patient capacity

### Canonical paths
- **Board/schedule**: `app/api/chamber/route.ts` + `lib/domain/chamber/board.ts`
- **Receive patient**: `app/api/chamber/route.ts` (POST action)
- **Runtime/session**: `lib/domain/chamber/runtime.ts`
- **Scheduler**: `lib/domain/chamber/scheduler.ts`
- **Patient concurrency check**: `lib/domain/chamber/patientConcurrency.ts`
- **Hourly booking**: `app/api/chamber/hourly-booking/route.ts`

### Permission
- `chamber.read` (board)
- `chamber.receive` (move patient to "waiting")
- `chamber.run` (transition patient through states)

### Authority
- Existing appointment status (from 04_Appointments)
- Existing clinical session ledger (from clinical domain)
- Chamber configuration (beds, machines, hours)

### Mutation lock
- `withMutationLock()` on receive and state transitions
- Key: `chamber-runtime:${todayDhaka()}`
- Verify lock covers multi-patient operations

### Idempotency
- Verify chamber state transitions are idempotent

### Audit
- Verify audit trail for patient movement

### Defects to verify
- Same patient with concurrent active sessions in different chambers
- Patient moved to "in treatment" multiple times (race condition)
- Appointment status and clinical session completion mismatch
- Bed/machine concurrency violations
- Male/Female room separation (Physio gender tracking)

---

## G. Inventory

**Capability**: Physio-only stock tracking, movement log, low-stock alerts, insufficient-stock rejection, reorder points

### Canonical paths
- **Route**: `app/api/tools/inventory/route.ts`
- **Domain**: Inventory domain logic

### Permission
- `inventory.write` (from ROLE_ACTIONS)

### Authority
- Existing inventory ledger (Sheets)
- Stock movement log

### Mutation lock
- Distributed lock required on stock deduction
- Key: `inventory:${itemId}` or similar
- Verify lock prevents double-deduction on retry

### Idempotency
- Verify requestId on stock movement to prevent duplicates

### Audit
- Stock movement log (verify append-only audit of all changes)

### Defects to verify
- Insufficient stock rejection works (can't consume more than available)
- Stock movement retry doesn't double-deduct
- Low-stock alerts trigger correctly
- Movement history is accurate

---

## H. Python Bot / TypeScript App Writer Parity

### Current status: Both active, parallel writers

#### 02_Patients (Patient Registration)
- **Python**: `03_Bot/bot.py` → patient registration flow
- **TypeScript**: `app/api/patients/route.ts` + patient writer
- **Status**: Both ACTIVE during migration
- **Cutover path**: TypeScript API becomes canonical after parity verification

#### 04_Appointments (Appointment Booking)
- **Python**: `03_Bot/bot.py` → appointment creation flow  
- **TypeScript**: `app/api/appointments/route.ts` + capacity booking
- **Status**: Both ACTIVE
- **Cutover path**: TypeScript API becomes canonical

#### Attendance
- **Python**: `03_Bot/bot.py` + attendance_location.py
- **TypeScript**: `app/api/attendance/action/route.ts`
- **Status**: Both ACTIVE
- **Cutover path**: TypeScript API becomes canonical

#### Clinical/Treatment/Session
- **Python**: `03_Bot/bot.py` + clinical_ai.py
- **TypeScript**: `app/api/clinical/{assessment,plan,session,dental}/route.ts`
- **Status**: Both ACTIVE
- **Cutover path**: TypeScript API becomes canonical

#### Inventory
- **Python**: Unknown (needs inspection)
- **TypeScript**: `app/api/tools/inventory/route.ts`
- **Status**: Likely TypeScript-only
- **Cutover path**: Verify no Python parallel writer

---

## I. Verified Defects to Test

### 1. Duplicate Check-in Prevention
- **Test**: Same staff, same timestamp, concurrent requests → only one succeeds
- **Mechanism**: Distributed lock on staffId + date

### 2. Double Appointment Booking
- **Test**: Same patient, same time slot, concurrent requests → only one succeeds
- **Mechanism**: Capacity booking lock + idempotency

### 3. Concurrent Active Chamber Sessions
- **Test**: Same patient cannot have 2 active (non-terminal) sessions in different chambers on same day
- **Mechanism**: `patientConcurrency.ts` check before receive

### 4. Appointment Retry Idempotency
- **Test**: Same requestId, retry after network failure → same result, no duplicate
- **Mechanism**: Verify requestId handling in appointment create

### 5. Cross-Department Access
- **Test**: Physio therapist cannot create/view Dental patient appointments
- **Test**: Dental dentist cannot access Physio clinical records
- **Mechanism**: Server-side department scope enforcement (not UI hiding)

### 6. Bulk Import Duplicate Detection
- **Test**: Import CSV with duplicate patient names → warning or dedup
- **Mechanism**: Existing duplicate detection logic

### 7. Dental Phone Optional
- **Test**: Dental patient registration without phone → succeeds; Physio requires phone → fails
- **Mechanism**: Optional phone field enforced by role/department

### 8. Treatment/Session Duplicate Writes
- **Test**: Same clinical session written twice (retry) → only one ledger entry
- **Mechanism**: Distributed lock on session + idempotency

### 9. Inventory Insufficient Stock Rejection
- **Test**: Try to consume more stock than available → rejection with clear message
- **Mechanism**: Stock check before mutation

### 10. Map/Set Usage Check
- **Test**: Verify no in-memory Map/Set used as production record storage
- **Test**: Map/Set only for transient deduplication (read-only operations)
- **Mechanism**: Code inspection + architecture

---

## Summary

**Total canonical routes**: 10+ API routes  
**Total domain modules**: 15+ TypeScript domain files  
**Python parallel writers**: 5+ (patients, appointments, attendance, clinical, potentially inventory)  
**Mutation locks required**: 6+ (appointments, patient registration, attendance, chamber, inventory, clinical)  
**Tests to add**: 10+ behavioral tests covering defects above

**Status**: Inventory complete. Implementation phase begins with defect testing.
