# Relife Owner App — local agent entrypoint

Cross-repo AI/process/release-control rules are centralized in `avatarbd1/multi-ai-commander` under `docs/RELIFE_PROGRAM_CONTROL.md` and the active Program Control issue.

This repository keeps only product-local safety boundaries:

1. Read current `main`, relevant product docs, active issue/PR, and source before editing.
2. Reuse the existing canonical route/domain/reader/writer; do not create a parallel business path.
3. Use `docs/CANONICAL_PATH_REGISTRY.md` for product path ownership and `MIGRATION_AUDIT.md` for authority/cutover risk.
4. Verify permissions from `lib/webos/access.ts`; do not invent role capabilities.
5. Preserve current Sheets/Supabase authority unless an Owner-approved product issue explicitly changes it.
6. Financial, clinical, security, tenancy, schema/RLS, writer, migration and cutover changes fail closed when authority is uncertain.
7. Application changes use a fresh branch and Draft PR; Builder does not self-approve.
8. Product-specific acceptance criteria and live evidence stay in this repository.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
