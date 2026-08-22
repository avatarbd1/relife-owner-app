# Claude task — Relife artifact builder

You are the sandbox artifact builder. Complete the task in one pass and return one
handoff archive. Do not push, create a PR, merge, deploy, access credentials, or mutate
live Sheets/Supabase data.

## Immutable task packet

- Repository: `avatarbd1/relife-owner-app`
- Base SHA: `BASE_SHA`
- Task ID: `TASK_ID`
- Risk tier: `STANDARD_OR_HIGH`
- Required outcome: `ONE_BOUNDED_OUTCOME`
- Allowed changed files/areas: `ALLOWED_SCOPE`
- Canonical path to reuse: `EXISTING_ROUTE_DOMAIN_WRITER`
- Permission to reuse: `EXACT_WEBACTION_OR_NONE`
- Durable authority: `CURRENT_SHEETS_SUPABASE_AUTHORITY`
- Owner-approved issue: `ISSUE_OR_NONE`

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

- Required behavior: `BEHAVIOR`
- Required regression cases: `TEST_CASES`
- Required commands: `COMMANDS`
- Must remain unchanged: `BOUNDARIES`

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
node scripts/validate-claude-artifact.mjs relife-handoff --base-sha BASE_SHA
tar -czf relife-TASK_ID-handoff.tar.gz relife-handoff
sha256sum relife-TASK_ID-handoff.tar.gz
```

Return the archive and its SHA-256. Report only verified facts. If blocked, return a
blocked artifact with `BLOCKED.md` and no speculative patch.
