# V1-A Finance Domain Authority Map

## Canonical Services & Data Sources

### PAYMENT

| Aspect | Authority | API | Datastore | Audit |
|--------|-----------|-----|-----------|-------|
| **Service** | `lib/domain/finance/payments.ts::createPayment()` | POST /api/finance/payment | 02_Patients (Paid/Due/Status) + 06_Payments (ledger) | 20_Data_Audit |
| **Wrapper** | `lib/domain/finance/production.ts::createPayment()` | Same | Sheets primary, Supabase shadow | 20_Data_Audit batch |
| **Lock** | `withMutationLock("finance:payment:${dept}:${patientId}")` | - | - | - |
| **Atomicity** | ✅ FIXED (PR #91) | - | Audit in same batch (line 363) | - |
| **Idempotency** | requestId marker in Remarks + check (line 179) | - | - | - |
| **Concurrency** | ✅ Protected | - | - | - |

---

### EXPENSE (BROKEN - V1-A FIX)

| Aspect | Current | Target (V1-A) |
|--------|---------|---------------|
| **Service** | `expenses.ts::requestExpense()` | Atomized wrapper |
| **Primary Mutation** | batchUpdateSpreadsheet([append]) ✅ | Same ✅ |
| **Audit Write** | appendSheetValues (SEPARATE) ❌ | SAME BATCH ✓ |
| **Lock** | NONE ❌ | withMutationLock (dept-scoped) ✓ |
| **Audit Failure** | Silent catch ❌ | Batch failure ✓ |
| **Datastore** | 07_Expenses + 20_Data_Audit | Same |
| **Idempotency** | requestId marker (good) | Preserve ✓ |

**Three operations need atomization**:
1. `requestExpense()` - Create expense request
2. `decideExpense()` - Approve/reject
3. `payApprovedExpense()` - Mark as paid

---

### CASH MOVEMENT (BROKEN - V1-A FIX)

| Aspect | Current | Target (V1-A) |
|--------|---------|---------------|
| **Service** | `cash.ts::requestCashMovement()` | Atomized wrapper |
| **Primary Mutation** | batchUpdateSpreadsheet([append]) ✅ | Same ✅ |
| **Audit Write** | appendSheetValues (SEPARATE) ❌ | SAME BATCH ✓ |
| **Lock** | NONE ❌ | withMutationLock ✓ |
| **Audit Failure** | Silent catch ❌ | Batch failure ✓ |
| **Datastore** | 21_Cash_Movement + 20_Data_Audit | Same |

**Two operations need atomization**:
1. `requestCashMovement()` - Create cash request
2. `decideCashMovement()` - Accept/reject

---

### SALARY (BROKEN - V1-A FIX)

| Aspect | Current | Target (V1-A) |
|--------|---------|---------------|
| **Service** | `salary.ts::paySalary()` | Atomized wrapper |
| **Primary Mutation** | batchUpdateSpreadsheet([append]) ✅ | Same ✅ |
| **Audit Write** | appendSheetValues (SEPARATE) ❌ | SAME BATCH ✓ |
| **Lock** | NONE ❌ | withMutationLock ✓ |
| **Audit Failure** | Silent catch ❌ | Batch failure ✓ |
| **Datastore** | 13_Salary + 20_Data_Audit | Same |

**One operation needs atomization**:
1. `paySalary()` - Record salary payment

---

## Lock Scope Design (V1-A)

### Payment Lock (Current ✅)
```
Key: finance:payment:${department}:${patientId}
Scope: Patient-specific
Effect: Two payments for same patient serialize
Benefit: Concurrent payments for different patients allowed
```

### Expense Lock (V1-A New)
```
Key: finance:expense:${department}
Scope: Department-wide
Effect: All expense requests in department serialize
Justification: ID collision risk is department-scoped
Concurrent: Different departments can request in parallel
```

### Cash Movement Lock (V1-A New)
```
Key: finance:cash:${department}
Scope: Department-wide
Effect: All cash requests in department serialize
Justification: Movement ID collision, custody tracking
Concurrent: Different departments can move in parallel
```

### Salary Lock (V1-A New)
```
Key: finance:salary:${department}
Scope: Department-wide (or could be staff-scoped if needed later)
Effect: Salary payments serialize within department
Justification: ID collision, payment sequence integrity
```

---

## Distributed Lock Strategy (V1-A Decision Required)

Current implementation: `withMutationLock()` uses in-memory Map (process-local)

### Option 1: Supabase Advisory Locks (RECOMMENDED)
- **Pros**: Already have Postgres, native, no Redis setup
- **Cons**: Requires Edge Function or direct connection
- **Implementation**: Replace Map-based lock with Supabase `pg_advisory_lock()`

### Option 2: Supabase distributed_lock Table
- **Pros**: App-level implementation, visible, debuggable
- **Cons**: More code, lease-based (stale recovery needed)
- **Implementation**: Create table, TTL cleanup, acquire/release logic

### Option 3: Redis
- **Pros**: Industry standard
- **Cons**: New external dependency, operational overhead
- **Implementation**: Last resort if Supabase unsuitable

**V1-A Decision**: Try Option 1 (Advisory locks) first
- If feasible: implement by end of V1-A
- If not feasible: implement Option 2 as fallback

---

## Sheets Schema Verification (V1-A Pre-check)

Before implementation, verify these sheets exist and have required columns:

### 20_Data_Audit (Required for all 4 mutations)
```
Expected columns (from payments.ts line 220-244):
- Audit_ID
- Timestamp
- Actor_ID
- Action (EXPENSE_REQUESTED, EXPENSE_APPROVED, EXPENSE_REJECTED, EXPENSE_PAID, etc.)
- Entity_Type (Expense, CashMovement, SalaryPayment)
- Entity_ID
- Patient_ID (may be empty for some)
- Before_Value
- After_Value (JSON)
- Reason
- Organization_ID
- Clinic_ID
- Branch_ID
- Record_ID
- Encounter_ID
- Provider_ID
- Source_System
- Source_Type
- AI_Generated
- Human_Verified
- Schema_Version
- Provenance_Timestamp
- Department
```

**Check during implementation**: Verify Physio workbook has all columns ✓

### 07_Expenses (Expense mutations)
```
Headers (line 230-239 expenses.ts):
- Expense_ID
- Date
- Category
- Amount
- Status (Pending, Approved, Rejected, Paid)
- Requested_By
- Approved_By
- Approved_At
- Paid_From
- Paid_By
- Paid_At
- Department
- Note
[+ standard tenant fields]
```

### 21_Cash_Movement (Cash mutations)
```
Headers (from cash.ts):
- Movement_ID
- Date
- From_Custodian (Reception)
- To_Custodian (Home Treasury, Bank)
- Amount
- Status (Pending, Accepted, Rejected)
- Requested_By
- Accepted_By
- Accepted_At
- Department
- Note
```

### 13_Salary (Salary mutations)
```
Headers (from salary.ts):
- Payment_ID
- Date
- Staff_ID
- Amount
- Paid_From
- Paid_By
- Department
- Note
```

---

## Audit Trail Schema (V1-A Standard)

All four mutations must write to 20_Data_Audit using this schema:

```typescript
{
  Audit_ID: `AUD-${randomUUID()}`,
  Timestamp: now.timestamp,                    // ISO 8601
  Actor_ID: context.staffId,
  Action: "EXPENSE_REQUESTED" | "EXPENSE_APPROVED" | "EXPENSE_REJECTED" | "EXPENSE_PAID" |
          "CASH_REQUESTED" | "CASH_ACCEPTED" | "CASH_REJECTED" |
          "SALARY_PAID",
  Entity_Type: "Expense" | "CashMovement" | "SalaryPayment",
  Entity_ID: expenseId | movementId | paymentId,
  Patient_ID: "",                              // Empty for staff operations
  Before_Value: JSON.stringify(beforeState),
  After_Value: JSON.stringify(afterState),
  Reason: "Finance domain action" | custom reason,
  Organization_ID: RELIFE_SYSTEM.organizationId,
  Clinic_ID: ledgerClinicId(department),
  Branch_ID: RELIFE_SYSTEM.branchId,
  Record_ID: relifeRecordId(department, entityId),
  Encounter_ID: "",
  Provider_ID: context.staffId,
  Source_System: RELIFE_SYSTEM.sourceSystem,
  Source_Type: RELIFE_SYSTEM.sourceType,
  AI_Generated: false,
  Human_Verified: true,
  Schema_Version: RELIFE_SYSTEM.schemaVersion,
  Provenance_Timestamp: now.provenance,
  Department: department
}
```

---

## Files to Change (V1-A Implementation)

### 1. lib/domain/finance/expenses.ts
- Remove `appendExpenseAudit()` function (consolidate to batch)
- Update `requestExpense()` to build audit row and add to batch
- Update `decideExpense()` to add audit row to batch
- Update `payApprovedExpense()` to add audit row to batch
- Preserve all business logic

### 2. lib/domain/finance/cash.ts
- Remove `appendCashAudit()` function
- Update `requestCashMovement()` to atomize
- Update `decideCashMovement()` to atomize
- Preserve all business logic

### 3. lib/domain/finance/salary.ts
- Remove `appendSalaryAudit()` function
- Update `paySalary()` to atomize
- Preserve all business logic

### 4. lib/domain/finance/production.ts
- Add withMutationLock wrappers to:
  - `requestExpense()` with key `finance:expense:${department}`
  - `decideExpense()` with key based on workbook
  - `payApprovedExpense()` with key based on department
  - `requestCashMovement()` with key `finance:cash:${department}`
  - `decideCashMovement()` with key based on workbook
  - `paySalary()` with key `finance:salary:${department}`

### 5. lib/webos/mutationLock.ts (IF distributed lock implemented)
- Replace in-memory Map with distributed lock (Supabase advisory locks)
- Preserve API compatibility
- Add TTL/lease renewal for safety

### 6. tests/
- Add `expenseAtomicityBatch.test.ts` - verify expense/audit in same batch
- Add `cashAtomicityBatch.test.ts` - verify cash/audit in same batch
- Add `salaryAtomicityBatch.test.ts` - verify salary/audit in same batch
- Add `expenseConcurrency.test.ts` - concurrent expense requests
- Add `cashConcurrency.test.ts` - concurrent cash requests
- Add `salaryConcurrency.test.ts` - concurrent salary payments
- Add `distributedLockSafety.test.ts` - cross-instance lock verification (if implemented)

---

## Success Criteria (V1-A Definition of Done)

- [ ] All audit calls moved into batch requests
- [ ] All expense/cash/salary mutations have withMutationLock wrappers
- [ ] All appendExpenseAudit/appendCashAudit/appendSalaryAudit functions removed (consolidated)
- [ ] Finance business logic identical to PR #91 payment implementation
- [ ] Regression test suite passes (10+ new tests)
- [ ] No silent error handling on audit failure
- [ ] Idempotency preserved for all operations
- [ ] Lock scopes verified (no unnecessary serialization)
- [ ] Distributed lock evaluated and documented
- [ ] docs/COMPLETE_PRODUCTION_AUDIT.md updated with resolution status

---

## Known Risks & Mitigations (V1-A)

| Risk | Mitigation |
|------|-----------|
| Audit row missing column | Pre-check all columns exist before batch (payment model line 220-244) |
| Audit batch failure | Test with missing columns, verify error propagates |
| Lock deadlock | Use timeout, test concurrent unrelated requests |
| Sheet not found | Schema validation before batch (payment model line 188-194) |
| Partial write | Batch API guarantees all-or-nothing, verify in test |
| Double-approval | Lock + idempotency check (test both) |

