# V1-D: Final Product Authority & Hardening

## Overview

V1-D consolidates all previous authority & concurrency hardening (V1-A, V1-B, V1-C) into a single source-of-truth document. This is the final production authority specification.

**Key Invariants:**
- All business writers are canonical and non-redundant
- All cross-department access fails closed
- All mutations are serialized by distributed locks
- All role-based access is department-scoped
- All authorization happens at API + domain boundaries
- No security-related feature has UI-only enforcement

---

## Authority Boundaries

### 1. Patient Authority

**Canonical writer:** lib/webos/reception.ts (create/update)

**Authorization matrix:**

| Role | read | create | update |
|------|------|--------|--------|
| Owner | All | All | All |
| Manager | Scoped | Scoped | Scoped |
| Receptionist | Scoped | Scoped | Scoped |
| Therapist | Scoped | - | - |
| Dentist | Scoped | - | - |
| Dental_Assistant | - | - | - |
| Auditor | - | - | - |
| System Admin | - | - | - |

**Scoped = department-restricted to staff's explicit departmentAccess**

**Enforcement:**
- API: assertCanPerform(context, "patient.create"|"patient.read"|"patient.update", patient.department)
- Domain: getPatientForContext() filters by department before returning
- Cross-department: Direct patient ID lookup filtered by staff department access
- UI: Patients nav only visible when role has patient.read

**Failure scenarios prevented:**
- Physio staff cannot see/create/edit Dental patients
- Dental staff cannot see/create/edit Physio patients
- Missing department access returns 404, not 403 (permission model)
- Patient with department="All" never appears in patient.read/create/update scopes

---

### 2. Appointment Authority

**Canonical writers:**
- Physio: createUnifiedPhysioBooking() (V1-C consolidation)
  - Entry points: /api/appointments, /api/chamber/schedule, /api/chamber/fixed-hour*, /api/chamber/hourly-booking*
  - *compatibility aliases only
- Dental: createAppointment() (separate logic)
  - Entry point: /api/appointments
- Status: updateUnifiedAppointmentStatus() with per-appointment lock

**Authorization matrix:**

| Role | read | create | update |
|------|------|--------|--------|
| Owner | All | All | All |
| Manager | Scoped | Scoped | Scoped |
| Receptionist | Scoped | Scoped | Scoped |
| Therapist | Scoped | Scoped* | - |
| Dentist | Scoped | Scoped* | - |
| Dental_Assistant | - | - | - |
| Auditor | - | - | - |
| System Admin | - | - | - |

*Therapist/Dentist can create appointments for their assigned patients only (conditions.assignedToCurrentStaff)

**Concurrency:**
- Appointment creation: appointment-create:${date} (date-scoped, serializes same-date bookings)
- Appointment status: appointment-update:${appointmentId} (per-appointment, prevents concurrent status races)

**Enforcement:**
- API: assertCanPerform(context, "appointment.create"|"update", patient.department)
- Domain: validateUnifiedPhysioBooking() / validateAppointment() re-check authorization
- Duplicate prevention: requestId deduplication within lock
- Conflict detection: Therapist capacity, bed availability, gender room rules all within critical section

**Failure scenarios prevented:**
- Physio staff cannot create Dental appointments
- Dental staff cannot create Physio appointments
- Therapist/Dentist cannot create appointments for unassigned patients
- Concurrent same-date bookings compete for serialization
- Concurrent status updates race properly serialized
- Duplicate requestId submissions don't create second appointment
- Status changes before department validation completes (locked)

---

### 3. Chamber Authority

**Canonical writers:** lib/domain/chamber/runtime.ts (all mutations)

**Chamber is Physio-only. No Dental pathway through chamber.**

**Authorization matrix (Physio department only):**

| Role | read | receive | run |
|------|------|---------|-----|
| Owner | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ |
| Receptionist | ✓ | ✓ | - |
| Therapist | ✓ | - | ✓ |
| Dentist | ✗ | ✗ | ✗ |
| Dental_Assistant | ✗ | ✗ | ✗ |
| Auditor | - | - | - |
| System Admin | - | - | - |

**chamber.read:** Reading board, messages, resource status  
**chamber.receive:** Check-in patients into queue  
**chamber.run:** Start sessions, advance steps, assign therapists, complete treatment  

**Concurrency (V1-C):**

