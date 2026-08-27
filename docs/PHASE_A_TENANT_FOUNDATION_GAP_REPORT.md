# Phase A — Tenant Foundation Gap Report

Base: `origin/main` @ `8cc7158`
Branch: `claude/phase-a-tenant-foundation`
Authority: `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md` and `TENANCY.md`

Scope of this slice: canonical tenant + configuration foundation only. No onboarding wizard, no UI, no provisioning writer, no Clinic #2 activation.

---

## 1. Already compliant

Verified against current `main`, not assumed.

| Area | Evidence |
| --- | --- |
| Privileged Edge SQL binds both tenant keys | `tests/t4DbRlsBaseline.test.ts` covers 7 privileged Edge functions and asserts no clinic-only `WHERE` remains |
| Operational tables are tenant-keyed and client-private | RLS enabled and `revoke all … from anon, authenticated` across operational, gamification, kernel and analytics tables |
| Clinic-local business keys are tenant scoped in Postgres | T5 (#206) applied: `patient_cache` and `treatment_plan_cache` keyed `(organization_id, clinic_id, patient_id)`, `chamber_resources` keyed `(organization_id, clinic_id, resource_id)` |
| Tenant columns fail closed on omission | T5 dropped `organization_id` / `clinic_id` defaults on all 10 foundational operational tables; every insert path supplies both keys explicitly |
| Department is separate from clinic identity | `canAccessDepartment` is additive to tenant checks; `validateTenantScope` rejects a blank organization or clinic before department is considered |
| Readiness does not manufacture evidence | `clinic-validation` reports unverified checks as `false` with explicit warnings, and rejects a mismatched requested tenant with `TENANT_SCOPE_MISMATCH` |
| Booking and Chamber runtime remain separate | Preserved. This slice does not merge `chamber_resources` into the new configuration layer |

## 2. Changed in this slice

### Migration

`supabase/migrations/20260827130000_phase_a_clinic_configuration_foundation.sql`

- Clinic lifecycle widened to the canonical six states (`draft`, `setup`, `ready`, `active`, `suspended`, `archived`) per contract §21. Previously only `active` / `inactive`.
- New tenant-scoped configuration tables, each with a composite FK to `relife.clinics (organization_id, id)`, no tenant column defaults, RLS enabled and browser roles revoked:
  - `clinic_settings` (§5)
  - `clinic_operating_hours` (§5)
  - `feature_catalog`, `clinic_feature_flags`, `clinic_entitlements` (§15)
  - `clinic_rooms`, `clinic_resources` (§7)
  - `clinic_services` (§9)
  - `clinic_booking_config` (§8)
  - `clinic_data_sources` (§3)
- `relife.clinic_feature_enabled(...)` resolves feature access as capability **and** commercial grant, failing closed on every unknown.
- Resource types are configuration: `BED`, `DENTAL_CHAIR`, `TREATMENT_TABLE`, `CABIN`, `ROOM`, `MACHINE`, `OTHER`. Gender restriction is optional and null by default, so Relife's gender-segregated room policy is not a product rule.
- Booking modes are configuration: `simple`, `capacity`, `specific_resource`, with a check constraint making `specific_resource` opt-in.
- No seed rows. A migration must not decide which clinic gets what.

### Application

`lib/domain/tenancy/clinicConfiguration.ts` — pure resolution logic reusing the existing `requireTenantScope` rather than duplicating it:

- `tenantKey` composes tenant identity into clinic-local keys so overlapping local ids cannot collide.
- `isTenantOwned` / `assertTenantOwned` / `scopeToTenant` are the fail-closed read and mutation guards.
- `resolveFeature` mirrors the SQL resolver so the two cannot drift.
- `bookableCapacity` derives capacity from the clinic's own resources; a clinic with no resources is valid, not an error.
- `clinicMayServe` gates production traffic on the `active` lifecycle state.

### Compatibility boundary

`tests/phaseARelifeCompatibilityBoundary.test.ts` implements contract §27 as an executable ratchet: a named ledger of the **92 fixed Relife identifier occurrences across 18 files** that remain. A new file carrying a fixed identifier fails. An increased count fails. A decreased count also fails, forcing the ledger to record the improvement so the removal path stays visible.

### Stale contract assertions repaired

Two tests asserted wording from the superseded rollout plan and were failing on `main` before this branch:

- `tests/tenantFoundation.test.ts` — expected the old "first 20 production Physio clinics" phrasing and the old `T4 -> …` sequence.
- `tests/patientTenantLegacyBridgeRegression.test.ts` — expected `organizationId + clinicId`; the contract now writes `organization_id + clinic_id`.

## 3. Still blocked

Ordered by what blocks Clinic #2 soonest.

1. **Google Sheets routing is department-keyed, not clinic-keyed.** `lib/data/googleSheets.ts` selects between two compiled spreadsheet ids by workbook. Clinic #2 would read and write Clinic #1's data. `clinic_data_sources` now models the mapping, but nothing consumes it yet. **Phase B.**

2. **Relife's physical plant is compiled into the booking engine.** `lib/domain/appointments/capacityBooking.ts` holds `ROOM_CAPACITY = { "Room 1": 2, "Room 2": 2 }` and derives rooms from bed numbers. A clinic with a different layout gets silently wrong capacity rather than an error. 48 references across 11 files, of which 36 are in core booking. `clinic_booking_config` and `clinic_resources` now model the replacement. **Phase C.**

3. **Sheets business keys are not tenant scoped.** Postgres keys are clinic-scoped, but `PT0109` / `RP0193` are generated per spreadsheet. Two clinics on the same workbook would collide. **Phase B, with item 1.**

4. **`clinic-validation` reads `clinic_memberships`, which holds no rows.** Canonical membership is `relife.staff_tenant_bindings`. The route is the only place in the codebase touching `clinic_memberships`, so `staffHasClinicMembership` can never be true and `isReady` can never be true.

5. **`crossTenantIsolationVerified` is never assigned.** It is required by the readiness conjunction, so readiness cannot pass even once item 4 is fixed. The check needs a real implementation.

6. **`relife-report-storage` has no tenant binding.** service_role with one shared secret and a caller-supplied path, no ownership check. 215 patient files currently live in that bucket.

7. **Storage paths are keyed on legacy fixed identifiers.** Objects live under `RELIFE-PHYSIO/` and `RELIFE-DENTAL/`, which are department names, not clinic ids.

8. **Migration drift.** `supabase/migrations/20260824_staff_tenant_membership_v1.sql` is present in the repo but not applied; `relife.staff_tenant_roles` and `relife.staff_tenant_departments` do not exist in the database. `tests/t4DbRlsBaseline.test.ts` passes because it reads the `.sql` text, not the schema. Two applied migrations (`create_relife_chamber_core`, `create_chamber_reference_cache`) have no file in the repo.

9. **`getCashMovementsForAdminView()` still returns `getCashMovements("RELIFE", "RELIFE-PHYSIO")`.** The scoped cash position helper was moved to a resolved tenant in #204; this one was not.

10. **Cron resolves a single tenant.** The weekly finalizer takes slugs from the request body and falls back to `DEFAULT_ORGANIZATION_SLUG` / `DEFAULT_CLINIC_SLUG` with `limit 1`, and the cron sends no slugs. Monthly finalization has no cron at all.

## 4. Evidence limits

Stated so the report is not read as more than it is.

- **The migration in this branch has not been applied anywhere.** Applying DDL to production to validate a draft would be wrong, and no Supabase branch was created. The SQL is therefore unvalidated against a real database; its syntax and constraint behaviour need a dev-branch run before merge.
- **Cross-tenant isolation is proven at the resolution layer, not end to end.** The tests execute the real guards with two tenants, which is genuine behavioural evidence for those functions. It is not proof that every reader and writer in the app calls them. That requires Clinic #2 (contract Phase G).
- **The SQL-shape tests are labelled as contract assertions**, not behavioural evidence. They prove the migration text says what it must, not that a database matches it — the exact failure mode found in item 8 above.
- **No live runtime verification.** `onrender.com` is unreachable from this environment, so nothing here was exercised against the deployed app.

## 5. Required next slice

**Phase B — Configuration Core**, in this order:

1. Make `clinic_data_sources` authoritative for workbook and storage routing, replacing the compiled constants in `lib/data/googleSheets.ts`. This unblocks items 1, 3 and 7 above.
2. Point `clinic-validation` at `staff_tenant_bindings` and implement `crossTenantIsolationVerified` against a real probe. This closes items 4 and 5 and makes readiness meaningful for the first time.
3. Reconcile the migration ledger with the database, then change `t4DbRlsBaseline` to assert against schema rather than file text. This closes item 8 and removes a class of false confidence.
4. Bind `relife-report-storage` to the tenant, and re-key storage paths onto canonical clinic ids. Items 6 and 7.

`clinic_resources` and `clinic_booking_config` are deliberately left unconsumed by this slice. Wiring the booking engine to them is Phase C and should not be mixed into a configuration-core change.
