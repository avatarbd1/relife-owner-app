# V1-A Implementation Status

## Status

V1-A Core Data Integrity is code-complete on PR #92 and awaiting merge/deployment approval.

Current scope is limited to finance integrity and shared mutation locking. No Patient Hub, Chamber, Dental access, or product-surface work is included here.

## Completed

### Expense
- `requestExpense()` writes the expense row and audit row in one Google Sheets batch.
- `decideExpense()` writes status changes and audit in one batch.
- `payApprovedExpense()` writes payment state and audit in one batch.
- Separate `appendExpenseAudit()` / `appendSheetValues()` audit writes were removed.
- Audit schema is validated before the primary mutation.

### Cash Movement
- `requestCashMovement()` writes movement + audit in one batch.
- `decideCashMovement()` writes decision state + audit in one batch.
- Separate `appendCashAudit()` path was removed.
- Audit schema is validated before mutation.

### Salary
- `paySalary()` writes salary payment + audit in one batch.
- Separate `appendSalaryAudit()` path was removed.
- Audit schema is validated before mutation.

### Lock coverage
The production wrapper uses `withMutationLock()` for conflicting finance mutations:

- `requestExpense`: department scope for ID allocation.
- `decideExpense`: expense ID scope.
- `payApprovedExpense`: same expense ID scope as decision.
- `requestCashMovement`: department scope for ID allocation.
- `decideCashMovement`: movement ID scope.
- `paySalary`: staff ID scope.

Unrelated records remain able to execute concurrently.

### Distributed locking
`withMutationLock()` now uses a Supabase/Postgres lease lock in `required` mode.

Properties:
- fail-closed when distributed locking is required but unavailable;
- unique owner ID per acquisition;
- token-bound acquire / renew / release;
- stale lease takeover after expiry;
- bounded acquisition deadline with exponential backoff;
- heartbeat renewal for long-running external Google Sheets operations;
- process-local fallback only in explicit compatibility mode;
- lock RPCs restricted to the Supabase `service_role`.

The testable production algorithm lives in `lib/webos/mutationLockCore.ts`; `lib/webos/mutationLock.ts` provides the server-only environment/Supabase wrapper.

## Verification

Latest GitHub CI on the V1-A branch verifies:
- PR impact + user-flow gate: PASS
- lint: PASS
- domain tests: PASS
- build: PASS
- total tests: 134 PASS

The distributed-lock suite executes the production lock core rather than a copied lock implementation. It covers required-mode fail-closed behavior, compatibility gating, RPC errors, same-key serialization, different-key parallelism, callback failure release, unique owner identity, token validation, stale lease recovery, acquisition timeout, heartbeat renewal, and migration access restrictions.

## Deployment Preconditions

Do not merge/deploy V1-A until both are confirmed:

1. The Supabase migration `supabase/migrations/20260817_distributed_mutation_lock.sql` is applied to the production Supabase project.
2. Render has server-side values for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` before the new default `DISTRIBUTED_LOCK_MODE=required` code goes live.

The migration is additive and does not alter existing finance data. No fake production finance transaction is required for validation.

## Not Included in V1-A

- Patient/Access workflow consolidation (V1-B)
- Appointment/Chamber authority consolidation (V1-C)
- Product-surface/notification/PWA hardening (V1-D)

## Rollback Principle

If V1-A is merged and must be reverted, revert the complete PR merge rather than resetting shared `main`. If the Supabase lock migration was already applied, the unused lock table/functions may remain safely in place or be removed later with a dedicated migration; do not destructively roll back production finance data.

*Updated: 2026-08-18*
