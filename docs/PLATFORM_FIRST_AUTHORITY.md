# Platform-first authority boundary

The Platform Owner is a global control-plane authority and is not a clinic staff role.

Runtime invariants:

- Resolve Platform Owner authority before any clinic tenant or staff binding.
- Authenticated Platform Owners enter `/platform` from the root route.
- A Platform Owner who reaches a tenant dashboard route is redirected to `/platform` before `requireCurrentTenantAccessContext()` runs.
- Platform Owner access does not require Relife, or any other clinic, to be selected or active.
- Clinic staff/owners continue through tenant-scoped `/home` routes.
- This boundary does not migrate, delete, or rewrite clinic business data.

The existing login credential may still carry a stable compatibility identity for session verification and audit attribution. That identifier must not be interpreted as implicit membership of Relife or any other clinic when Platform Owner authority is active.
