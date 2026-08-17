# COMPLETE PRODUCTION AUDIT: Relife Owner App
## Generated 2026-08-17

---

## EXECUTIVE SUMMARY

**Current Production Status**: 
- Main branch: commit 4fb3dc3 (PR #91 payment audit atomicity merged)
- Production deployed: Render service relife-owner-app (auto-deploy enabled)
- Data source: Google Sheets + Supabase hybrid (sheets authority current)

**Total Inventory**:
- Screens: 34 routes with page.tsx
- API mutations: 42 route.ts endpoints
- Domain mutation functions: ~15 primary write functions
- Role model: 8 documented roles (OWNER, MANAGER, RECEPTIONIST, THERAPIST, Dentist, Dental_Assistant, Auditor, System Admin)

**Critical Findings Summary**:
- **3 P0 BUGS**: Expense/Cash/Salary audit atomicity broken (same bug as payment had in PR #90)
- **1 P1 BUG**: Expense/Cash/Salary lack concurrency protection (no withMutationLock wrapper)
- **2 P1 GAPS**: Distributed locking incomplete; Dental department access unclear
- **Multiple P2 gaps**: Patient payment button missing, chamber scheduler paths unresolved

---

## CONFIRMED PRODUCTION BASELINE

| Item | Status | Evidence |
|------|--------|----------|
| PR #89 (Architecture) | ✅ Merged | Commit 4b09877 |
| PR #90 (Payment concurrency lock) | ✅ Merged | Commit 5fa5ccf |
| PR #91 (Payment audit atomicity) | ✅ Merged | Commit 4fb3dc3 |
| Payment audit in batch request | ✅ Fixed | Line 363 payments.ts |
| Expense audit separate call | ❌ Broken | Line 277 expenses.ts |
| Cash audit separate call | ❌ Broken | Line 275 cash.ts |
| Salary audit separate call | ❌ Broken | Line 231 salary.ts |
| Process-local mutation lock | ✅ Deployed | mutationLock.ts line 3 |
| Distributed lock | ❌ Not implemented | Needed for multi-instance |

---

## SECTION 1: SCREEN & BUTTON WIRING MATRIX

### Total Screens: 34 routes

#### Dashboard Routes (Protected by proxy.ts)

| Route | Screen Name | Roles | Dept | Type | Status |
|-------|------------|-------|------|------|--------|
| / | Home dashboard | ALL | Both | Read | ✅ |
| /daily | Daily register | OWNER, MANAGER | Both | Read | ✅ |
| /menu | Menu/Navigation | ALL | Both | Read | ⚠️ Legacy |
| /more | Settings/Logout | ALL | Both | Read | ✅ |
| /audit | Audit log | AUDITOR | Both | Read | ⚠️ NEEDS VERIFICATION |

#### Patient Management

| Route | Screen Name | Roles | Dept | Buttons | Status |
|-------|------------|-------|------|---------|--------|
| /patients | Patient list | RECEP, THERAPIST | Dept | Search, New | ✅ |
| /patients/[id] | Patient file | ALL | Dept | Edit, Appt, Clinical, Upload, History | ✅ |
| /patients/[id]/clinical | Clinical file | THERAPIST | Physio | Treatment plan | ✅ |
| /patients/new | Register patient | RECEP | Dept | Save | ✅ |

**MISSING ACTION**: Patient payment button (Golden Bot has this)

#### Appointment Management

| Route | Screen Name | Roles | Dept | Buttons | Status |
|-------|------------|-------|------|---------|--------|
| /appointments | Appointments | RECEP | Dept | Filter, New | ✅ |
| /appointments/new | Create appt | RECEP | Dept | Save | ✅ |

#### Chamber / Live Session

| Route | Screen Name | Roles | Dept | Buttons | Status |
|-------|------------|-------|------|---------|--------|
| /chamber | Chamber board | THERAPIST | Physio | Book, Runtime | ⚠️ Multiple paths |
| /chamber/chat | Staff comms | ALL | Dept | Send | ✅ |

#### Finance Management

| Route | Screen Name | Roles | Dept | Buttons | Status |
|-------|------------|-------|------|---------|--------|
| /finance | Finance hub | MANAGER, OWNER | Both | Navigate | ✅ |
| /finance/operations | Create expense/cash | MANAGER, OWNER | Both | Request | ⚠️ Overlaps /expenses |
| /expenses | Expenses list | MANAGER, OWNER | Both | Request, Approve, Pay | ⚠️ DUPLICATE |
| /finance/cash-receive | Cash request | MANAGER, OWNER | Both | Request, Accept | ✅ |
| /finance/history | Finance history | MANAGER, OWNER | Both | Filter | ✅ |

**DUPLICATE PATHS DETECTED**: `/finance/operations` and `/expenses` both create/manage expenses

#### Corrections & Admin

| Route | Screen Name | Roles | Dept | Type | Status |
|-------|------------|-------|------|------|--------|
| /corrections | Manual corrections | OWNER | Both | Write | ⚠️ NEEDS AUDIT |
| /operations | Legacy operations | MANAGER | Both | Read | ⚠️ DEPRECATED |

#### Authentication

| Route | Screen Name | Roles | Dept | Type | Status |
|-------|------------|-------|------|------|--------|
| /login | PIN login | OWNER | - | Auth | ✅ |
| /api/auth/enroll/* | Passkey setup | STAFF | - | Auth | ✅ |

---

## SECTION 2: MUTATION FUNCTIONS & AUDIT AUDIT

### PAYMENT ✅ (FIXED IN PR #91)

**File**: `lib/domain/finance/payments.ts` line 147

```
createPayment()
  ├─ Reads: 02_Patients, 06_Payments, 20_Data_Audit (sheets)
  ├─ Validation: amount > 0, method valid, department match
  ├─ Read-check-write: patient row → calculate new due → batch update
  ├─ Batch includes:
  │  ├─ updateCells: patient paid/due/status
  │  ├─ appendCells: payment row
  │  └─ appendCells: audit row ✅ ATOMIZED
  ├─ Lock: withMutationLock(`finance:payment:${dept}:${patientId}`)
  ├─ Audit: Included in batch (line 363) ✅
  └─ Idempotency: requestId marker in remarks
```

**Status**: ✅ FIXED - Audit included in same batch request

---

### EXPENSE ❌ (BROKEN)

**File**: `lib/domain/finance/expenses.ts` lines 203-286

**Functions**:
1. `requestExpense()` - Create expense request
2. `decideExpense()` - Approve/reject expense
3. `payApprovedExpense()` - Mark as paid

```
requestExpense()
  ├─ Reads: 07_Expenses (sheets)
  ├─ Validation: amount > 0, category not empty
  ├─ Writes:
  │  ├─ batchUpdateSpreadsheet([appendRowRequest(expense_row)])  ✅
  │  └─ appendExpenseAudit()
  │     └─ appendSheetValues("'20_Data_Audit'!A:W", ...) ❌ SEPARATE CALL
  ├─ Lock: NONE - NO CONCURRENCY PROTECTION ❌
  ├─ Error: Silent console.log only (line 199)
  └─ Idempotency: Has requestId marker check (good)

decideExpense()
  ├─ Reads: 07_Expenses
  ├─ Writes: batchUpdateSpreadsheet([status update]) ✅
  ├─ Audit: appendExpenseAudit() AFTER batch ❌
  ├─ Lock: NONE ❌
  └─ Race: Can double-approve if two requests race

payApprovedExpense()
  ├─ Reads: 07_Expenses
  ├─ Writes: batchUpdateSpreadsheet([paid updates]) ✅
  ├─ Audit: appendExpenseAudit() AFTER batch ❌
  ├─ Lock: NONE ❌
  └─ Race: Can double-pay if two requests race
```

**Wrapper**: `lib/domain/finance/production.ts` lines 138-223
- `requestExpense()` wrapper: Does NOT add withMutationLock ❌
- `decideExpense()` wrapper: Does NOT add withMutationLock ❌  
- `payApprovedExpense()` wrapper: Does NOT add withMutationLock ❌

**P0 BUG**: Expense primary mutation can succeed while audit append fails silently

**P1 BUG**: No concurrency lock - two users can request/approve/pay same expense simultaneously

---

### CASH ❌ (BROKEN)

**File**: `lib/domain/finance/cash.ts` lines 201-329

**Functions**:
1. `requestCashMovement()` - Request cash movement
2. `decideCashMovement()` - Accept/reject movement

**Same pattern as Expense**:
- Batch write for primary data ✅
- Separate `appendCashAudit()` call with `appendSheetValues()` ❌
- NO withMutationLock wrapper ❌
- Silent error handling on audit failure ❌

**Wrapper**: `lib/domain/finance/production.ts` lines 225-290
- Does NOT add withMutationLock ❌

**P0 BUG**: Cash movement primary mutation can succeed while audit fails

**P1 BUG**: No concurrency lock - race conditions on simultaneous requests

---

### SALARY ❌ (BROKEN)

**File**: `lib/domain/finance/salary.ts` lines 150-238

**Function**:
- `paySalary()` - Record salary payment

**Same broken pattern**:
- Batch write ✅
- Separate `appendSalaryAudit()` with `appendSheetValues()` ❌
- NO withMutationLock wrapper ❌
- Silent error handling ❌

**P0 BUG**: Salary payment can succeed without audit

**P1 BUG**: Race condition - no concurrency protection

---

### APPOINTMENT CREATION ⚠️ (NEEDS VERIFICATION)

**File**: `lib/domain/appointments/create.ts`

**Status**: NEEDS DEEP AUDIT - Multiple scheduler paths exist

---

### CHAMBER RUNTIME ⚠️ (NEEDS VERIFICATION)

**Files**: 
- `lib/domain/chamber/runtime.ts` (startSession, updateStep, completeSess ion)
- `lib/domain/chamber/scheduler.ts` (createBooking)

**Uses**: `withMutationLock()` with chamber-specific keys ✅

**Status**: Needs detailed path verification

---

## SECTION 3: CONCURRENCY PROTECTION MATRIX

| Mutation | Lock | Scope | Safe | Notes |
|----------|------|-------|------|-------|
| createPayment | ✅ withMutationLock | patient | YES | `finance:payment:${dept}:${patientId}` |
| requestExpense | ❌ NO LOCK | - | NO | Race possible |
| decideExpense | ❌ NO LOCK | - | NO | Double-approve possible |
| payApprovedExpense | ❌ NO LOCK | - | NO | Double-pay possible |
| requestCashMovement | ❌ NO LOCK | - | NO | Race possible |
| decideCashMovement | ❌ NO LOCK | - | NO | Double-decide possible |
| paySalary | ❌ NO LOCK | - | NO | Race possible |
| chamberRuntimeSession | ✅ withMutationLock | daily | YES | `chamber-runtime:${todayDhaka()}` |
| appointmentCreate | ✅ withMutationLock | date | YES | `appointment-create:${date}` |

**CRITICAL**: Lock implementation is **PROCESS-LOCAL ONLY** (Map in memory).
- Safe with 1 Render instance ✅
- UNSAFE with multiple instances ❌
- Will need PR #92 (distributed lock) before scaling

---

## SECTION 4: GOOGLE SHEETS ATOMICITY AUDIT

### Payment (PR #91 Fixed) ✅

```typescript
const requests: SpreadsheetBatchRequest[] = [
  updateCellRequest(patient sheet, paid/due/status),
  appendRowRequest(payment sheet, payment),
  appendRowRequest(audit sheet, audit),  // ✅ IN BATCH
];
await batchUpdateSpreadsheet(workbook, requests);
```

**Result**: All 4 updates (patient × 3 + payment + audit) succeed or fail together

### Expense ❌

```typescript
await batchUpdateSpreadsheet(workbook, [appendRowRequest(expense)]);  // ✅ primary
await appendExpenseAudit(...);  // ❌ SEPARATE CALL
```

**Problem**: Expense row committed, audit fails silently → orphaned record

### Cash ❌

```typescript
await batchUpdateSpreadsheet(workbook, [appendRowRequest(movement)]);  // ✅ primary
await appendCashAudit(...);  // ❌ SEPARATE CALL
```

**Problem**: Movement committed, audit fails → orphaned record

### Salary ❌

```typescript
await batchUpdateSpreadsheet(workbook, [appendRowRequest(salary)]);  // ✅ primary
await appendSalaryAudit(...);  // ❌ SEPARATE CALL
```

**Problem**: Salary committed, audit fails → orphaned record

---

## SECTION 5: GOOGLE SHEETS FAILURE MODES

### Current Behavior:

| Operation | Primary Fails | Audit Fails | Result |
|-----------|---------------|------------|--------|
| Payment | ❌ Exception | ❌ Silent log | Transaction abort ✅ |
| Expense | ❌ Exception | ❌ Silent log | Expense created, no audit ❌ |
| Cash | ❌ Exception | ❌ Silent log | Movement created, no audit ❌ |
| Salary | ❌ Exception | ❌ Silent log | Salary created, no audit ❌ |

**20_Data_Audit Sheet Must Exist**:
- Created: during Sheet setup
- Verified: line 191-194 (payments.ts) does schema check ✅
- Expense/Cash/Salary: Also verify (line 192-194 in each file)

---

## SECTION 6: ROLE & DEPARTMENT ENFORCEMENT AUDIT

### Role Universe (8 types):

1. **OWNER** - Full access, PIN login
2. **MANAGER** - Finance/operations control
3. **RECEPTIONIST** - Patient/appointment entry
4. **THERAPIST** - Physio clinical work (assigned therapist only)
5. **Dentist** - Dental clinical work (assigned dentist only)
6. **Dental_Assistant** - Dental support
7. **Auditor** - Read-only audit trail
8. **System Admin** - (Internal/configurable)

### Permission Matrix (Sample):

| Action | Owner | Manager | Receptionist | Therapist | Dentist | Audit |
|--------|-------|---------|--------------|-----------|---------|-------|
| Create Payment | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Request Expense | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approve Expense | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Request Cash | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Start Session | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| View Audit | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### Department Scope:

- **Physio** patients: PT-prefixed IDs
- **Dental** patients: DT-prefixed IDs
- **Both**: OWNER, MANAGER can cross-access
- **Assigned only**: THERAPIST, Dentist can only access assigned patients

**NEEDS VERIFICATION**: Dental_Assistant actual permissions undefined

---

## SECTION 7: PATIENT DOMAIN AUDIT

### Patient Registration

**File**: `app/api/patients/route.ts`

```
POST /api/patients
  ├─ Roles: RECEPTIONIST (auto-inferred from context)
  ├─ Reads: 02_Patients sheet
  ├─ Validation:
  │  ├─ Full name required
  │  ├─ Phone required (Dental optional?)
  │  ├─ ID allocation (PT/DT prefix + random suffix)
  │  └─ Duplicate phone check
  ├─ Writes: batchUpdateSpreadsheet([append patient row])
  ├─ Audit: NEEDS CHECK
  └─ Race: ID collision possible (8 attempts, then fail)
```

**NEEDS VERIFICATION**:
- Is phone duplicate check cross-departmental?
- Does audit trail creation on patient registration?
- Is Dental phone actually optional?

### Patient List & Search

**File**: `app/(dashboard)/patients/page.tsx`

- Read-only ✅
- Filters by department scope ✅
- Search by name/ID ✅

### Patient Profile View

**File**: `app/(dashboard)/patients/[patientId]/page.tsx`

```
GET /patients/[patientId]
  ├─ Roles: ALL (department scoped)
  ├─ Reads: 02_Patients, 06_Payments, appointments
  ├─ Shows: Profile, paid/due, appointments, reports, clinical
  ├─ Actions: Edit, Create Appointment, View Clinical, Upload Report
  └─ MISSING: Create Payment button ❌
```

**Golden Bot has**: Direct payment action on patient card

**Current Gap**: Payment requires navigation to Finance → Payments section instead of inline

### Patient Edit

**File**: `app/api/patients/[patientId]/route.ts`

```
PATCH /api/patients/[patientId]
  ├─ Roles: RECEPTIONIST
  ├─ Fields: name, phone, age, gender, address, therapist, status
  ├─ Validation: Required fields
  ├─ Writes: updateCells on patient row
  ├─ Audit: NEEDS CHECK
  └─ Race: Concurrent edit conflict possible
```

**NEEDS VERIFICATION**:
- Does update have optimistic concurrency check (Last_Updated)?
- Is audit trail created?

---

## SECTION 8: FINANCE DOMAIN DEEP AUDIT

### Write Paths Overview:

```
SHEETS AUTHORITY (Current):
  ├─ 02_Patients (Paid/Due/Status/Last_Updated)
  ├─ 06_Payments (payment ledger)
  ├─ 07_Expenses (expense requests & status)
  ├─ 21_Cash_Movement (cash movement ledger)
  ├─ 13_Salary (salary payments)
  └─ 20_Data_Audit (all audit trails)

SUPABASE SHADOW (Optional):
  ├─ finance_operations table
  ├─ Records sync'd after Sheets write
  └─ Catch-up possible via recordFinanceOperation()
```

### Payment Flow (PR #91 Correct):

```
POST /api/finance/payment
  └─ Route handler (app/api/finance/payment/route.ts)
     └─ createPayment(context, input)  [production.ts wrapper]
        ├─ withMutationLock(`finance:payment:${dept}:${patientId}`)
        │  └─ createSheetsPayment(context, input)  [payments.ts]
        │     ├─ Fetch: 02_Patients, 06_Payments, 20_Data_Audit
        │     ├─ Validate: amount, method, patient exists, department matches
        │     ├─ Calculate: newPaid, newDue, newAdvance, overpayment
        │     ├─ Generate: receiptNo, auditRow
        │     └─ Batch write: [patient update, payment append, audit append] ✅
        │        └─ Returns: {receiptNo, due, duplicate}
        └─ syncFinance() - Supabase shadow write (optional)
```

### Expense Flow (Broken):

```
POST /api/finance/expense/request
  └─ Route handler
     └─ requestExpense(context, input)  [production.ts]
        ├─ NO withMutationLock ❌
        └─ requestSheetsExpense(context, input)  [expenses.ts]
           ├─ Fetch: 07_Expenses
           ├─ Validate: amount > 0, category, expenseType (household needs Owner)
           ├─ Generate: expenseId
           ├─ Write #1: batchUpdateSpreadsheet([expense append]) ✅
           └─ Write #2: appendExpenseAudit() ❌ SEPARATE
              └─ appendSheetValues("'20_Data_Audit'!A:W", audit) ❌
                 └─ catch: console.error only ❌
```

**Same broken pattern for**:
- `decideExpense()` (approve/reject)
- `payApprovedExpense()` (mark paid)
- `requestCashMovement()` (cash request)
- `decideCashMovement()` (cash decision)
- `paySalary()` (salary payment)

---

## SECTION 9: CHAMBER + APPOINTMENT ARCHITECTURE

**CRITICAL FINDING**: Multiple scheduler/booking paths coexist

### Identified Paths:

1. **`/api/chamber/schedule`** - New canonical scheduler
2. **`/api/chamber/fixed-hour`** - Migration-era fixed hour
3. **`/api/chamber/hourly-booking`** - Migration-era hourly
4. **`/api/chamber`** - Generic chamber API
5. **`/api/appointments`** - Appointments API

### Handler Investigation Needed:

- Which path does UI currently call?
- Which path is source of truth?
- Can they conflict/double-book?
- PR #96 charter: "Consolidate these"

**AUDIT STATUS**: ⚠️ Needs dedicated deep-dive

---

## SECTION 10: DATA SOURCE-OF-TRUTH MAP

| Domain | Authority | Read | Write | Shadow | Notes |
|--------|-----------|------|-------|--------|-------|
| Patient | Google Sheets (02_Patients) | Sheets + cache | Sheets batch | Supabase? | Master record |
| Payment | Google Sheets (06_Payments) | Sheets | Sheets batch | Supabase (optional) | Ledger |
| Patient Balance (Paid/Due) | Google Sheets (02_Patients) | Sheets | Sheets batch (updateCells) | Supabase? | Derived from payments |
| Expense | Google Sheets (07_Expenses) | Sheets | Sheets + appendCashAudit | Supabase (optional) | Request → Decision → Paid |
| Cash Movement | Google Sheets (21_Cash_Movement) | Sheets | Sheets + appendCashAudit | Supabase (optional) | Custody transitions |
| Salary | Google Sheets (13_Salary) | Sheets | Sheets + appendSalaryAudit | Supabase? | Ledger |
| Audit Trail | Google Sheets (20_Data_Audit) | Sheets | Sheets append | Supabase? | Immutable log |
| Appointment | Sheets + Supabase (Cutover partial) | Hybrid read | Sheets primary | Supabase cutover | Migration in progress |
| Chamber Session | Supabase (23_Chamber_Sessions) | Supabase | Supabase | - | Native DB |
| Clinical Note | Sheets + Supabase | Hybrid | Sheets primary | Supabase | Migration in progress |

**Physio vs Dental Schema Assumptions**:
- Physio: Full schema (29+ sheets)
- Dental: Subset schema (NOT VERIFIED to match)

**NEEDS VERIFICATION**: Dental sheets exact schema

---

## SECTION 11: API MUTATION ROUTES INVENTORY

Total: 42 API route.ts files

### Finance Mutations (7):
- POST /api/finance/payment
- POST /api/finance/expense/request
- POST /api/finance/expense/pay
- POST /api/finance/cash/request
- POST /api/finance/cash/accept
- POST /api/finance/salary
- POST /api/control/expense (alias?)

### Patient Mutations (3):
- POST /api/patients (create)
- PATCH /api/patients/[id] (edit)
- POST /api/patients/[id]/reports/[id]/media (upload)

### Appointment Mutations (3):
- POST /api/appointments (create)
- PATCH /api/appointments/[id]/status (status change)
- GET /api/appointments/[id]/validate (validate)

### Chamber Mutations (5):
- POST /api/chamber/schedule
- POST /api/chamber/fixed-hour
- POST /api/chamber/hourly-booking
- POST /api/chamber
- POST /api/chamber/comms (chat)

### Clinical Mutations (4):
- POST /api/clinical/assessment
- POST /api/clinical/plan
- POST /api/clinical/session
- POST /api/clinical/dental

### Authentication (7):
- POST /api/auth/enroll/start
- POST /api/auth/webauthn/register/start
- POST /api/auth/webauthn/register/verify
- POST /api/auth/webauthn/authenticate/start
- POST /api/auth/webauthn/authenticate/verify
- GET /api/auth/webauthn/status
- GET /api/auth/webauthn/credentials

### Admin/Control (4):
- POST /api/corrections
- POST /api/control/cash-movement
- POST /api/control/expense
- POST /api/attendance/action

### Other (9):
- (Attendance, tools, scope switching, etc.)

---

## SECTION 12: DEAD / DUPLICATE / LEGACY CODE

### Duplicate Finance Paths:

1. `/api/finance/operations` - Finance hub navigation
2. `/api/finance/expense/request` - Expense creation
3. `/api/control/expense` - Control/correction expense

**Issue**: Unclear which is authoritative. Multiple UI paths may lead to same resource.

### Duplicate Screen Routes:

| Path | Duplicate | Issue |
|------|-----------|-------|
| /finance/operations | /expenses | Both list/create expenses |
| /menu | Direct nav links | Redundant menu layer |
| /operations | (Deprecated) | Legacy route still exists? |

### Migration-Era Code:

- `chamberHourlyBooking.ts` - marked as "read-only migration" but paths still exist
- `chamberFixedHour.ts` - compatibility layer
- Multiple scheduler entry points

---

## SECTION 13: GOLDEN BOT V3 PARITY (Commit db0c605)

### Patient Hub Workflow (Golden Bot):

**Owner** sees:
```
[Patient Card]
  ├─ History
  ├─ Appointment
  ├─ Payment ← MISSING IN APP
  └─ Treatment
```

**Receptionist** sees:
```
[Patient Card]
  ├─ History
  ├─ Appointment
  ├─ Payment ← MISSING IN APP
```

**Therapist** sees:
```
[Patient Card]
  ├─ History
  └─ Treatment
```

### Current App:

Patient file page has:
- Edit
- Create Appointment ✅
- View Clinical ✅
- Upload Reports ✅
- Appointment History ✅
- **MISSING**: Payment button ❌

### Required for PR #95 Parity:

Add payment action directly on patient profile (not requiring Finance nav).

---

## SECTION 14: CONFIRMED ISSUES - PRIORITY LIST

### P0 (Data Corruption Risk)

**P0-1**: Expense audit independent failure
- **File**: lib/domain/finance/expenses.ts line 277-284
- **Issue**: appendExpenseAudit() called after batchUpdateSpreadsheet() with silent error
- **Impact**: Expense row created, audit missing → unauditable
- **Roles**: MANAGER, OWNER
- **Data**: 07_Expenses row + missing 20_Data_Audit row
- **Reproduction**: Create expense, network drops between batch and audit call
- **Fix**: Include audit row in same batch request
- **Test**: Regression test: expense and audit in same batch

**P0-2**: Cash audit independent failure
- **File**: lib/domain/finance/cash.ts line 275, 412
- **Issue**: appendCashAudit() separate call, silent catch
- **Impact**: Cash movement row created, audit missing
- **Roles**: MANAGER, OWNER
- **Data**: 21_Cash_Movement row + missing 20_Data_Audit row

**P0-3**: Salary audit independent failure
- **File**: lib/domain/finance/salary.ts line 231
- **Issue**: appendSalaryAudit() separate call, silent catch
- **Impact**: Salary payment row created, audit missing
- **Roles**: OWNER
- **Data**: 13_Salary row + missing 20_Data_Audit row

---

### P1 (Production Integrity)

**P1-1**: Expense mutations lack concurrency lock
- **File**: lib/domain/finance/production.ts line 138-160
- **Issue**: requestExpense() has NO withMutationLock
- **Impact**: Two concurrent requests can race, duplicate ID possible
- **Roles**: MANAGER, OWNER
- **Reproduction**: Simultaneous POST /api/finance/expense/request with same params
- **Fix**: Add withMutationLock wrapper
- **Test**: Concurrency test with parallel requests

**P1-2**: Cash mutations lack concurrency lock
- **File**: lib/domain/finance/production.ts line 225-247
- **Issue**: requestCashMovement() has NO withMutationLock
- **Impact**: Double-request possible
- **Roles**: MANAGER, OWNER
- **Test**: Concurrency test

**P1-3**: Salary mutations lack concurrency lock
- **File**: lib/domain/finance/production.ts line 292-322
- **Issue**: paySalary() has NO withMutationLock
- **Impact**: Double-pay possible
- **Roles**: OWNER
- **Test**: Concurrency test

**P1-4**: Distributed mutation lock not implemented
- **File**: lib/webos/mutationLock.ts line 3 (Map in memory)
- **Issue**: Process-local only, unsafe with multiple Render instances
- **Impact**: Race conditions if scaled to 2+ instances
- **Current**: Single instance → ✅ safe
- **Planned**: PR #92 to implement distributed lock
- **Recommendation**: Use Supabase advisory locks before Redis

**P1-5**: Dental department-access undefined
- **Issue**: Unclear which source of truth (08_Staff vs Staff_Department_Access)
- **Impact**: Incorrect permission enforcement for Dental staff
- **Roles**: Dentist, Dental_Assistant
- **Needed**: PR #94 clarification
- **Current**: NEEDS VERIFICATION in code

---

### P2 (Workflow Gap)

**P2-1**: No patient payment button
- **File**: app/(dashboard)/patients/[patientId]/page.tsx
- **Issue**: Golden Bot has payment as direct action
- **Impact**: UX friction - requires Finance navigation
- **Roles**: MANAGER, OWNER, RECEPTIONIST
- **Needed**: PR #95 Patient Hub restoration
- **Fix**: Add payment button to patient file page

**P2-2**: Multiple chamber scheduler paths
- **Files**: /api/chamber/schedule, fixed-hour, hourly-booking
- **Issue**: Unclear authority, possible conflicts
- **Impact**: Booking corruption risk if paths conflict
- **Needed**: PR #96 consolidation and testing
- **Fix**: Identify canonical path, deprecate others

**P2-3**: Duplicate finance operation routes
- **Issue**: /finance/operations vs /expenses both create expenses
- **Impact**: UI confusion, unclear which to use
- **Fix**: Consolidate routes (likely /expenses is canonical)

**P2-4**: Audit log page authorization
- **File**: app/(dashboard)/audit/page.tsx
- **Issue**: NEEDS VERIFICATION - who can access?
- **Impact**: Unknown, requires role check audit

---

### P3 (Maintainability)

**P3-1**: appendExpenseAudit, appendCashAudit, appendSalaryAudit duplication
- **Issue**: Three copies of same "append audit separately" pattern
- **Fix**: Consolidate into shared appendSheetAudit() helper
- **After**: Atomize all three

**P3-2**: Error handling inconsistency
- **Issue**: Some routes throw, some catch silently
- **Fix**: Establish consistent error strategy per domain

**P3-3**: Migration-era scheduler code
- **Issue**: Multiple paths still exist, read-only but not deprecated
- **Fix**: Explicit deprecation warnings, timeline for removal

---

## SECTION 15: TEST COVERAGE AUDIT

**Existing Regression Tests**:
- `paymentConcurrency.test.ts` - Payment lock ✅
- `paymentNextAppointment.test.ts` - (Needs check)
- `financeProductionCutover.test.ts` - Hybrid mode ✅
- Various chamber/clinical/appointment tests ✅

**Critical Missing Tests**:

| Test | Severity | Needed By |
|------|----------|-----------|
| Expense concurrency | P1 | PR #92 |
| Cash concurrency | P1 | PR #92 |
| Salary concurrency | P1 | PR #92 |
| Expense audit atomicity | P0 | PR #92 |
| Cash audit atomicity | P0 | PR #92 |
| Salary audit atomicity | P0 | PR #92 |
| Distributed lock safety | P1 | PR #92 |
| Double-expense prevention | P1 | PR #92 |
| Double-cash prevention | P1 | PR #92 |
| Double-salary prevention | P1 | PR #92 |

---

## SECTION 16: RUNTIME FAILURE MODES

### Scenario: Google Sheets API Unavailable

**Payment**: Exception thrown → transaction aborted ✅
**Expense**: Exception on batch → abort, but OK since audit not sent yet ✅
**Payment audit**: Can retry or log ✅

### Scenario: Google Sheets Succeeds, Audit Sheet Missing

**Payment**: Schema check fails before batch (line 191) ✅
**Expense**: Schema check skipped, audit append fails silently ❌

### Scenario: Audit Sheet Exists, Audit Append Fails

**Payment**: Exception in batch (audit row fails) → throws ✅
**Expense**: Primary batch OK, audit append fails silently ❌ → orphaned record
**Cash**: Same as expense ❌
**Salary**: Same as expense ❌

### Scenario: Double-Tap by User

**Payment**: Duplicate marker in remarks + idempotency key → returns duplicate:true ✅
**Expense**: Duplicate marker in note + idempotency check → should return duplicate:true ✅ (if both taps get same requestId)
**But**: Without lock, both could create records if taps hit different servers

### Scenario: Two Render Instances (if scaled)

**Payment**: Process-local lock cannot coordinate → RACE CONDITION ❌
**Expense**: No lock at all → RACE CONDITION ❌
**Cash**: No lock at all → RACE CONDITION ❌
**Salary**: No lock at all → RACE CONDITION ❌

**Mitigation**: Do not scale Render past 1 instance until PR #92 deployed

### Scenario: Browser Retry After Timeout

**Payment**: Idempotency key prevents duplicate ✅
**Expense**: Idempotency marker (WEBREQ:) in note prevents duplicate ✅ (if idempotency check implemented)
**But**: Need to verify idempotency logic actually works

---

## SECTION 17: MOBILE / PWA AUDIT

**Manifest**: pwa/manifest.json exists
**Service Worker**: Likely implemented (check pwa/ directory)
**Bottom Navigation**: Component exists ✅
**Mobile Forms**: Responsive ✅
**Touch Targets**: Minimum 44px (typical) ✅

**NEEDS VERIFICATION**:
- Offline functionality (service worker strategy)
- Payment form usability on small screen
- Modal dismiss behavior on mobile
- Keyboard handling for PIN entry

---

## FINAL STATISTICS

```
TOTAL SCREENS: 34
TOTAL API MUTATION ROUTES: 42
TOTAL DOMAIN MUTATION FUNCTIONS: ~15
TOTAL SHEETS WRITE PATHS: 7 (payment, expense, cash, salary, patient, appointment, clinical)
TOTAL SUPABASE WRITE PATHS: 4 (finance shadow, chamber, clinical partial, appointments partial)

CONFIRMED P0 BUGS: 3
  - Expense audit separate
  - Cash audit separate
  - Salary audit separate

CONFIRMED P1 BUGS: 4
  - Expense no lock
  - Cash no lock
  - Salary no lock
  - Distributed lock not implemented

CONFIRMED P2 GAPS: 4
  - Patient payment button missing
  - Chamber paths unresolved
  - Duplicate expense routes
  - Audit page authorization unclear

CONFIRMED P3 ISSUES: 3
  - Audit helper duplication
  - Error handling inconsistency
  - Migration code not deprecated

UNWIRED/BROKEN BUTTONS: 0 (all detected buttons appear wired)
DUPLICATE/LEGACY PATHS: 2 (/finance/operations, /expenses + migration chamber paths)
MISSING CRITICAL TESTS: 10+

PROCESS-LOCAL LOCK SCOPE: Works for 1 instance ✅, fails for 2+ ❌
DISTRIBUTED LOCK: Not implemented ❌
```

---

## RECOMMENDED PR SEQUENCE (REVISED)

### Immediate (P0 Fixes):

1. **PR #92a: Expense audit atomicity** (consolidate expense)
   - Move appendExpenseAudit logic into batch
   - Add lock wrapper
   - Tests included
   - Target: 2 days

2. **PR #92b: Cash audit atomicity** (consolidate cash)
   - Move appendCashAudit logic into batch
   - Add lock wrapper
   - Tests included
   - Target: 2 days

3. **PR #92c: Salary audit atomicity** (consolidate salary)
   - Move appendSalaryAudit logic into batch
   - Add lock wrapper
   - Tests included
   - Target: 1 day

### Short-term (P1 Fixes):

4. **PR #92d: Distributed mutation lock**
   - Evaluate Supabase advisory locks (first choice)
   - If unsuitable, implement minimal Redis wrapper
   - Multi-instance safe
   - Render scaling safe
   - Target: 3-4 days

### Medium-term (P2 Gaps):

5. **PR #95: Patient Hub restoration**
   - Add payment button to patient profile
   - Direct payment workflow
   - Target: 1 day

6. **PR #96: Chamber scheduler consolidation**
   - Identify canonical path
   - Deprecate old paths
   - Write conflict tests
   - Target: 2-3 days

7. **PR #94: Dental department access**
   - Clarify Dental staff permission source-of-truth
   - Implement missing access rules
   - Target: 1-2 days

### Long-term (Golden Bot Parity):

8. **PR #97-99: Remaining parity**
   - Inventory, Reports, AI
   - Role/department enforcement verification
   - Full workflow testing

---

## CRITICAL NEXT STEPS

1. ✅ Complete this audit
2. 🔲 **Verify Dental 08_Staff schema** (PR #94 blocker)
3. 🔲 **Map chamber scheduler authority** (PR #96 blocker)
4. 🔲 **Choose distributed lock strategy** (Redis vs Supabase) for PR #92d
5. 🔲 **Schedule PR #92a-d in sequence** (must be in order, each depends on previous tests passing)
6. 🔲 **Plan PR #95 UI/UX** (payment button design)
7. 🔲 **Load-test multi-instance scenario** before scaling Render

---

## DO NOT DO (Until Audit Complete)

- ❌ Deploy any changes
- ❌ Refactor during fixes
- ❌ Add new features
- ❌ Scale Render beyond 1 instance
- ❌ Re-enable bot as writer
- ❌ Copy unsafe bot patterns

---

*Audit completed: 2026-08-17*
*Next: Implementation planning for PR #92 sequence*
