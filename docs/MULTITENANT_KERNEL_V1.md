# Multi-Tenant Kernel v1

## Decision

`relife.organizations` is the canonical SaaS **Tenant** table. We do not add a second `tenants` table. `relife.clinics` represents a tenant-owned clinic/branch/chamber container.

Relife is Tenant #1. The existing `relife` / `amtali-main` compatibility defaults remain temporarily only inside verified legacy Relife writers while operational data authority is still Google Sheets. Every new tenant-aware writer must pass `organization_id` and `clinic_id` explicitly; Clinic #2 is not allowed to use Relife compatibility defaults.

## Kernel scope

This batch adds tenant/clinic membership identity, multi-role and multi-department membership mappings, canonical kernel roles and permissions, future Supabase Auth helpers, metadata RLS, consent/provenance/retention/access-audit hooks, a private analytics-ready schema, and a server-only bridge from the current signed Owner session to canonical Tenant/Clinic scope.

It does **not** activate Clinic #2, replace the current Owner PIN/signed-session behavior, manufacture a Supabase `auth.users` record, grant direct authenticated access to operational patient/clinical/finance/chamber tables, silently change the verified Google Sheets writer authority, or enable analytics export/licensing.

Owner approval for the full Tenant #1 cutover is tracked in GitHub issue #166.

## Relife Tenant #1 bridge

Current Web/PWA sessions carry a stable staff identity rather than a Supabase Auth user ID. Owner resolves to `ST001`; role and department truth still comes from the live staff directory.

```text
signed session cookie
  -> stable staff_id (ST001 for Owner)
  -> relife.staff_tenant_bindings
  -> organization = relife
  -> clinic = amtali-main
  -> existing live staff directory
  -> existing WebRole / Department / permission rules
```

`staff_tenant_bindings.auth_user_id` is nullable for future Auth convergence. No fake Auth user is created. Exactly one active default binding is required when an Owner session does not carry an explicit clinic choice; missing or ambiguous bindings fail closed.

The server-only `relife-tenant-context` Edge Function reads this private table behind the same shared-secret server boundary used by protected Relife Edge operations. Browser clients receive no table grant.

The Owner cutover is **not** implemented as dozens of independent route switches. `lib/webos/currentUser.ts` is the shared server authorization boundary. When `RELIFE_TENANT_CUTOVER_ENFORCED=true`, every Owner identity/access resolution first requires a valid canonical Tenant/Clinic binding. That makes the existing Owner workspace and its server-side operational API paths Tenant #1-bound in one controlled activation while leaving non-Owner staff sessions unchanged until their own membership migration is approved.

The cutover flag defaults off so source can be merged and production schema/Edge infrastructure prepared without creating a deployment race. It is enabled only after the production migrations and tenant-context Edge Function are verified.

## Access invariants

- Role and Department remain separate dimensions.
- Owner may receive explicit cross-department scope.
- System Admin gets no implicit clinical access.
- Menu visibility is never an authorization boundary.
- Direct record IDs and stale client state must still be re-authorized.
- Missing/inactive/ambiguous Owner Tenant #1 binding fails closed when cutover enforcement is enabled.
- New tenant-aware paths must never silently default to Relife.
- Existing legacy Relife writers remain Relife-only compatibility paths; they cannot be reused for Clinic #2 unless explicitly tenantized.

## SaaS Phase-1 operating guardrails

These are architecture constraints for the first 20-clinic pilot, not optional optimizations:

1. Structured/text clinical data first. Image/PDF upload is used only when clinically or operationally necessary.
2. A patient master is created once. Follow-up visits create encounter/session records; they must not create duplicate patient masters.
3. Essential operational fields are normalized. Large JSON blobs are reserved for bounded, versioned payloads where a normalized model would be worse.
4. Reports and history endpoints are paginated; the browser must not receive unbounded row sets.
5. Realtime is enabled only for workflows that materially benefit from it, rather than globally.
6. Audit logs capture meaningful security, clinical, financial, consent, export, and administrative events; routine UI noise is excluded.
7. Operational indexes must lead with tenant/clinic scope where appropriate, for example `(organization_id, clinic_id, session_date)` on tenant-scoped time-series access paths.
8. Binary files are not stored inside PostgreSQL table rows. File metadata belongs in the database; file bytes belong in managed object/file storage.
9. The product uses one shared deployment/runtime for multiple clinics. We do not provision one application server per clinic for the pilot.
10. Tenant/clinic onboarding is an application-level operation against the shared platform; it must not require new project/server provisioning for every clinic.

## Analytics-ready boundary

`relife_analytics.outcome_facts` contains derived/pseudonymous data only, using an opaque `subject_key`. It intentionally excludes direct patient identifiers such as patient ID, name, phone, DOB, address, and NID. Re-identification linkage stays private in `relife.analytics_subject_links`; therefore analytics facts are treated as pseudonymous, not automatically anonymous/shareable.

## Governance hooks

The kernel includes private service-owned hooks for purpose-specific patient consent, data provenance, configurable retention policies, and data-access/export/denial audit evidence. Routine care data never automatically implies research, AI-training, or commercial-use permission.

## Full Owner Tenant #1 cutover gates

1. CI passes on the kernel/cutover branch.
2. Source is reviewed and merged while `RELIFE_TENANT_CUTOVER_ENFORCED` remains off by default.
3. Kernel + Tenant #1 bridge migrations are applied and `ST001 -> relife / amtali-main` is verified.
4. `relife-tenant-context` is deployed and server-authenticated resolution returns exactly Tenant #1 for `ST001`.
5. Existing Owner role/department access still resolves from the live staff directory.
6. The production cutover flag is enabled on the existing shared Render service; no new service is created.
7. Owner dashboard and Owner operational server actions fail closed if tenant resolution is unavailable, while normal Relife flows remain intact when resolution succeeds.
8. Clinic #2 remains disabled until operational storage is explicitly tenant-scoped and two-clinic collision/isolation tests prove zero cross-tenant read/write/reserve/export/audit leakage.

## Load target

First SaaS pilot engineering baseline: 20 clinics; expected 40 treatment sessions/clinic/day = 800/day; peak design 50/clinic/day = 1,000/day. Patient identity is created once; follow-ups create encounter/session records rather than duplicate patient masters. Free-tier longevity will be measured from actual PostgreSQL row/index/storage growth rather than assumed from session counts.
