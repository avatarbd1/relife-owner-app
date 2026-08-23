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
- fail-closed Supabase Auth helpers;
- metadata RLS policies;
- consent, provenance, retention-policy, and access-audit hooks;
- a separate private analytics-ready schema with no direct patient identifiers.

This batch does **not**:

- activate a second clinic;
- change current Owner login/session behavior;
- grant direct authenticated access to clinical, finance, chamber, or patient operational tables;
- migrate Google Sheets patient/clinical/finance data;
- create an analytics export pipeline;
- claim that pseudonymous analytics rows are anonymous or shareable;
- apply the migration to production automatically.

## Access model

The target authorization chain is:

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
2. Review Supabase migration with security/performance advisors after applying in a controlled environment.
3. Cut over authentication to membership-resolved tenant context, or add a reviewed server-side bridge from the current staff session.
4. Every transactional read/write must take explicit tenant scope; compatibility defaults must not route Clinic #2.
5. Add domain-specific permissions and policies for patient/appointment/clinical/finance tables.
6. Add database-backed cross-tenant tests using at least two clinics with deliberately colliding local business IDs.
7. Prove Clinic A cannot read, mutate, reserve, export, or audit Clinic B data.
8. Only after those gates pass may a second clinic be activated.

## Load target

Engineering baseline for the first SaaS pilot:

- 20 clinics;
- expected 40 treatment sessions/clinic/day = 800/day;
- peak design 50 treatment sessions/clinic/day = 1,000/day;
- patient identity created once; follow-ups create encounter/session records, not duplicate patient masters.

Capacity and free-tier longevity must be measured from real PostgreSQL row/index/storage growth after the clinical schema exists; they are not assumed from session counts alone.
