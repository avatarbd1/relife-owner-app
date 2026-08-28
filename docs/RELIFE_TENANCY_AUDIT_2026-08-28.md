# Relife tenancy audit — 2026-08-28

Read-only audit of how a normal tenant clinic runs, how Relife deviates, what a
migration off the deviation costs, and the activation gap found while bringing
two clinics live. Saved for later review; nothing here supersedes
`docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md`.

---

## 1. How a normal clinic runs

- **Identity.** `relife.organizations` (tenant) and `relife.clinics` (branch).
  Both IDs are `gen_random_uuid()` defaults — never hand-picked.
  `relife.clinics` is unique on `(organization_id, slug)`, not on `slug`
  globally, and carries `unique (organization_id, id)` so every operational
  table can hang a composite `(organization_id, clinic_id)` FK off it.
- **Provisioning.** One service-role-only SQL function,
  `relife.provision_clinic_v1(jsonb)` (current definition in
  `supabase/migrations/20260828020000_phase_h_repeatable_provisioning.sql`),
  takes a single JSON payload and upserts: organization, clinic,
  `clinic_settings`, 7 `clinic_operating_hours` rows, `staff_tenant_bindings`
  (+ owner role + `All` department), `clinic_feature_flags` +
  `clinic_entitlements`, `clinic_rooms`, `clinic_resources`, `clinic_services`,
  `clinic_booking_config`. Organizations use `on conflict(slug) do nothing`;
  clinics use `on conflict(organization_id, slug) do update` — so re-running it
  with existing slugs **fills in / refreshes config on the same UUIDs** rather
  than creating a second tenant. That property is what Phase H calls
  "repeatable provisioning".
- **Runtime scoping.** Every tenant-owned read/write carries explicit
  `organization_id + clinic_id` resolved from membership context; mismatches are
  rejected at the DB layer. Missing/ambiguous scope fails closed
  (`requireTenantScope` → `TENANT_SCOPE_REQUIRED`).
- **Feature gating is real, not decorative.** `relife.clinic_feature_enabled()`
  requires flag `enabled=true` **and** an active, in-window entitlement **and**
  an active `feature_catalog` row. `lib/domain/tenancy/featureGuard.ts`
  (`requireTenantFeature` / `hasTenantFeature`) is genuinely called before
  `app/api/chamber/*`, `app/api/v1/gamification/*`, `app/api/finance/salary|cash/*`
  and `app/api/control/*`, and gates nav in `app/(dashboard)/more/page.tsx`.
  Absence of a flag means disabled — there is deliberately no implicit default-on.
- **Data sources.** `relife.clinic_data_sources` is the generic per-clinic
  registry for legacy Sheets/storage identities. It was empty for every clinic
  until this branch; the Phase A migration deliberately seeds nothing
  ("a migration must never decide which clinic gets what").
- **Onboarding is config-only.** The `/platform` console (Platform Owner, no
  clinic tenant binding) posts to `app/api/platform/clinics` → the protected
  `relife-platform-control` Edge Function. Phase H proved clinics #3–#5 onboard
  with no source edits.

## 2. How Relife deviates today

| Site | Deviation |
|---|---|
| `lib/config/relifeSystem.ts` | Hardcodes `organizationId:"RELIFE"`, `branchId:"AMTALI-01"`, slugs `relife`/`amtali-main`, and maps Physio/Dental → `RELIFE-PHYSIO`/`RELIFE-DENTAL` ledger IDs |
| Six `relife-*-api` Edge Functions | `DEFAULT_ORGANIZATION_SLUG="relife"` / `DEFAULT_CLINIC_SLUG="amtali-main"` fallbacks. App callers always pass explicit slugs, so the live consumer of the fallback is the **weekly gamification cron** (`20260819093000_weekly_gamification_finalizer.sql`), which posts no slugs |
| `lib/webos/reception.ts` | "Tenant #1 compatibility bridge" matched patients by literal `relife`/`amtali-main` + department string instead of tenant identity |
| `lib/data/legacyReportStorage.ts`, `relife-report-storage` | Report/photo storage keyed by department name (`RELIFE-PHYSIO`/`RELIFE-DENTAL`), not `clinic_id`; the Edge Function had no tenant ownership check on the path |
| `20260824043000_relife_tenant1_staff_bridge.sql` | Seeds the owner binding by hardcoded slug lookup and fails the deploy (`RELIFE_TENANT1_OWNER_BINDING_FAILED`) if absent |
| `tests/phaseARelifeCompatibilityBoundary.test.ts` | A ratchet ledger of every remaining fixed identifier, per file, that may shrink but never grow |

## 3. What migrating off it costs

The danger is **not** deleting data — it is identity.

1. **Slug reuse silently re-attaches.** Re-provisioning with slug `relife`
   returns the *existing* organization/clinic UUIDs (verified in production this
   session — see §5). Good when intended, wrong if you thought you were getting
   a clean tenant.
2. **A new slug orphans everything.** All operational tables are scoped by
   `(organization_id, clinic_id)`. A freshly-slugged "Relife" sees zero
   patients, appointments, finance history, or audit trail.
3. **Sheets authority is not re-pointed automatically.** `clinic_data_sources`
   models the mapping but nothing consumed it until this branch.
4. **Cron writes to the old identity.** Removing the Edge-Function fallbacks
   without re-wiring the gamification cron either breaks it or keeps it writing
   into the old clinic.
5. **Report storage is department-keyed.** Patient media does not re-key itself.
6. **The compatibility ledger fails either way.** Partial removal must update
   `COMPATIBILITY_LEDGER` / `LEDGER_TOTAL` in lockstep.

