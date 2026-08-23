# Multi-Tenant Kernel v1

## Decision

`relife.organizations` is the canonical SaaS **Tenant** table. We do not add a second `tenants` table. `relife.clinics` represents a tenant-owned clinic/branch/chamber container.

Relife remains Tenant #1 during migration. The existing `relife` / `amtali-main` compatibility defaults remain temporarily so current server-side writers continue to work, but every new tenant-aware writer must pass `organization_id` and `clinic_id` explicitly.

## Kernel scope

This batch adds tenant/clinic membership identity, multi-role and multi-department membership mappings, canonical kernel roles and permissions, future Supabase Auth helpers, metadata RLS, consent/provenance/retention/access-audit hooks, a private analytics-ready schema, and a server-only bridge from the current signed staff session to canonical Tenant/Clinic scope.

It does **not** activate Clinic #2, replace current Owner PIN, staff passkey, or signed-session behavior, manufacture a Supabase `auth.users` record, grant direct authenticated access to operational patient/clinical/finance/chamber tables, migrate Google Sheets operational data, or enable analytics export/licensing.

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

`staff_tenant_bindings.auth_user_id` is nullable for future Auth convergence. No fake Auth user is created. Exactly one active default binding is required when a session does not carry an explicit clinic choice; missing or ambiguous bindings fail closed.

The server-only `relife-tenant-context` Edge Function reads this private table behind the same shared-secret server boundary used by protected Relife Edge operations. Browser clients receive no table grant. `lib/webos/currentUser.ts` keeps `getCurrentAccessContext()` intact and adds `requireCurrentTenantAccessContext()` as the route-by-route migration target.

## Access invariants

- Role and Department remain separate dimensions.
- Owner may receive explicit cross-department scope.
- System Admin gets no implicit clinical access.
- Menu visibility is never an authorization boundary.
- Direct record IDs and stale client state must be re-authorized.
- New tenant-aware paths must never silently default to Relife.

## Analytics-ready boundary

`relife_analytics.outcome_facts` contains derived/pseudonymous data only, using an opaque `subject_key`. It intentionally excludes direct patient identifiers such as patient ID, name, phone, DOB, address, and NID. Re-identification linkage stays private in `relife.analytics_subject_links`; therefore analytics facts are treated as pseudonymous, not automatically anonymous/shareable.

## Governance hooks

The kernel includes private service-owned hooks for purpose-specific patient consent, data provenance, configurable retention policies, and data-access/export/denial audit evidence. Routine care data never automatically implies research, AI-training, or commercial-use permission.

## Rollout gates before Clinic #2

1. CI passes on the kernel branch.
2. Source is reviewed and merged before production DB apply, so deployed schema is always represented in source control.
3. Kernel + Tenant #1 bridge migrations are applied and `ST001 -> relife / amtali-main` is verified.
4. `relife-tenant-context` is deployed and a signed Owner session resolves exactly Tenant #1 while existing Owner access still resolves from the live staff directory.
5. Transactional routes migrate one-by-one to `requireCurrentTenantAccessContext()`.
6. Patient/appointment/clinical/finance reads and writes become explicit-tenant scoped.
7. Two-clinic collision/isolation tests prove zero cross-tenant read/write/reserve/export/audit leakage.
8. Only then may Clinic #2 be activated.

## Load target

First SaaS pilot engineering baseline: 20 clinics; expected 40 treatment sessions/clinic/day = 800/day; peak design 50/clinic/day = 1,000/day. Patient identity is created once; follow-ups create encounter/session records rather than duplicate patient masters. Free-tier longevity will be measured from actual PostgreSQL row/index/storage growth rather than assumed from session counts.
