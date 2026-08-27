# Phase E — Owner UX report

## Completed

Phase E adds a tenant-safe multi-branch Owner experience without creating another operational authority. The dashboard header exposes the active clinic, the Owner can choose only an active clinic returned by the canonical staff membership resolver, and every cookie-selected scope is revalidated server-side as the exact `organization_id + clinic_id` pair. Same clinic-local identifiers in different organizations cannot cross-match.

The Owner home summary now supplies the selected tenant explicitly to collection and appointment readers. Patient list, patient file, clinical entry, appointment creation, and the relevant patient/appointment mutation lookups also use the selected scope explicitly. The existing profile, operating-hours, service, staff, finance, appointment, and patient writers remain canonical.

The settings workspace now edits real Phase A clinic profile fields and the seven-day operating schedule through `app/api/settings/clinic`. It continues to read configured services and links to the canonical staff-access workflow. Missing configuration remains visible and fail-closed; no Relife profile, timezone, schedule, or price is substituted.

Authorized organization-level aggregation in this phase is deliberately limited to the active Owner's membership roster (organization and clinic labels in the switcher). There is no `All Clinics` patient or finance total: operational aggregation remains disabled until every underlying data source can prove tenant-safe organization-wide reads.

## Canonical paths and authority

- Selection: `app/api/tenant/selection` → `staffTenantContext.ts` / `tenantSelection.ts` → `relife-tenant-context` → `relife.staff_tenant_bindings`.
- Clinic configuration: existing `app/api/settings/clinic` → `lib/data/clinicConfiguration.ts`.
- Patient and appointment reads/writes: existing `lib/webos/reception.ts` and existing API writers, now with explicit selected tenant arguments in Phase E-touched paths.
- Dashboard finance/appointment readers: existing tenant-aware readers; no parallel writer or cache was added.

The HttpOnly active-tenant cookie is only a preference. It is not signed because it carries no authority: an altered value is rejected by the server-side active membership lookup before application data is read. Owner role/permission checks and tenant membership remain separate.

## Migration and database evidence

No migration was added. Phase E uses the Phase A/D schema and the existing server-authenticated Edge resolver. Repository migration history was not rewritten. Local application tests exercise selection and tenant behavior; the Edge SQL change is a bounded read-only membership selection over the existing composite tenant keys. Production was not mutated. Real Supabase Advisors were not run because no free configured path was available.

## Fixed-Relife debt

The compatibility ledger remains authoritative. No new fixed Relife identity/configuration injection was introduced. Phase E removes no unrelated compatibility entry and does not move literals behind constants. The final ratchet result is recorded in the PR evidence.

## Limitations and deferrals

- No cross-clinic operational `All Clinics` totals are exposed.
- Legacy operational helpers outside Phase E-touched Owner/patient paths may still resolve a default binding; broad cutover remains evidence-driven.
- Onboarding, import/mapping, export foundations, provisioning rollback/dry-run, and full readiness are Phase F.
- Production migration/deployment and real Clinic #2 proof remain later operational work.

Phase E completion does not claim full multi-clinic productization. Phase F may start after this PR is merged and current-head CI remains green.