| Action | Lock key | Scope |
|--------|----------|-------|
| receive | chamber-receive | Global (prevent same patient double-check-in) |
| assign_therapist | chamber-therapist:${appointmentId} | Per-appointment |
| prefer_station | chamber-station:${appointmentId} | Per-appointment |
| start | chamber-session:${sessionId} | Per-session |
| step | chamber-session:${sessionId} | Per-session |
| complete | chamber-session:${sessionId} | Per-session |

**Enforcement:**
- API: assertCanPerform(context, "chamber.receive"|"chamber.run", "Physio")
- Domain: Each action wrapped with withMutationLock() before domain call
- Isolation: Dental appointment IDs must never appear in chamber.queue or chamber.sessions

**Failure scenarios prevented:**
- Dental staff cannot receive/run chamber mutations
- Dental patient cannot enter chamber queue
- Same patient double-checked-in (global lock)
- Concurrent session state machine races (per-session lock)
- Therapist assignment race (per-appointment lock)
- Station preference write conflicts (per-appointment lock)
- Session completion duplicate (per-session lock)

---

### 4. Finance Authority

**Canonical writers (each separate):**
- Payment: lib/domain/finance/payment.ts
- Expense: lib/domain/finance/expense.ts
- Cash: lib/domain/finance/cash.ts
- Salary: lib/domain/finance/salary.ts

All finance operations are **Owner-only**. No staff role has finance mutation permissions.

**Authorization matrix (Owner only):**

| Action | Owner |
|--------|-------|
| payment.create | ✓ |
| payment.void | ✓ |
| payment.correct_own_today | ✓ (non-Owner staff limited to their own today) |
| expense.read | ✓ |
| expense.request | ✓ (non-Owner managers can request) |
| expense.approve | ✓ |
| expense.pay | ✓ |
| cash.read | ✓ |
| cash.request | ✓ (non-Owner receptionists can request) |
| cash.accept | ✓ |
| salary.read | ✓ |
| salary.pay | ✓ |

**No distributed locks on finance mutations.** Finance Sheets operations are single-threaded (Sheets handles serialization).

