# Claude task — Relife artifact builder

You are the sandbox artifact builder. Complete the task in one pass and return one
handoff archive. Do not push, create a PR, merge, deploy, access credentials, or mutate
live Sheets/Supabase data.

## Immutable task packet

- Repository: `avatarbd1/relife-owner-app`
- Base SHA: `649c9185340f46d70398dd9404384d12e76b390c`
- Task ID: `issue-159`
- Risk tier: `HIGH`
- Required outcome: `Add deterministic monthly roster generation plus ID-scoped, budget-capped RC finalization for the seven approved staff IDs.`
- Allowed changed files/areas: `Existing workforce shift domain/routes/UI/tests; existing gamification config/rules/finalizer/Edge Functions/migrations/tests; canonical docs required by the approved schema or route extension.`
- Canonical path to reuse: `lib/domain/workforce/shifts.ts -> app/api/workforce/shifts/** -> /workforce; existing performance_events/weekly_performance/reward_credit_ledger and relife gamification finalizer paths.`
- Permission to reuse: `shift.manage and performance.weekly.finalize; no new WebAction.`
- Durable authority: `Google Sheets Staff_Shifts for planned roster; Supabase relife schema append-only reward_credit_ledger for RC.`
- Owner-approved issue: `https://github.com/avatarbd1/relife-owner-app/issues/159`

## Invariants

1. Read `AGENTS.md` and the relevant source before editing.
2. Search for existing routes, actions, writers, readers, locks, audits, and tests.
3. Do not create a parallel route, writer, store, permission, or business engine.
4. Preserve department isolation, authorization, durable locking, idempotency, audit,
   historical data compatibility, and existing authority.
5. High-risk work must review the migration audit and canonical registry.
6. Do not change schema, writer authority, or production configuration unless the task
   packet explicitly authorizes it through the named issue.

## Acceptance contract

- Required behavior: `Preview and atomically apply a Published monthly roster with the approved role hours, ST004 12:00-18:00 override, and staggered weekly half-days. Enforce the exact ST002/ST003/ST004/ST005/ST008/ST010/ST011 gamification cohort by Staff_ID. Finalize a month only from complete official role-normalized scores and published shift opportunity, using RC tiers 90/80/70/60 -> 22/18/14/8, monthly budget cap 160 RC, individual cap 22 RC, and 6 RC reserve.`
- Required regression cases: `Invalid month, inactive/mismatched staff, overlap, Approved leave, duplicate request, roster determinism, half-day staggering, excluded IDs, incomplete metrics, missing Published roster, tie determinism, per-person cap, total cap, and finalizer idempotency all fail closed or remain stable as specified.`
- Required commands: `npm test; npm run lint; npm run build; node scripts/validate-claude-artifact.mjs relife-handoff --base-sha 649c9185340f46d70398dd9404384d12e76b390c`
- Must remain unchanged: `No leave accrual/carry/encashment or salary mutation; no attendance mutation; no new authority store/writer/RBAC action; no production credential access, live Sheets/Supabase mutation, deploy, or merge.`

## Required output

Create `relife-handoff/` exactly as defined in `docs/RELIFE_ENGINE_LITE.md`:

- `HANDOFF.json`
- `changes.patch`
- `REVIEW.md`
- `evidence/tests.txt`
- `evidence/lint.txt`
- `evidence/build.txt`

Run:

```bash
node scripts/validate-claude-artifact.mjs relife-handoff --base-sha 649c9185340f46d70398dd9404384d12e76b390c
tar -czf relife-issue-159-handoff.tar.gz relife-handoff
sha256sum relife-issue-159-handoff.tar.gz
```

Return the archive and its SHA-256. Report only verified facts. If blocked, return a
blocked artifact with `BLOCKED.md` and no speculative patch.
