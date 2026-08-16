# Relife tenant foundation

Relife currently operates as one clinic. The Supabase schema is now tenant-ready, but multi-clinic access is intentionally **not activated**.

## Current compatibility mode

- Organization: `relife`
- Clinic: `amtali-main`
- Existing Chamber rows carry non-null `organization_id` and `clinic_id`.
- Existing server-side Chamber writes that do not yet pass tenant context receive the default Amtali tenant IDs.
- `RELIFE-PHYSIO` and `RELIFE-DENTAL` remain Sheets ledger/department identities; they are not Supabase tenant primary keys.
- The `relife` schema remains private to the current server-side database path. `anon` and `authenticated` are not granted access to the new tenant metadata tables.
- RLS is enabled and client-facing membership policies remain intentionally absent, so future direct client access stays fail-closed until Auth cutover.

## Required before a second clinic is activated

1. Resolve the active clinic from authenticated membership on every request.
2. Pass `organization_id` and `clinic_id` explicitly on every transactional write; remove reliance on the single-clinic defaults.
3. Add `clinic_id` filters to every tenant-owned read/query, including Edge Function bootstrap and conflict checks.
4. Add membership-based RLS policies and only then grant the minimum required schema/table privileges to authenticated clients.
5. Replace or widen legacy globally unique business-key constraints where a second clinic may reuse IDs such as patient IDs or Chamber resource IDs.
6. Add cross-tenant isolation tests proving one clinic cannot read, mutate, reserve, or audit another clinic's rows.
7. Keep Finance ledger invariants independent from tenant routing; tenant scope must never change accounting semantics.

## Migration source of truth

The SQL in `supabase/migrations/` mirrors migrations already applied to the connected Supabase project. New schema changes must be tracked there and verified with Supabase security/performance advisors.
