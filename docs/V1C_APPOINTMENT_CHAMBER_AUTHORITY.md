# V1-C: Appointment + Chamber Authority Consolidation

## Overview

V1-C establishes canonical authorization and concurrency models for Appointment creation/updates and Chamber runtime operations. This document is the source of truth for authorization boundaries, lock semantics, and cross-department isolation.

## Scope

This phase consolidates:
1. **Appointment Authorization** — role + department-scoped access for create/read/update
2. **Chamber Authorization** — Physio-only operational domain with role-scoped permissions
3. **Appointment Authority Consolidation** — One canonical Physio booking command
4. **Appointment Concurrency** — Date-scoped distributed locking
5. **Chamber Concurrency** — Per-session/per-appointment runtime serialization
6. **Cross-Department Isolation** — No bypass via direct ID/API/query tampering

## Authorization Matrix

### Appointment Permissions

| Role | appointment.read | appointment.create | appointment.update |
|------|------------------|--------------------|-------------------|
| Owner | All | All | All |
| Manager | Scoped | Scoped | Scoped |
| Receptionist | Scoped | Scoped | Scoped |
| Therapist | Scoped | Scoped | ✗ |
| Dentist | Scoped | Scoped | ✗ |
| Dental_Assistant | ✗ | ✗ | ✗ |
| Auditor | ✗ | ✗ | ✗ |
| System Admin | ✗ | ✗ | ✗ |

**Notes:**
- "Scoped" = department-scoped to staff's explicit departmentAccess mapping
- "All" = accessible to all mapped departments (typically All)
- Therapist/Dentist cannot update appointments (role has no appointment.update permission)
- Temporary Dental_Temporary_Data_Entry exception does NOT grant appointment permissions
- Missing department mapping fails closed

### Chamber Permissions

Chamber is a **Physio-only operational domain**. No Dental patient enters chamber runtime.

| Role | chamber.read | chamber.receive | chamber.run |
|------|--------------|-----------------|------------|
| Owner | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ |
| Receptionist | ✓ | ✓ | ✗ |
| Therapist | ✓ | ✗ | ✓ |
| Dentist | ✗ | ✗ | ✗ |
| Dental_Assistant | ✗ | ✗ | ✗ |
| Auditor | ✗ | ✗ | ✗ |
| System Admin | ✗ | ✗ | ✗ |

**Notes:**
- chamber.read allows reading chamber board, comms, resource status
- chamber.receive allows check-in/receiving patients into chamber queue
- chamber.run allows starting sessions, advancing steps, completing treatment, assigning therapists, station preferences
- Dentist has no chamber permissions — no Dental clinical pathway through Physio chamber

## Appointment Authority Consolidation

### Physio Booking Command

Current state: Two separate Physio booking paths exist during migration.

**Canonical Command:** `createUnifiedPhysioBooking()`
- Entry point: `/api/appointments` (POST)
- Alternative entry point: `/api/chamber/schedule` (POST, action=create)
- Lock: `appointment-create:${date}` (date-scoped, serializes bookings on same date)
- Dependency: `createSupabaseValidatedBooking()` for Supabase mode or Sheets append for sheet mode
- Concurrency guarantee: Same-date slot conflicts prevented, duplicate requests blocked via requestId

**Compatibility aliases (deprecated, same handler):**
- `/api/chamber/fixed-hour/route.ts` → chamberSchedulePost()
- `/api/chamber/hourly-booking/route.ts` → chamberSchedulePost()

**Dental Booking Command:** `createAppointment()`
- Entry point: `/api/appointments` (POST)
- Lock: `appointment-create:${date}` (same lock as Physio, date-scoped)
- No separate chamber scheduler (Dental does not use Physio chamber resource pool)
- Authorization: assertCanPerform(context, "appointment.create", patient.department)

**Consolidation Invariant:** All Physio booking must route through one command. No second Physio writer should evolve independently. All paths must share the same validation, concurrency, and authorization boundaries.