## 4. Physio vs Dental

They are **already physically separate at the Sheets layer** (distinct workbooks
and spreadsheet IDs in `lib/data/googleSheets.ts`) but **share one canonical
clinic** (`relife`/`amtali-main`). In Supabase they are distinguished
redundantly: a `department text check (department in ('Physio','Dental'))`
column *and* a legacy `RELIFE-PHYSIO`/`RELIFE-DENTAL` `clinic_id` value.

Genuinely shared, and the hard part of any split:

- **Cash custody** — `lib/scopedCash.ts` treats both as sub-scopes of one tenant
  and *sums* them for `scope="combined"`.
- **Staff** — `relife.membership_departments` is many-to-many by design.
- Patients, chambers and resources appear already department-partitioned.

`relife.departments` exists as a first-class table (auto-seeded `physio` /
`dental` per clinic) but is **not** the scoping key operational tables use, and
its lowercase codes do not match the capitalised `check` constraints elsewhere.

`docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md` treats "Physio vs Dental template"
as an ordinary clinic-to-clinic *configuration* difference, and says
"one clinic = one Sheet database" is not the target — i.e. the contract already
points toward Dental becoming its own configured clinic.

## 5. Activation gap found — and what was done

**The gap.** `relife.activate_clinic_v1` refuses to activate without a
`clinic_provisioning_evidence` row for the exact release SHA. That row can only
come from `relife.record_clinic_readiness_v1`, which is granted to `service_role`
— and **nothing in the product calls it**: not the platform console, not
`app/api/platform/clinics`, not the `relife-platform-control` Edge Function
(its actions are snapshot / provision / profile / owner / commercial / activate /
suspend). `lib/domain/tenancy/onboardingHandoff.ts` states this is deliberate
(`browserMayRecordReadinessEvidence: false`, platform operator authority is
`OUT_OF_BAND_SERVICE_ROLE`).

The practical effect: a Platform Owner can provision a clinic and press
**Activate**, and it always fails `CLINIC_ACTIVATION_BLOCKED:verified readiness
evidence`, with no in-product way forward. Readiness recording is an
out-of-band service-role step — see
`scripts/sql/clinic-readiness-activation.template.sql`.

**Production state found (project `zpixvkfvmqzhmdacsezj`).** Both clinics already
existed, both stuck in `setup`:

- `relife` / `amtali-main` — the legacy foundation seed. Owner binding present,
  but **no** settings, operating hours, booking config, services, feature flags
  or entitlements. It had never been run through `provision_clinic_v1`.
- `happy-physiotherapy-centre` — fully configured via the console (starter plan,
  8 core features, all optional off). Its **only** blocker was readiness evidence.

**Executed, in order:**

1. `provision_clinic_v1` for `relife`/`amtali-main` — same slugs, so it returned
   the **same** `organizationId 9673c610-…` / `clinicId 5a1793b4-…`. No new
   organization, no orphaned history. Filled in settings, 7 operating-hour rows,
   booking config, one active Physio service, starter room/bed template, and the
   8 core feature flags + entitlements. Display name set to
   "Relife Physiotherapy Centre" (slug `amtali-main` deliberately unchanged, so
   the legacy ledger identity still resolves).
2. Machine-verified every gate `activate_clinic_v1` checks, for both clinics:
   owner membership, settings, `hours = 7`, booking config, ≥1 active service,
   no tenant-binding mismatch, 8 flags + 8 active entitlements, plus
   `clinic_feature_enabled(core.patients) = true` and
   `(optional.live_chamber) = false`.
3. Smoke-checked tenant resolution: `St001` → `amtali-main` and `HPP-PT-001` →
   `happy-physiotherapy-centre`, each **exactly one** active default binding, so
   login/dashboard scope resolution is unambiguous.
4. Recorded readiness evidence for both against deployed release
   `9d7dbb0b99f5dbf341b238b1ef1d74435ff73a9a`
   (`created_by = platform-owner:automated-db-verification:2026-08-28`).
5. Activated both. Final state: both `active`, `physiotherapy`, 8 core features
   on, chamber/gamification/finance-advanced/live-chat off.

**Attestation honesty.** Seven of the nine evidence keys were verified directly
against the database (`tenantIsolation`, `schemaReady`, `ownerMembership`,
`configurationReady`, `bookingReady`, `financeReady`, and — for the commercial
path — `noRelifeFallback`: Happy's exact-match scoping means it cannot read
Relife's legacy rows). Two are operator judgement and were recorded as `true` on
the Platform Owner's instruction rather than from independent proof:

- `coreOperationalSmoke` — no human has signed off on a real end-to-end session.
- `rollbackReady` — a rollback path exists (the `suspend` action, plus the
  `scripts/sql/*rollback*` templates) but no drill was run.

If either needs to be a genuine gate, re-record evidence after the real check.

## 6. Recommended next steps

1. Log in as each owner and confirm the dashboard, patient list and a booking —
   the real `coreOperationalSmoke`.
2. Merge the `clinic_data_sources` work on this branch, then apply
   `scripts/sql/relife-physio-clinic-data-sources-apply.template.sql` so Relife's
   Physio patients/photos resolve from config instead of hardcoded literals.
3. Give the weekly gamification cron explicit slugs before removing the
   Edge-Function `DEFAULT_*` fallbacks.
4. Decide Dental: register its own `clinic_data_sources` row under
   `amtali-main`, or split it into its own clinic. Splitting requires resolving
   shared cash custody in `lib/scopedCash.ts` first.
5. Close the readiness gap in-product — either a `readiness` action on the
   control plane, or document the SQL template as the supported operator path.
