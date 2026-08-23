# Relife Tenant #1 Cutover Audit — Issue #166

This is the focused high-risk supplement to `MIGRATION_AUDIT.md` for the multi-tenant authorization/schema cutover approved in issue #166.

## Existing authority reviewed

- Web/PWA remains the primary operational UI.
- Existing TypeScript domain/API writers remain canonical for App mutations.
- Google Sheets remains the current Relife operational source of truth where documented in `MIGRATION_AUDIT.md`.
- Supabase is not silently promoted to patient/appointment/clinical/finance operational authority by this cutover.
- Existing role + department checks remain authoritative for business permissions.
- Existing Owner signed session remains `ST001`; this cutover does not create a fake Supabase Auth user.

## Authority change approved by issue #166

The only authority-boundary change in this batch is **Tenant/Clinic resolution for the existing Owner server authorization boundary**.

When `RELIFE_TENANT_CUTOVER_ENFORCED=true`:

```text
signed Owner session (ST001)
  -> live staff identity / role / department truth
  -> private staff_tenant_bindings
  -> exactly one active default organization + clinic
  -> existing business permission check
  -> existing canonical reader/writer
```

Missing, inactive, or ambiguous tenant resolution denies the Owner operation before the existing domain writer can run.

This changes **authorization scope**, not operational data writer authority.

## Canonical paths reused

- Tenant: `relife.organizations`
- Clinic: `relife.clinics`
- Existing membership foundation: `relife.clinic_memberships`
- Current server identity boundary: `lib/webos/currentUser.ts`
- Current live role/department truth: `lib/webos/staffDirectory.ts` + `lib/webos/access.ts`
- Protected server-to-Supabase pattern: existing shared-secret protected Edge functions
- New resolver: `supabase/functions/relife-tenant-context/index.ts`
- New bridge: `relife.staff_tenant_bindings`

No duplicate tenant table, RBAC engine, patient writer, finance writer, clinical writer, appointment writer, or deployment is introduced.

## Production sequencing / deployment race control

The cutover is feature-gated and defaults OFF. This is mandatory because source merge may trigger the existing Render deployment before Supabase migration/Edge preparation is complete.

Safe order:

1. CI-green source merge with cutover flag absent/false.
2. Apply additive kernel + Tenant #1 bridge migrations to the existing Supabase project.
3. Verify `ST001` has exactly one active default binding to the active `relife` organization and `amtali-main` clinic.
4. Deploy `relife-tenant-context` to the same Supabase project using the existing server-authenticated pattern.
5. Verify protected server resolution succeeds for ST001 and fails closed for missing/ambiguous bindings.
6. Enable `RELIFE_TENANT_CUTOVER_ENFORCED=true` on the **existing** Render service only.
7. Redeploy/restart the same service and verify Owner login/dashboard plus representative patient, appointment, clinical and finance reads/actions retain their existing business authorization and writer behavior.

Rollback is to set the cutover flag false first. The additive schema/Edge objects can remain inert while a DB rollback is evaluated; disabling the flag restores the prior Owner authorization path without changing operational Sheets data.

## Explicit non-goals

- No Clinic #2 activation.
- No staff-wide membership cutover; this issue is the Owner Tenant #1 cutover.
- No Google Sheets -> Supabase operational data migration.
- No Python writer disablement or Telegram authority change.
- No analytics export, research sharing, ML training, or commercial secondary-use activation.
- No new Render service, Supabase project, or per-clinic infrastructure.

## Before Clinic #2

Clinic #2 is blocked until its operational records use explicit tenant/clinic scope and collision tests prove Clinic A cannot read, mutate, reserve, export or audit Clinic B data. Relife-only compatibility defaults may not route Clinic #2.
