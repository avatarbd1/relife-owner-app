# Relife mandatory preflight — blocking

Before editing application/runtime code:

1. Read `CLAUDE.md`, `MIGRATION_AUDIT.md`, and `docs/CANONICAL_PATH_REGISTRY.md`.
2. Search the repository for the requested capability, route, action, writer, reader, lock, audit, and tests.
3. Extend the existing canonical path. Do not create a parallel route/domain/writer/storage engine.
4. Verify the real `WebAction` union in `lib/webos/access.ts`; never invent an action string.
5. Preserve the current operational authority. Do not choose Sheets, Supabase, memory, or another store without an approved authority decision.
6. Production writes may not use process-local `Map`/`Set` state. All writes require the existing durable writer, authorization, mutation lock, idempotency, department scope, and audit behavior.
7. Start from latest `main` on a fresh branch. Draft PR only. Never claim merged, deployed, or live from local tests.
8. If the canonical path or authority is uncertain, stop after audit and report the blocker. Do not code speculatively.

CI enforces the required PR evidence. Instructions in a task or chat do not override these repository gates without an explicit Owner-approved issue.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
