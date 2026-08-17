# Relife Clinic OS — Production Closure Checklist

Status flow: `🔴 Open → 🟡 In progress → ✅ Done + tested + live verified`

A critical item is only considered closed when all three gates pass:

1. Automated/unit test
2. Real user-flow test on a clinic device
3. Live production verification with evidence

For every production change, record rollback steps before deployment.

---

## P0 — Must close first

### P0-01 Physio workbook timezone
**Status:** 🔴 Open

**Goal:** Physio Google Sheet timezone must match the application canonical timezone: `Asia/Dhaka`.

**Verification criteria**
- Backup created before change.
- Workbook timezone = `Asia/Dhaka`.
- `TODAY()`, `NOW()`, daily totals, month boundary, appointment date and finance dashboard checked.
- No historical rows shifted or rewritten unexpectedly.

**Evidence**
- Automated/unit: ☐
- Device/user-flow: ☐
- Production verified: ☐
- Evidence link/log/screenshot: _TBD_

**Rollback:** Restore previous workbook copy / timezone setting and re-run formula checks.

**Sign-off:** _Who:_ ___  _Date:_ ___

### P0-02 Finance reconciliation — Payments
**Status:** 🔴 Open

**Verification criteria**
- Create payment → receipt/history correct.
- Correction does not overwrite audit history.
- Void is non-destructive and traceable.
- Patient due, daily register, department totals and month totals reconcile.
- No double count between original/corrected/voided entries.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Revert deploy; preserve ledger rows; repair by compensating/audit entry only.
**Sign-off:** ___ / ___

### P0-03 Finance reconciliation — Expenses
**Status:** 🔴 Open

**Verification criteria**
- Request → approve/reject → pay lifecycle is auditable.
- Rejected items never affect paid expense totals.
- Expense pay cannot create duplicate cash reduction.
- Department allocation and month totals reconcile.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Revert deploy; never hard-delete financial history.
**Sign-off:** ___ / ___

### P0-04 Finance reconciliation — Cash custody
**Status:** 🔴 Open

**Verification criteria**
- Reception → Home Treasury is a transfer, not expense.
- Requested/pending movement does not change accepted balance.
- Accepted movement changes source/destination exactly once.
- Reception, Home Treasury and Digital/Bank totals reconcile with movement history.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Revert deploy; use compensating movement if a live correction is required.
**Sign-off:** ___ / ___

### P0-05 Finance reconciliation — Salary
**Status:** 🔴 Open

**Verification criteria**
- Fixed commitment, advance, paid and due remain separate.
- Salary payment history is append-only/auditable.
- Owner compensation policy is not accidentally included in staff fixed salary.
- Department and monthly totals reconcile.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Revert deploy; correct with explicit adjustment entry.
**Sign-off:** ___ / ___

### P0-06 Chamber real-time scheduling engine
**Status:** 🔴 Open

**Goal:** Booking time is planning data; treatment runtime starts when the patient is actually received.

**Verification criteria**
- Receive time starts actual queue/runtime.
- Bed, therapist and machine availability are checked independently.
- Sequential treatment steps allocate in order without overlapping the same resource.
- Patient can wait, shift bed/resource or continue when a resource becomes available.
- No impossible treatment time generated from stale/fixed booking slots.
- Test at least 10 concurrent patients with constrained beds/therapists/machines.
- No double-booking across appointment, chamber session and machine reservation layers.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Feature flag/revert to last known scheduler; preserve appointments and runtime history.
**Sign-off:** ___ / ___

---

## P1 — Reliability and access closure

### P1-01 Patient report storage E2E
**Status:** 🔴 Open

**Verification criteria**
- Camera upload succeeds to private Supabase Storage.
- Gallery/PDF upload succeeds.
- Metadata appears in patient file.
- Authorized user can open/download; unauthorized department cannot.
- Failure leaves no orphan metadata or misleading success state.
- Legacy Drive/Telegram reports remain readable.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Revert application release; do not re-enable new Drive writes without explicit decision.
**Sign-off:** ___ / ___

### P1-02 Render stream error root cause
**Status:** 🔴 Open

**Verification criteria**
- `The destination stream closed early` mapped to route/action/request type.
- Client disconnect vs server bug distinguished.
- Reproduction case documented if application-related.
- Error frequency after fix is monitored and acceptable.

**Evidence:** Automated ☐ Reproduction ☐ Live logs ☐  Link: _TBD_
**Rollback:** Revert offending deploy / disable affected streaming path.
**Sign-off:** ___ / ___

### P1-03 Staff chat notification lifecycle
**Status:** 🔴 Open

**Verification criteria**
- New message/task increments badge once.
- Open/read state clears unread badge correctly.
- Completed/dismissed task notification does not remain sticky.
- Refresh/relogin does not resurrect cleared notifications.
- High-volume test does not accumulate duplicate popups.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Disable popup layer while retaining chat/message history.
**Sign-off:** ___ / ___

### P1-04 Role-by-role screen audit
**Status:** 🔴 Open

**Roles:** Owner, Manager, Receptionist, Therapist, Dentist, Dental_Assistant, Auditor, System Admin.

**Verification criteria**
- Each role sees only intended navigation/screens/actions.
- Hidden UI is matched by server-side authorization; direct URL/API cannot bypass access.
- Physio/Dental isolation verified with real accounts.
- Financial amount visibility matches policy.
- Clinical write assignment/cross-cover rules verified.

**Evidence:** Automated ☐ Device matrix ☐ Live ☐  Link: _TBD_
**Rollback:** Revert access-policy change; fail closed.
**Sign-off:** ___ / ___

### P1-05 Dental Assistant role
**Status:** 🔴 Open

