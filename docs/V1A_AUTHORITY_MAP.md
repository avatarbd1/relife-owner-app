# V1-A Finance Authority Map

## Canonical Finance Boundary

All production finance writes continue through `lib/domain/finance/production.ts`.

| Domain | Canonical Sheets service | Primary Sheets | Audit | Lock scope |
|---|---|---|---|---|
| Payment | `payments.ts::createPayment()` | `02_Patients` + `06_Payments` | `20_Data_Audit` in same batch | `finance:payment:{department}:{patientId}` |
| Expense request | `expenses.ts::requestExpense()` | `07_Expenses` | `20_Data_Audit` in same batch | `finance:expense:{department}` |
| Expense decide/pay | `expenses.ts::decideExpense()` / `payApprovedExpense()` | `07_Expenses` | `20_Data_Audit` in same batch | `finance:expense:{expenseId}` |
| Cash request | `cash.ts::requestCashMovement()` | `21_Cash_Movement` | `20_Data_Audit` in same batch | `finance:cash:{department}` |
| Cash decide | `cash.ts::decideCashMovement()` | `21_Cash_Movement` | `20_Data_Audit` in same batch | `finance:cash:{movementId}` |
| Salary pay | `salary.ts::paySalary()` | `13_Salary` | `20_Data_Audit` in same batch | `finance:salary:{staffId}` |

Payment atomicity originated in PR #91. V1-A applies the same audit-integrity standard to Expense, Cash Movement, and Salary.

## Source of Truth

Google Sheets remains the current finance business-record authority for these write paths. Supabase finance operation recording remains controlled by the existing finance DB mode/shadow behavior in `production.ts`; V1-A does not silently switch finance record authority.

The new Supabase table is infrastructure-only and is authoritative only for distributed mutation lease state:

`public.distributed_mutation_lock`

It is not a finance ledger and does not replace any Sheet.

## Audit Contract

All finance audit rows use the existing `20_Data_Audit` schema. Each mutation validates the audit schema before its primary write and places the audit append into the same `spreadsheets.batchUpdate` request as the associated Sheet mutation.

This removes the previous split-write failure mode where primary finance data could succeed while the audit append failed independently.

## Lock Authority

`lib/webos/mutationLock.ts` is the server-only public lock entry point.

`lib/webos/mutationLockCore.ts` contains the testable distributed lease algorithm.

Production/default mode:
- `DISTRIBUTED_LOCK_MODE=required`
- requires Supabase server credentials;
- fails closed if distributed lock acquisition cannot be performed;
- does not silently fall back to process-local locking.

Compatibility mode:
- `DISTRIBUTED_LOCK_MODE=compatibility`
- process-local fallback additionally requires `ENABLE_PROCESS_LOCAL_LOCK_FALLBACK=true`;
- intended only for explicit local/test/single-instance compatibility.

## Distributed Lease Semantics

The Supabase migration provides:
- `acquire_distributed_lock(text, text, int)`
- `renew_distributed_lock(text, text, uuid, int)`
- `release_distributed_lock(text, text, uuid)`
- `cleanup_expired_locks()`

Safety properties:
- unique owner identity per acquisition;
- token-bound ownership;
- expired lease recovery;
- no reentrant ownership based solely on Render instance identity;
- bounded acquisition deadline and exponential backoff;
- 120-second lease with periodic heartbeat renewal;
- renew/release require the current owner + token;
- expired leases cannot be renewed;
- direct table access and RPC execution are revoked from `PUBLIC`, `anon`, and `authenticated`;
- RPC execution is granted to `service_role` only.

The longer lease provides margin for external Google Sheets network operations while heartbeat renewal keeps a valid long-running operation's lease fresh.

## Lock Scope Rationale

### Creation scopes
Expense and Cash request creation allocate IDs from department-level existing state. These paths therefore serialize by department so two concurrent creators cannot read the same ID set and allocate the same next identifier.

### Existing-record scopes
Expense decision/payment and Cash decision operate on one known record and use that record ID as the lock key. Different records can mutate concurrently.

### Salary scope
Salary payment is staff-scoped to prevent conflicting/duplicate payment activity for the same staff member while allowing unrelated staff payments to proceed independently.

## Required Production Order

Before merging/deploying V1-A:

1. Apply `supabase/migrations/20260817_distributed_mutation_lock.sql` to the production Supabase project.
2. Confirm Render has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side.
3. Merge PR #92 only after GitHub CI is green.
4. Allow Render auto-deploy from `main` and verify the deployed commit.

Do not deploy the new `required` lock code before the RPC migration exists.

## V1-A Verification

The current V1-A branch passes:
- impact/user-flow gate;
- lint;
- 134 domain/regression tests;
- production build.

No fake live finance write is required for this verification.
