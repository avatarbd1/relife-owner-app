begin;

-- Canonical first-device enrollment resolves the owner's active binding and
-- must verify that the exact clinic is in setup or active state. The tenant
-- membership tables already grant service_role read access, but clinics did
-- not, causing the server-only lookup to fail closed after credentials were
-- configured on Render.
grant select on table relife.clinics to service_role;

-- Keep the canonical clinic catalogue unavailable to browser roles. The
-- application reaches it only through reviewed server/Edge boundaries.
revoke all on table relife.clinics from anon, authenticated;

commit;