**Verification criteria**
- Explicit allowlist approved.
- Dental-only scope enforced.
- Required home/menu/screens work without ACCESS_DENIED loops.
- No Physio clinical or finance leakage.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Restore zero-permission fail-closed role.
**Sign-off:** ___ / ___

### P1-06 Login brute-force protection
**Status:** 🔴 Open

**Verification criteria**
- Repeated bad PIN attempts are throttled/locked server-side.
- Legitimate user recovery path works.
- Rate-limit state cannot be bypassed trivially by route refresh.
- Security events are logged without storing PIN values.

**Evidence:** Unit ☐ Security test ☐ Live ☐  Link: _TBD_
**Rollback:** Revert limiter while retaining authentication; monitor abuse.
**Sign-off:** ___ / ___

### P1-07 Sensitive-action re-authentication
**Status:** 🔴 Open

**Scope:** payment void/correction, salary payment/adjustment, staff access change, settings/security change and other owner-only destructive actions.

**Evidence:** Unit ☐ User-flow ☐ Live ☐  Link: _TBD_
**Rollback:** Revert step-up auth requirement if it blocks clinic operations.
**Sign-off:** ___ / ___

### P1-08 Chamber code-path consolidation
**Status:** 🔴 Open

**Verification criteria**
- One authoritative scheduler/runtime owns booking/resource decisions.
- Legacy fixed-hour/hourly modules are retired or adapters only.
- No duplicate business rules across `lib/webos` and `lib/domain`.

**Evidence:** Tests ☐ Architecture review ☐ Live ☐  Link: _TBD_
**Rollback:** Revert consolidation commit; preserve data contracts.
**Sign-off:** ___ / ___

---

## P2 — Data, resilience and operational hardening

### P2-01 Patient duplicate policy
**Status:** 🔴 Open

**Verification criteria:** One documented rule for ID/name/phone/age matching; Physio and Dental behave consistently; intentional duplicate override is auditable.

### P2-02 Dental phone optional consistency
**Status:** 🔴 Open

**Verification criteria:** UI, API and Sheet persistence all allow Dental registration without phone; Physio policy remains unchanged unless explicitly approved.

### P2-03 Stale-data/freshness indicator
**Status:** 🔴 Open

**Verification criteria:** When stale Sheet cache is served, Finance/Clinical screens show last-updated/freshness state instead of silently presenting cached data as current.

### P2-04 Receptionist permission review
**Status:** 🔴 Open

**Decisions required:** `expense.pay`, `inventory.write`, and any other high-impact action. Final policy must be documented and regression-tested.

### P2-05 Supabase database hardening
**Status:** 🔴 Open

**Verification criteria**
- Add/review covering index for `relife.finance_operations.organization_id`.
- Document intentional RLS-no-policy/server-only design.
- Do not remove currently-unused indexes until enough production workload exists to justify it.

### P2-06 Structured production logging
**Status:** 🔴 Open

**Verification criteria:** Request ID, route/action, safe staff identifier, department, error code and latency are captured; secrets and patient-sensitive payloads are excluded.

### P2-07 Backup automation and restore drill
**Status:** 🔴 Open

**Verification criteria**
- Scheduled Sheet export/backup exists.
- Supabase backup/recovery path documented.
- At least one restore drill is completed and timed.
- Recovery target and responsible person documented.

### P2-08 Source-of-truth map
**Status:** 🔴 Open

Document every major entity as one of:
- Sheets authoritative
- Supabase authoritative
- Legacy/read-only
- Transitional dual-read/controlled-write

Include patients, appointments, chamber runtime, reports/media, finance, staff/access, attendance, inventory and clinical data.

### P2-09 Clinical AI privacy gate
**Status:** 🔴 Open

**Verification criteria:** Minimum-necessary data only, department scope enforced, unnecessary full-sheet/full-patient export prevented, audit/consent policy documented.

---

## P3 — Release closure

### P3-01 Device and failure-mode matrix
**Status:** 🔴 Open

Test Android installed PWA and browser for:
- small screen / large font
- keyboard open
- camera/gallery/PDF picker
- slow network / reconnect
- refresh/back button
- double tap/repeated submit
- expired session
- permission change during active session
- Supabase/Sheets temporary failure

### P3-02 Documentation refresh
**Status:** 🔴 Open

Update README and architecture docs with current modules, deployment, environment variables, role model, storage model, data ownership, backup, recovery and rollback.

### P3-03 Legacy cleanup
**Status:** 🔴 Open

Retire obsolete routes, legacy owner-session compatibility when safe, old Drive write code and duplicate scheduler/business-rule paths.

### P3-04 Final production sign-off
**Status:** 🔴 Open

Release is complete only when:
- All P0 items = ✅
- All P1 items = ✅
- No unresolved production-blocking P2 item
- Full regression suite passes
- Latest Render deploy healthy
- Supabase advisors reviewed
- Finance reconciliation signed off
- Backup restore drill passed
- Owner/staff critical workflows verified on real devices

**Final sign-off**
- Owner: ___ Date: ___
- Technical verifier: ___ Date: ___
- Release commit/deploy: ___

---

## Evidence template

Use this block under an item when closing it:

```text
Status: ✅ Done + tested + live verified
Implementation: <PR/commit>
Automated test: <test name/result>
User-flow test: <device/account/scenario>
Live verification: <timestamp + safe log/screenshot reference>
Data reconciliation: <result if applicable>
Rollback tested/documented: yes/no
Verified by: <name>
Date: <YYYY-MM-DD>
Notes: <remaining non-blocking observations>
```

## Change rule

Do not mark an item ✅ because code was merged. A production closure item is ✅ only after test evidence and live verification are recorded.