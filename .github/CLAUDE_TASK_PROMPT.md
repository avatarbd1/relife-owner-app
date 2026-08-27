# Claude task — Relife Tenant #1 artifact builder

You are the sandbox artifact builder. Complete this task in **one pass** and return one
handoff archive. Do not push, create a PR, merge, deploy, access credentials, or mutate
live Sheets/Supabase/Render data.

## Immutable task packet

- Repository: `avatarbd1/relife-owner-app`
- Base SHA: `9598281a08a932509317f456244837ede96ca6f4`
- Task ID: `issue-166-relife-tenant1-cutover`
- Risk tier: `HIGH`
- Required outcome: `Convert the existing Owner Web/PWA authorization boundary into Relife Tenant #1 using the existing organizations/clinics model, preserving current ST001 signed-session identity and existing business-writer authority.`
- Owner-approved issue: `https://github.com/avatarbd1/relife-owner-app/issues/166`
- Canonical tenant model: `relife.organizations = Tenant; relife.clinics = tenant-owned clinic/branch/chamber.`
- Canonical current identity: `signed staff session -> ST001 for Owner -> live staff directory role/department truth.`
- Allowed areas: `existing tenancy migrations/domain; server-side current-user authorization boundary; one protected Supabase Edge tenant resolver; tenancy/authorization tests; migration/audit/canonical documentation required by this cutover.`
- Existing authority to preserve: `Google Sheets remains the verified Relife operational authority where documented; Supabase is used for tenant metadata/governance/approved protected ledgers. Do not invent a second patient/appointment/clinical/finance writer.`

## Invariants

1. Read `AGENTS.md`, `CLAUDE.md`, `MIGRATION_AUDIT.md`, `TENANCY.md`, `docs/CANONICAL_PATH_REGISTRY.md`, and `docs/RELIFE_ENGINE_LITE.md` before editing.
2. Reuse `relife.organizations`, `relife.clinics`, and the existing private `relife` schema; do not create a duplicate `tenants` table.
3. Preserve existing Owner PIN/passkey/signed-session behavior. Do not create a fake `auth.users` row for ST001.
4. Role and Department remain separate dimensions. Preserve existing department isolation and WebRole permissions.
5. Missing, inactive, or ambiguous tenant resolution must fail closed. Never silently default a new tenant-aware path to Relife UUIDs.
6. No Clinic #2 activation in this task.
7. No per-clinic Supabase project, Render service, repository, or infrastructure provisioning.
8. Analytics hooks are private/pseudonymous only; no research/commercial export activation.
9. Preserve mutation locks, idempotency, audit semantics, and all finance invariants.
10. Use one shared server authorization boundary for the Owner cutover rather than creating parallel per-module auth engines.
11. Production activation must be feature-gated so source can merge before the production DB/Edge dependency is live. The gate defaults OFF.
12. Claude must not claim commit/push/PR/merge/deploy/production mutation; those actions belong to Codex/Owner control plane.

## Phase-1 operating guardrails

- Structured/text clinical data first; unnecessary image/PDF uploads avoided.
- One patient master; follow-ups are encounters/sessions.
- Normalize essential fields; bounded/versioned JSON only where justified.
- Reports/history are paginated.
- Realtime only where materially useful.
- Audit meaningful security/clinical/finance/consent/export/admin events, not UI noise.
- Tenant-aware indexes lead tenant-scoped access paths where appropriate.
- Binary file bytes stay out of PostgreSQL rows.
- One shared deployment/runtime.
- Tenant onboarding is an application operation, not infrastructure provisioning.

## Acceptance contract

Required behavior:

1. Add an additive multi-tenant kernel around existing `organizations`/`clinics`, including multi-role/multi-department mappings, fail-closed tenant helpers, metadata RLS, consent/provenance/retention/access-audit hooks, and a private analytics-ready schema without direct patient identifiers.
2. Add a private bridge from current stable staff identity to canonical organization/clinic. Seed `ST001` by resolving the existing active `relife` organization and `amtali-main` clinic by slug; do not hard-code generated UUIDs.
3. The bridge may carry nullable future `auth_user_id`; it must not insert into `auth.users`.
4. Add a protected server-to-server tenant-context Edge resolver using the same reviewed shared-secret boundary pattern as existing protected Relife Edge functions.
5. Add a server-only Next adapter that validates the response and has no implicit Relife fallback.
6. Add `RELIFE_TENANT_CUTOVER_ENFORCED` with default-off semantics. When true, every Owner identity/access resolution must require a valid tenant binding before downstream Owner operations continue. Non-Owner staff must not be broken by this Owner-only cutover task.
7. Keep explicit tenant-context helpers available for future domain migrations.
8. Regression tests must prove no fake Auth user, no generated UUID hard-code, exactly one active default binding, fail-closed missing/ambiguous binding, custom server authentication, no direct identifiers in analytics facts, System Admin non-escalation, and Owner boundary enforcement behind the cutover flag.

Required commands:

```bash
npm test
npm run lint
npm run build
node scripts/validate-claude-artifact.mjs relife-handoff --base-sha 9598281a08a932509317f456244837ede96ca6f4
```

## Required output

Create `relife-handoff/` exactly as defined in `docs/RELIFE_ENGINE_LITE.md`:

- `HANDOFF.json`
- `changes.patch`
- `REVIEW.md`
- `evidence/tests.txt`
- `evidence/lint.txt`
- `evidence/build.txt`

The manifest must set:

- `riskTier: "high"`
- `authorityChanged: true`
- `newCanonicalWriter: false`
- `ownerIssue: "#166"`
- every `actions.*` field to `false`

Package only after validation:

```bash
tar -czf relife-issue-166-tenant1-handoff.tar.gz relife-handoff
sha256sum relife-issue-166-tenant1-handoff.tar.gz
```

Return only verified facts. If source evidence shows the task cannot be completed safely,
return a truthful blocked artifact with `BLOCKED.md` and no speculative patch.
