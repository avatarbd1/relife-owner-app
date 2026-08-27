# Owner Self-Service Setup

Status: implementation slice for post-Phase-H commercial onboarding UX.

## Goal

A normal clinic Owner should configure ordinary clinic differences from the Owner App instead of requiring source-code edits or direct database/API work.

Primary UI: `/onboarding/setup`.

## Owner-configurable surfaces

- clinic profile and seven-day operating hours
- room/resource bulk setup or no-facility mode
- simple, capacity, or specific-resource booking configuration
- services, prices, duration, and department
- staff and roles through the existing canonical staff-access surface
- finance through the existing entitled finance surface
- enable/disable feature flags that are already commercially entitled
- CSV mapping and validation preview
- fail-closed readiness validation

## Boundaries intentionally preserved

- Organization creation/provisioning remains platform authority.
- Commercial plan and entitlement assignment remain Platform Admin authority.
- Owner feature selection may not create or extend an entitlement.
- Existing-data import remains validation-only until a separately reviewed canonical mutation executor exists.
- Final clinic activation remains a privileged readiness-gated platform operation; service-role credentials are never exposed to the browser.
- Existing clinic, facility, service, staff, finance, import, and readiness canonical paths are reused rather than duplicated.

## Rollback

Revert this UX slice. It adds no migration and changes no production schema. Existing tenant configuration rows written by an Owner through canonical settings APIs remain valid tenant data and do not require destructive rollback.
