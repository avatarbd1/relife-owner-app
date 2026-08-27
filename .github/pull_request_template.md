## Change summary

What changed and why:

Risk tier: STANDARD

## Impacted areas

Check only real impact. Runtime PRs require at least one runtime area.

- [ ] Patient / patient file / reports
- [ ] Appointment / schedule / Chamber
- [ ] Finance: payment / expense / cash / salary
- [ ] Clinical: assessment / treatment / dental / AI
- [ ] Role / authorization / authentication
- [ ] Google Sheets / data contract / cache
- [ ] Supabase / Edge Function / database / storage
- [ ] Notifications / chat / PWA
- [ ] Reports / analytics / dashboard totals
- [ ] Inventory / staff / settings / admin
- [ ] No runtime impact (docs/tests/process only)

## Canonical-path review

Existing-path search: `command plus relevant result`
Canonical path reused: `route/domain/writer`
Permission reused: `exact WebAction, or none for a read-only/process change`
Authority or writer changed: NO
Owner-approved issue: N/A
Dual-writer impact: `none, preserved, reduced, or approved cutover`

High-risk PRs also state which migration-audit section changed.

## Automated verification

- `command` — result

## User-flow validation

User-flow tested: DEFERRED (Draft)
Roles tested: Not yet tested
Device/context: Not yet tested
Scenario: Not yet tested
Actual result: Not yet tested
Evidence: Draft verification pending

Docs/tests/process-only PRs use `User-flow tested: N/A (docs/tests only)`.
Before a runtime PR is ready for review, replace the Draft values with actual evidence and `User-flow tested: YES`.

## Live verification

Live verified: NO
Production evidence: Not performed before merge/deployment

## Rollback

Rollback procedure: Revert the PR merge commit, then rerun the listed verification.
Data rollback needed: No; update this if the change mutates data or schema.
