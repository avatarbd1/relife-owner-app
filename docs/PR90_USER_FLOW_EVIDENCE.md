# PR #90 user-flow evidence

Scope: payment creation only.

Validated behavior:
- Same-patient payment mutations are serialized through a patient-scoped mutation lock before the Sheets read/check/write path runs.
- Patient Paid/Due/Payment_Status updates and the payment ledger append remain in one Google Sheets batch request.
- Existing request-id idempotency behavior is preserved.
- Different patient IDs use different lock keys, so unrelated patient payments are not globally serialized.

Roles covered by the unchanged payment-create access model: OWNER and RECEPTIONIST. This PR does not change authorization rules.

Automated evidence: `tests/paymentConcurrency.test.ts`.

Known boundary: the lock is process-local. Multi-instance/distributed locking remains explicitly deferred to PR #92.

Rollback: revert PR #90 merge commit. This restores the pre-PR payment execution path without changing Sheet schema or existing payment data.
