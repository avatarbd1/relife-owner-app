# Relife Engine Lite — mandatory workflow

`docs/RELIFE_ENGINE_LITE.md` is the execution contract.

## Roles

- Claude is an artifact builder. It may inspect, edit, and test in its sandbox, then returns one validated handoff artifact. It must not push, open a PR, merge, deploy, use credentials, or mutate production data.
- Codex is the integrator. It writes the task prompt, verifies the artifact against fresh `main`, reviews the diff, reruns checks, commits, opens a Draft PR, and reports exact CI state.
- The Owner decides when a PR becomes ready and when it merges or deploys.

## Before runtime code

1. Start from latest `main` and read the relevant source before editing.
2. Search for the existing route, action, writer, reader, lock, audit, and tests.
3. Reuse `docs/CANONICAL_PATH_REGISTRY.md`; never add a parallel business path.
4. Verify `WebAction` values in `lib/webos/access.ts`; never invent permissions.
5. Preserve Sheets/Supabase authority unless an Owner-approved issue explicitly changes it.
6. Keep production writes on durable locking, idempotency, authorization, department scope, and audit paths. Process-local state is not production persistence.

## Risk gate

- **Standard:** UI, read-only behavior, bounded bug fixes, tests, and documentation. Record concise search evidence in the PR.
- **High:** finance semantics, authentication/authorization, a writer, schema/RLS, authority, migration/cutover, or production mutation. Review `CLAUDE.md`, `MIGRATION_AUDIT.md`, and the canonical registry; update durable audit evidence when the decision changes.
- If authority or the canonical path is uncertain, stop with a blocker artifact. Do not code speculatively.

## Publication gate

- One task produces one artifact, one branch, and one Draft PR.
- Claude claims are evidence only; Codex independently reruns applicable tests, lint, and build.
- Draft PRs may defer manual user-flow evidence. Ready-for-review runtime PRs may not.
- Never claim merged, deployed, live, or production-verified from sandbox tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