## Appointment Concurrency Hardening

### Lock Scope: Date-Scoped Per-Department

**Lock key:** `appointment-create:${date}`

**Critical section covers:**
1. Therapist availability check
2. Resource/bed conflict detection
3. Gender-room rule validation
4. Duplicate appointment detection
5. Machine capacity checks
6. Gender-required validation
7. ID generation (idempotent via requestId)
8. Final booking write (Sheets append or Supabase insert)

**Properties:**
- Different dates are independent (can proceed in parallel)
- Same-date concurrent creates are serialized
- requestId deduplication prevents duplicate submissions
- Fail-closed in production mode (required=true)
- Lease-based semantics with heartbeat renewal ~10s, 30s deadline

### Appointment Status/Update Mutations

Appointment status updates (reschedule, cancel, no-show) must also be audited for read-check-write races. Current implementation calls `updateUnifiedAppointmentStatus()` which validates department match via patient record fetch before proceeding. Lock scope: per-appointment (if future optimization needed).

## Chamber Concurrency Hardening

### Lock Scopes (V1-C implementation)

| Action | Lock Key | Serialization Scope |
|--------|----------|-------------------|
| receive | `chamber-receive` | Global (prevent same patient in two queues) |
| assign_therapist | `chamber-therapist:${appointmentId}` | Per-appointment (assignment race) |
| prefer_station | `chamber-station:${appointmentId}` | Per-appointment (station preference race) |
| start | `chamber-session:${sessionId}` | Per-session (start state transition) |
| step | `chamber-session:${sessionId}` | Per-session (step advance/modality change) |
| complete | `chamber-session:${sessionId}` | Per-session (completion/note capture) |

**Implementation location:** `/app/api/chamber/route.ts` POST handler wraps each action with withMutationLock().

### Prevented Scenarios

1. **Same patient received twice** — `chamber-receive` global lock
2. **Two concurrent receives making same patient active twice** — Global receive lock checks snapshot before proceeding
3. **Concurrent therapist assignment races** — Per-appointment lock serializes assign_therapist
4. **Station preference write races** — Per-appointment lock serializes prefer_station
5. **Session state machine races** — Per-session lock serializes start/step/complete
6. **Concurrent step advances with stale state reads** — Per-session lock linearizes step sequence
7. **Duplicate session completion** — Per-session lock prevents double-complete

### Booking Time ≠ Actual Treatment Start

Hard V1-C invariant:

- **Appointment.time** = Planned booking time only (stored in appointment record)
- **Actual treatment start** = When session.status transitions from Waiting → In Treatment
- Chamber runtime state (waiting/in-treatment/completed) is maintained independently from booking timestamp
- Runtime treatment_started_at is populated when start action is executed, not from appointment.time
- Shifting/rescheduling in queue does not change completed_at retroactively

## Cross-Department Isolation

### Appointment Isolation

**Enforcement:** patientForContext validates patient department + assertCanPerform checks access

1. Physio staff (Manager/Receptionist/Therapist with Physio scope) cannot:
   - Call POST /api/appointments with Dental patient ID
   - Get appointment.read/create/update for Dental appointments
   
2. Dental staff (Manager/Receptionist/Dentist with Dental scope) cannot:
   - Call POST /api/appointments with Physio patient ID
   - Get appointment.read/create/update for Physio appointments

3. API-level validation:
   ```typescript
   const patient = await getPatientForContext(context, String(body.patientId || ""));
   if (!patient || patient.department === "All") {
     return NextResponse.json({ ok: false, error: "PATIENT_NOT_FOUND" }, { status: 404 });
   }
   assertCanPerform(context, "appointment.create", patient.department);
   ```

### Chamber Isolation

Chamber is Physio-only. Cross-department enforcement:

1. Dental patients must never enter chamber runtime
2. Dental appointment IDs must never appear in chamber.queue or chamber.sessions
3. Dental staff cannot call POST /api/chamber with any action
4. Authorization: assertCanPerform(context, "chamber.receive" | "chamber.run", "Physio")

