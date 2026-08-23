# Multi-Tenant Kernel v1

## Decision

`relife.organizations` is the canonical SaaS **Tenant** table. We do not add a second `tenants` table. `relife.clinics` represents a tenant-owned clinic/branch/chamber container.

Relife remains Tenant #1 during migration. The existing `relife` / `amtali-main` compatibility defaults remain temporarily so current server-side writers continue to work, but every new tenant-aware writer must pass `organization_id` and `clinic_id` explicitly.

## Kernel scope

This batch adds:

- tenant/clinic membership identity;
- multi-role membership mapping;
- multi-department membership mapping;
- canonical kernel roles and permissions;
- fail-closed Supabase Auth helpers for the future Auth convergence path;
- metadata RLS policies;
- consent, provenance, retention-policy, and access-audit hooks;
- a separate private analytics-ready schema with no direct patient identifiers;
- a server-only bridge from the current signed staff session identity to canonical Tenant/Clinic scope.

This batch does **not**:

- activate a second clinic;
- replace current Owner PIN, staff passkey, or signed-session behavior;
- manufacture a Supabase `auth.users` record for the current Owner;
- grant direct authenticated access to clinical, finance, chamber, or patient operational tables;
- migrate Google Sheets patient/clinical/finance data;
- create an analytics export pipeline;
- claim that pseudonymous analytics rows are anonymous or shareable;
- apply the migration to production automatically.

## Access model

The long-term authorization chain is:

```text
authenticated user
  -> active organization/clinic membership
  -> one or more roles
  -> one or more department scopes
  -> permission
  -> domain-specific record rule
  -> database tenant boundary
```

Unknown role, missing membership, missing tenant scope, inactive clinic membership, or unresolved department must fail closed.

The legacy `clinic_memberships.role` column remains for compatibility. `membership_roles` becomes the authoritative multi-role mapping after Auth cutover.

## Relife Tenant #1 staff-session bridge

The current Web/PWA session stores stable staff identity rather than a Supabase Auth user ID. Owner resolves to `ST001`; current role/department truth still comes from the live staff directory.

During the gradual cutover:

```text
signed session cookie
  -> stable staff_id (ST001 for Owner)
  -> relife.staff_tenant_bindings
  -> organization = relife
  -> clinic = amtali-main
  -> existing live staff directory
  -> existing WebRole / Department / permission rules
```

`staff_tenant_bindings.auth_user_id` is nullable. It is a future convergence hook only; no fake Auth user is created. Exactly one active default binding is required when a session does not carry an explicit clinic choice. Missing or ambiguous bindings fail closed.

The server-only `relife-tenant-context` Edge Function reads this private table using the same shared-secret boundary already used by protected Relife Edge operations. Browser clients receive no table grant. `lib/webos/currentUser.ts` exposes additive tenant-aware helpers so routes can migrate one-by-one without changing all current production routes at once.

The existing `getCurrentAccessContext()` and Owner login behavior are intentionally preserved. New tenant-aware routes should migrate to `requireCurrentTenantAccessContext()`, which combines the existing live staff authorization context with the resolved organization/clinic scope.

## Role invariants imported from Relife Clinic OS

- Role and Department are separate dimensions.
- Owner may receive explicit cross-department scope.
- System Admin does not implicitly receive clinical access.
- Menu visibility is not an authorization boundary.
- Direct record IDs and stale client state must still be re-authorized.

Domain permissions (patient, appointment, clinical, finance, workforce, etc.) are intentionally added in later focused migrations so this kernel cannot accidentally grant a broad same-clinic write surface.

## Analytics-ready boundary

`relife_analytics.outcome_facts` contains only derived/pseudonymous fields such as:

- opaque `subject_key`;
- age band;
- sex category;
- condition code;
- treatment group;
- baseline/final metrics;
- session count;
- recovery days;
- outcome status.

It intentionally does not contain direct identifiers such as patient ID, patient name, phone, DOB, address, or NID.

The linkage from a patient record to `subject_key` remains in the private `relife.analytics_subject_links` table. Analytics rows are therefore **pseudonymous**, not automatically anonymous. No analytics schema grants are provided to `anon` or `authenticated` in this batch.

## Governance hooks

The kernel creates private service-owned tables for:

- `patient_consents`: purpose-specific consent states;
- `data_provenance`: source system/type, AI origin, human verification, schema/model version;
- `retention_policies`: configurable policy metadata; no universal retention duration is hard-coded;
- `data_access_events`: minimal access/export/denial audit evidence.

No secondary-use pipeline is allowed to infer research, AI-training, or commercial permission merely from routine care data.

## Rollout gates before Clinic #2

1. CI must pass on the kernel branch.
2. Review and merge the source before production database apply so schema never runs ahead of source control.
3. Apply both kernel migrations under the controlled production migration process and verify the `ST001 -> relife / amtali-main` binding.
4. Deploy `relife-tenant-context`, then verify a signed Owner session resolves exactly that Tenant #1 scope while the existing Owner access context still resolves from the live staff directory.
5. Migrate transactional reads/writes route-by-route to `requireCurrentTenantAccessContext`; compatibility defaults must never route Clinic #2.
6. Add domain-specific permissions and policies for patient/appointment/clinical/finance tables.
7. Add database-backed cross-tenant tests using at least two test clinics with deliberately colliding local business IDs.
8. Prove Clinic A cannot read, mutate, reserve, export, or audit Clinic B data.
9. Only after those gates pass may a second clinic be activated.

## Load target

Engineering baseline for the first SaaS pilot:

- 20 clinics;
- expected 40 treatment sessions/clinic/day = 800/day;
- peak design 50 treatment sessions/clinic/day = 1,000/day;
- patient identity created once; follow-ups create encounter/session records, not duplicate patient masters.

Capacity and free-tier longevity must be measured from real PostgreSQL row/index/storage growth after the clinical schema exists; they are not assumed from session counts alone.
