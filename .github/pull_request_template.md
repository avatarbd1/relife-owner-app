## Change summary
Describe exactly what changed and why.

## Impacted areas
Check every area that can be affected directly or indirectly.

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
- [ ] No runtime impact (docs/tests only)

## Regression impact review
- [ ] I checked upstream callers and downstream consumers of the changed code.
- [ ] I checked role and department access impact.
- [ ] I checked data-write/read compatibility and historical data impact.
- [ ] I checked finance totals/reconciliation impact when money or counts can change.
- [ ] I checked appointment/Chamber resource conflicts when scheduling can change.
- [ ] I checked patient-file/report visibility when patient data can change.
- [ ] I checked PWA/navigation/notification behavior when user flow can change.

## Automated verification
Tests run and result:

`<command/test name + result>`

## User-flow validation
For application/runtime changes this section is mandatory.

User-flow tested: NO
Roles tested: `<Owner / Manager / Receptionist / Therapist / Dentist / Dental Assistant / Auditor / System Admin>`
Device/context: `<installed Android PWA / browser / production-like environment>`
Scenario: `<start → actions → expected result>`
Actual result: `<what actually happened>`
Evidence: `<safe screenshot/log/test reference>`

For docs/tests-only changes use: `User-flow tested: N/A (docs/tests only)`.

## Live verification
Live verified: NO
Production evidence: `<safe timestamp/log/screenshot/reference or N/A before merge if deployment follows merge>`

## Rollback
Rollback procedure: `<exact revert/feature-disable/data-safe rollback steps>`
Data rollback needed: `<yes/no + method>`

## Sign-off rule
Do not merge a runtime change while `User-flow tested: NO` remains. A code change is not considered complete only because CI/build is green.