## API Endpoints

### Appointment Creation

**POST /api/appointments**

```json
{
  "patientId": "PHY-2024-0001",
  "date": "2024-01-15",
  "time": "10:00",
  "therapist": "Fatima",
  "remarks": "Follow-up session",
  "modalities": ["TENS", "Manual"],
  "requestId": "req-unique-abc123xyz"
}
```

**Authorization gates:**
1. API boundary: assertCanPerform(context, "appointment.create", patient.department)
2. Domain layer: validatePhysioBooking() / createAppointment() re-checks

**Concurrency:** `appointment-create:${date}` lock

**Responses:**
- 200 OK: appointmentId, validation details
- 400: INVALID_DATE, INVALID_TIME, INVALID_THERAPIST, INVALID_REQUEST_ID
- 403: ACCESS_DENIED
- 404: PATIENT_NOT_FOUND
- 409: APPOINTMENT_DUPLICATE, APPOINTMENT_CONFLICT, APPOINTMENT_CAPACITY

### Appointment Status Update

**POST /api/appointments/status**

**Authorization:** assertCanPerform(context, "appointment.update", department)

**Responses:**
- 200 OK: Updated status
- 400: INVALID_DEPARTMENT, INVALID_APPOINTMENT_STATUS, DEPARTMENT_MISMATCH
- 403: ACCESS_DENIED
- 404: APPOINTMENT_NOT_FOUND

### Chamber Receive

**POST /api/chamber** (action=receive)

```json
{
  "action": "receive",
  "appointmentId": "APT-2024-0001"
}
```

**Authorization:** assertCanPerform(context, "chamber.receive", "Physio")

**Concurrency:** `chamber-receive` global lock (prevent same-patient double-receive)

### Chamber Runtime Actions

**POST /api/chamber** (action=assign_therapist|prefer_station|start|step|complete)

**Authorization:** assertCanPerform(context, "chamber.run", "Physio") for all runtime actions

**Concurrency:**
- assign_therapist/prefer_station: `chamber-therapist:${appointmentId}` / `chamber-station:${appointmentId}`
- start/step/complete: `chamber-session:${sessionId}`

## Temporary Dental Exception Scope (V1-B+)

The `Dental_Temporary_Data_Entry` clinicalWriteScope **does NOT** extend appointment or chamber permissions:

- ✓ Grants: clinical.read, clinical.write in Dental only
- ✗ Does NOT grant: appointment.create, appointment.read, appointment.update
- ✗ Does NOT grant: chamber.receive, chamber.run

Dentist/Receptionist Dental appointment creation depends on explicit role permissions only.

## Testing

### Authorization Tests
File: `tests/v1cAppointmentChamberAuthority.test.ts`
- 126+ test cases covering role + department combinations
- Authorization matrix validation
- Cross-department isolation verification
- Temporary exception scope verification

### Regression Tests
- V1-B access control unchanged
- Patient Hub appointment action authorized correctly
- Dental blank-phone behavior unchanged
- Finance integrity unchanged

## Rollback Procedure

If V1-C causes production issues:

1. Revert commits from v1-c-appointment-chamber-authority branch
2. Restore previous authorization at domain-layer only (keep locks for safety)
3. Remove API-level assertCanPerform() gates if causing false positives
4. Restore deprecated aliases behavior if needed
5. Monitor for stale session locks (chamber-receive, chamber-session:*) in cache

## Metrics to Monitor

1. **Appointment creation latency** (date-scoped lock contention)
2. **Chamber mutation latency** (per-session lock contention)
3. **Authorization failures** (ACCESS_DENIED on appointments, chamber)
4. **Concurrency failures** (APPOINTMENT_DUPLICATE, CHAMBER_PATIENT_ALREADY_ACTIVE)
5. **Lock acquisition timeouts** (fail-closed in production mode)
