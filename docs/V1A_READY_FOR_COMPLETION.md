# V1-A: Ready for Completion Assessment

## Current Status

**Expense Audit Atomization**: ✅ COMPLETE
- `requestExpense()`: Atomized ✓
- `decideExpense()`: Atomized ✓  
- `payApprovedExpense()`: Atomized ✓
- Pattern verified against payment PR #91 model ✓

**Cash & Salary**: ⏳ Pattern documented, ready to apply

**Lock Wrappers**: ⏳ Design documented, ready to apply

**Tests**: ⏳ Requirements documented, ready to write

---

## Decision Point

### Option A: Complete V1-A in One Push
**Effort**: ~4-6 hours
**Output**: Fully merged, production-ready V1-A branch
**Includes**: Expense + Cash + Salary + Locks + Tests

**Steps**:
1. Apply same atomization pattern to cash.ts (30 min)
2. Apply same atomization pattern to salary.ts (20 min)
3. Add withMutationLock wrappers to production.ts (20 min)
4. Create comprehensive test suite (2-3 hours)
5. Verify build + lint (30 min)
6. Finalize PR body with sections (30 min)

**Total**: One V1-A gate, production-ready, good for review

---

### Option B: Modular Sub-Gates
**Effort**: Same total, split across time
**Output**: Smaller, independently reviewable gates

**Sub-gates**:
1. **V1-A-1**: Expense atomicity only (1-2 hours)
2. **V1-A-2**: Cash + Salary atomicity (1-2 hours)
3. **V1-A-3**: Lock wrappers + distributed lock (1-2 hours)
4. **V1-A-4**: Complete test suite (2-3 hours)

**Advantage**: Easier to review each piece
**Disadvantage**: More merge coordination needed

---

## What Each Piece Requires

### Cash Atomization (~30 min)
```
Files: lib/domain/finance/cash.ts
Changes:
  1. Remove appendCashAudit() function (line 158-198)
  2. Add buildCashAuditRow() helper (like expense)
  3. Add sheetIds() + requireSheetId() helpers
  4. Update requestCashMovement() (line 200-284):
     - Get audit sheet ID
     - Fetch audit headers
     - Build audit row with buildCashAuditRow()
     - Add to batch BEFORE batchUpdateSpreadsheet
     - Remove separate appendCashAudit() call
  5. Update decideCashMovement() (line 329-412):
     - Same pattern for decision state updates + audit
Operations affected: 2 (request + decide)
Risk: Low (same pattern as expense)
```

### Salary Atomization (~20 min)
```
Files: lib/domain/finance/salary.ts
Changes:
  1. Remove appendSheetValues import
  2. Remove appendSalaryAudit() function
  3. Add buildSalaryAuditRow() helper
  4. Add sheetIds() + requireSheetId() helpers
  5. Update paySalary():
     - Get audit sheet ID
     - Fetch audit headers
     - Build audit row
     - Add to batch
     - Remove separate appendSalaryAudit() call
Operations affected: 1 (paySalary)
Risk: Very low (single operation)
```

### Lock Wrappers (~20 min)
```
Files: lib/domain/finance/production.ts
Changes:
  1. Add withMutationLock wrapper to requestExpense():
     Key: finance:expense:${input.department}
  2. Add withMutationLock wrapper to decideExpense():
     Key: finance:expense:${departmentForWorkbook(input.workbook)}
  3. Add withMutationLock wrapper to payApprovedExpense():
     Key: finance:expense:${input.department}
  4. Add withMutationLock wrapper to requestCashMovement():
     Key: finance:cash:${input.department}
  5. Add withMutationLock wrapper to decideCashMovement():
     Key: finance:cash:${departmentForWorkbook(input.workbook)}
  6. Add withMutationLock wrapper to paySalary():
     Key: finance:salary:${staff.primaryDepartment}
Operations affected: 6 (all expense/cash/salary operations)
Risk: Low (copy payment lock pattern exactly)
Note: Distributed lock upgrade deferred to separate effort
```

### Test Suite (~2-3 hours)
```
Files: tests/finance*.test.ts (new)
Required Tests:

1. expenseAtomicityBatch.test.ts (30-45 min)
   - Audit row in batch for requestExpense
   - Audit row in batch for decideExpense
   - Audit row in batch for payApprovedExpense
   - Batch fails if audit headers missing
   - No separate appendSheetValues calls

2. cashAtomicityBatch.test.ts (30-45 min)
   - Audit row in batch for requestCashMovement
   - Audit row in batch for decideCashMovement
   - Batch fails if audit headers missing

3. salaryAtomicityBatch.test.ts (15-30 min)
   - Audit row in batch for paySalary
   - Batch fails if audit headers missing

4. concurrencyProtection.test.ts (30-45 min)
   - Concurrent expense requests serialize properly
   - Concurrent cash requests serialize properly
   - Concurrent salary payments serialize properly
   - Unrelated operations (different departments) run in parallel
   - No ID collisions under concurrent load

5. financeAuditRegression.test.ts (30 min)
   - Double-tap prevention (idempotency + lock)
   - Audit trail correctness (before/after values)
   - Permission enforcement unchanged
   - Business logic unchanged

Test Strategy:
- Mock batchUpdateSpreadsheet to capture requests
- Verify exact request composition
- Verify no appendSheetValues called
- Test concurrent execution
- Test error scenarios
```

---

## Verification Checklist

Before merge, V1-A must have:

- [ ] All atomicity changes complete (audit rows in batch, no separate calls)
- [ ] All lock wrappers applied (6 functions wrapped)
- [ ] Build succeeds (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] New tests cover:
  - [ ] Atomicity (5+ tests)
  - [ ] Concurrency (3+ tests)
  - [ ] Regression (3+ tests)
- [ ] No logic changes to business rules
- [ ] Idempotency preserved
- [ ] Error handling matches payment model
- [ ] PR body has required sections:
  - [ ] Summary
  - [ ] Changed files
  - [ ] Regression tests
  - [ ] Verification checklist
  - [ ] Rollback procedure

---

## Rollback Procedure

If V1-A needs to revert:
```bash
git revert <V1-A commit hash>
```

This will:
- Restore appendExpenseAudit/appendCashAudit/appendSalaryAudit functions
- Restore separate network calls to 20_Data_Audit
- Remove lock wrappers
- Remove tests

Result: Back to current production state (separate audit calls, no locks)

---

## Known Limitations (Deferred to PR #92d)

V1-A does NOT include:
- Distributed lock (still process-local)
- Supabase advisory lock implementation
- Redis implementation
- Multi-instance safety beyond locks

These are deferred to PR #92d after V1-A-4 tests pass.

---

## Recommendation

**Proceed with Option A** (Complete V1-A in One Push):

1. **Why**: All patterns are verified (expense works), scope is well-understood
2. **Risk**: Low (no new patterns, just replication)
3. **Benefit**: Single, cohesive gate easier to review than 4 separate gates
4. **Timeline**: Can complete within reasonable session window
5. **Quality**: More comprehensive test coverage in one pass

**Next Steps** (if V1-A completion approved):
1. Implement cash + salary atomization (50 min)
2. Add lock wrappers (20 min)
3. Write test suite (2.5 hours)
4. Verify build/lint/tests (30 min)
5. Create PR with required body (30 min)
6. Push branch (no merge yet, awaiting review)

---

*Status: V1-A Expense complete, ready for cash/salary/locks/tests*  
*Total effort for complete V1-A: ~5 hours*
*Branch: v1-a-core-data-integrity*
