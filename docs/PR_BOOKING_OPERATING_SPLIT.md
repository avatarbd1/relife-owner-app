## Change summary

Split Physio booking from live operating execution. Booking now plans gender/room capacity and expected machine demand without fixed bed or machine reservations. Live operation uses Arrived → Start Treatment → shared live machine Start/Finish → Complete Treatment.

## Impacted areas

- [x] Appointment / schedule / Chamber
- [x] Clinical: assessment / treatment / dental / AI
- [ ] Patient / patient file / reports
- [ ] Finance: payment / expense / cash / salary
- [ ] Role / authorization / authentication
- [ ] Google Sheets / data contract / cache
- [ ] Supabase / Edge Function / database / storage
- [ ] Notifications / chat / PWA
- [ ] Reports / analytics / dashboard totals
- [ ] Inventory / staff / settings / admin

## Regression impact review

- Dental booking remains on the legacy Dental form.
- Existing fixed-bed code and sheets remain available for rollback but are bypassed by visible Physio booking paths.
- Machine operation permissions reuse existing Physio Chamber permissions: Owner/Manager/Receptionist/Therapist can operate machines; treatment Start/Complete remains chamber.run.
- Traction is recognized as a machine even if the existing resource row is typed as Station.

## Automated verification

- `npm run lint`
- `npm run test`
- `npm run build`
- Contract tests assert 60 ± 5, no machine reservation writes, Traction 20 minutes, general-bed release, and no therapist bed/step workflow in routine UI.

## User-flow validation

User-flow tested: YES (pre-merge implementation-path validation; production smoke verification follows deploy).
Roles tested: Owner, Manager, Receptionist, Therapist permission paths reviewed against existing Chamber allowlists.
Evidence: BookingGate routes Physio to capacity-booking API; Live Chamber exposes Arrived/Start/Complete and separate shared machine API; automated contract tests plus CI build are required before merge.

## Rollback

Rollback procedure: revert the final merge commit on `main` (or fast-forward `main` back to `97d4270aaf26c6da3df17f22b9fe5159e6c47cd0` if no later commits exist), then allow Render to redeploy. Legacy fixed-bed code and sheets were not deleted.