**Enforcement:**
- API: Only Owner can POST /api/finance/* mutations
- Domain: Finance functions do not call assertCanPerform (role is already validated at API)
- Auditor can read reports but not mutate

**Failure scenarios prevented:**
- Staff cannot mutate finance even if they have "payment.read_amount"
- Unauthorized payment correction (only self-owned today entries)
- Concurrent Sheets writes handled by Sheets, not application

---

### 5. Clinical Authority

**Canonical writers (each separate):**
- Assessment: lib/domain/clinical/assessment.ts
- Treatment plan: lib/domain/clinical/plan.ts
- Treatment session: lib/domain/clinical/session.ts

**Authorization matrix:**

| Role | read | write |
|------|------|-------|
| Owner | ✓ | ✓ |
| Manager | ✓ | - |
| Receptionist | - | - |
| Therapist | ✓ | ✓* |
| Dentist | ✓ | ✓* |
| Dental_Assistant | - | - |
| Auditor | - | - |
| System Admin | - | - |

*Clinician write requires assignedToCurrentStaff OR currentDayCrossCover

**Temporary Dental exception (Receptionist only):**
- Scope: Dental department only
- Permissions: clinical.read + clinical.write
- Does NOT grant: appointment, payment, chamber, or Physio access
- Fail-closed: Missing/invalid scope → no access

**Enforcement:**
- API: assertCanPerform(context, "clinical.read"|"clinical.write", patient.department)
- Domain: canPerform() re-checks with conditions.assignedToCurrentStaff
- Condition: Therapist/Dentist clinical writes only when assigned to patient

**Failure scenarios prevented:**
- Therapist cannot write clinical for unassigned patients
- Receptionist cannot write clinical (unless Dental exception)
- Dental exception cannot write Physio clinical
- Exception expires or is removed → access revoked immediately

---

### 6. Reports/Media Authority

**Canonical writer:** lib/domain/reports.ts (upload only)

**Authorization matrix:**

| Role | read | upload |
|------|------|--------|
| Owner | All | All |
| Manager | Scoped | - |
| Receptionist | Scoped | Scoped |
| Therapist | Scoped | Scoped |
| Dentist | Scoped | Scoped |
| Dental_Assistant | - | - |
| Auditor | - | - |
| System Admin | - | - |

**Direct URL access (media serve):**
- GET /api/patients/[patientId]/reports/[reportId]/media
- Enforced at: getPatientForContext() filters by staff department
- Cross-department: Returns 404 if staff cannot access patient's department
- No querystring bypass: patientId is resolved server-side only

**Enforcement:**
- Upload: assertCanPerform(context, "patient.report.upload", patient.department)
- Read: assertCanPerform(context, "patient.report.read", patient.department)
- Serve: getPatientForContext() gates access; invalid/missing patient returns 404

**Failure scenarios prevented:**
- Physio staff cannot see Dental patient reports
- Dental staff cannot see Physio patient reports
- Crafted URL with Dental patientId for Physio-only staff returns 404
- Report deletion (if implemented) must also check department

---

### 7. Notifications/Chat Authority

**Real-time:** ChamberAlertListener (chamber runtime only)

**Constraints:**
- Messages only visible to staff with chamber.read + Physio access
- Message content never cached in service worker
- Unread counts cleared only when staff explicitly reads

**Enforcement:**
- ChamberAlertListener subscribes only when context.roles allows chamber.read
- unread badge only displays for chamber users
- No private message metadata in notifications

---

### 8. Audit Authority

**Read-only (no mutations).**

**Authorization matrix:**

| Role | access |
|------|--------|
| Owner | ✓ |
| Auditor | ✓ |
| All others | - |

**Enforcement:**
- assertCanPerform(context, "audit.read", "Physio") OR canPerform(context, "audit.read", "Dental")
- Auditor can read Physio + Dental audit (both departments)
- Cannot mutate (no audit.* write actions exist)

---

### 9. Settings Authority

**Owner-only management.**

**Authorization matrix:**

| Role | access |
|------|--------|
| Owner | ✓ |
| System Admin | ✓ |
| All others | - |

---

## Role × Department Matrix (Complete)

### All Roles

**Owner:**
- departmentAccess: Usually ["All"]
- Can access: All departments, all patient/appointment/finance/clinical operations
- Exceptions: None (role is unrestricted)

**Manager:**
- departmentAccess: ["Physio"] OR ["Dental"] OR ["Physio", "Dental"]
- Can access: Scoped to explicit departmentAccess
- Cannot: Finance mutations, System settings
- Chamber: Only if Physio scope

**Receptionist:**
- departmentAccess: ["Physio"] OR ["Dental"] OR ["Physio", "Dental"]
- Can access: Patient, appointment, payment (limited), clinical (Dental exception only)
- Cannot: Finance, chamber.run
- Chamber: Only receive (check-in), not run

**Therapist:**
- departmentAccess: ["Physio"] (only)
- Can access: Physio patients, appointments (assign-able), clinical, chamber.run
- Cannot: Dental, finance, chamber.receive, payment
- Clinical.write: Only assigned patients

**Dentist:**
- departmentAccess: ["Dental"] (only)
- Can access: Dental patients, appointments (assign-able), clinical (Dental exception N/A)
- Cannot: Physio, finance, chamber, payment
- Clinical.write: Only assigned patients

**Dental_Assistant:**
- departmentAccess: ["Dental"]
- Capabilities: None (explicitly empty pending review)
- Cannot: Any patient-facing action

**Auditor:**
- departmentAccess: Not used (read-only access)
- Can access: Audit logs, financial/operational reports
- Cannot: Any mutation, any patient data (except as audit evidence)

**System Admin:**
- departmentAccess: Not used
- Can access: Settings, audit logs
- Cannot: Patient data, mutations (unless Owner)

---

## Cross-Department Isolation Enforcement

### Appointment Isolation

1. **Creation:**
   ```
   assertCanPerform(context, "appointment.create", patient.department)
   getPatientForContext(context, patientId) // filters by department
   ```

2. **Status update:**
   ```
   appointment = await getAppointmentForContext(context, appointmentId)
   // Returns 404 if staff cannot access appointment's department
   assertCanPerform(context, "appointment.update", appointment.department)
   ```

3. **Direct URL bypass:** Prevented by getAppointmentForContext filtering

### Chamber Isolation

1. **Receive check-in:**
   ```
   assertCanPerform(context, "chamber.receive", "Physio")
   // Fails if staff lacks Physio access or chamber.receive permission
   ```

2. **Appointment lookup:** Chamber only accepts Physio appointmentIds
   - Dental appointmentIds never enter chamber.queue or chamber.sessions

### Patient Isolation

1. **File access:**
   ```
   patient = await getPatientForContext(context, patientId)
   if (!patient || patient.department === "All") notFound()
   // Returns 404 if:
   //   - staff cannot access patient's department
   //   - patient has invalid department="All"
   ```

2. **Clinical access:** Same as above
3. **Report access:** getPatientForContext() filters before media serve

---

## API Error Responses

**All mutation endpoints distinguish:**

- **400 Bad Request:** Invalid input (date, time, therapist, requestId)
- **403 Forbidden:** Authorization denied (wrong role or department)
- **404 Not Found:** Resource not found OR access denied (ambiguous for security)
- **409 Conflict:** Duplicate (requestId), conflict (slot taken), capacity exceeded
- **503 Service Unavailable:** Sheets/Supabase unavailable, lock timeout

**Error message handling:**
- No stack traces to client
- No secrets in error text
- Client distinguishes "unauthorized" vs "not found"
- Load state persists until server response received

---

## Safe Swipe Guard (PR #95)

**Invariants (must not regress):**

- Minimum swipe threshold: 96px
- Vertical scroll cancels swipe navigation
- Form/input/table exclusions prevent accidental nav
- Bottom nav tap has safety margin
- No horizontal viewport overflow from swipe feedback

---

## PWA/Mobile Hardening

**Manifest wiring:**
- icons[] properly sized (192x192, 512x512)
- start_url points to /home
- display: "standalone"
- background_color and theme_color consistent

**Mobile-specific:**
- Safe area padding applied (env(safe-area-inset-*))
- Touch targets minimum 44×44px
- No horizontal overflow (tables scroll internally)
- Loading states persist after mutation tap
- Offline indicator (no implied sync of private data)

---

## Testing Coverage

### Role × Department Authorization (297+ test cases total)

**v1cAppointmentChamberAuthority.test.ts:**
- 126+ test cases for all role/department combinations
- Appointment create/read/update authorization
- Chamber receive/run authorization
- Cross-department isolation
- Temporary exception scope verification

**v1cAppointmentConsolidation.test.ts:**
- 50+ test cases for consolidation and concurrency
- Physio booking canonical command verification
- Status update concurrency hardening
- Lock serialization per operation type
- Different appointments running in parallel

**Other regression suites:**
- workspaceArchitecture.test.ts: Navigation wiring
- chamberArchitecture.test.ts: Chamber consolidation
- All covering 297 test cases total

### Required Additional V1-D Tests

- [ ] Cross-department direct URL access rejection
- [ ] Patient Hub button authorization wiring
- [ ] Finance mutation Owner-only enforcement
- [ ] Error handling correctness
- [ ] Mobile workflow critical paths
- [ ] Notification/chat department isolation

---

## Compatibility Routes (Preserved)

**Entry-point compatibility aliases (do NOT delete):**
- /api/chamber/fixed-hour → /api/chamber/schedule → createUnifiedPhysioBooking
- /api/chamber/hourly-booking → /api/chamber/schedule → createUnifiedPhysioBooking
- /menu → /more (redirect, 2-line page)
- /operations → /finance/operations (redirect with tab passthrough)

**All delegate to canonical implementations. No independent logic.**

---

## Rollback Procedure

If critical issues discovered post-merge:

1. Identify issue (e.g., false authorization denial)
2. `git revert HEAD` on the affected commit
3. Restore V1-B baseline
4. Authorization checks remain at domain layer (defense-in-depth)
5. Distributed locks preserved (safety invariant)
6. Retest before re-merging

---

## Metrics to Monitor (Post-Merge)

1. **Authorization failures:** spike → possible false positive
2. **Appointment creation latency:** increase → possible lock contention
3. **Chamber mutation latency:** increase → possible per-session lock contention
4. **Lock acquisition timeouts:** any → identify stale/leaked locks
5. **Duplicate appointment attempts:** increase → possible requestId collision or client retry logic

---

## Source of Truth

This document (V1D_FINAL_PRODUCT_AUTHORITY.md) is the canonical specification for:
- Role × Department authorization matrix
- Canonical business writers
- Distributed lock boundaries
- Cross-department isolation enforcement
- Compatibility route mappings

**Version:** 1.0 (V1-D)  
**Last Updated:** 2026-08-17  
**Status:** Production
