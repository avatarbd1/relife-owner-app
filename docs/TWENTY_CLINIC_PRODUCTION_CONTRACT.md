# Relife Clinic OS — Master Product & Rollout Contract

Status: OWNER-SELECTED AUTHORITATIVE MASTER PLAN

This document is the authoritative product, tenancy, onboarding, configuration, and rollout contract for Relife Clinic OS.

It replaces conflicting or narrower historical rollout/product plans, including assumptions that every client clinic should copy Relife's room, bed, Chamber, finance, gamification, or other internal workflows.

Historical notes, branches, issues, comments, fixtures, migration documents, and compatibility code may remain as implementation history, but they must not override this contract. Where old plans conflict with this document, this document wins.

## 1. Product target

Relife Clinic OS is one configurable multi-tenant clinic platform.

- One shared application codebase.
- One shared application runtime.
- One primary shared Supabase project/database for production tenant data unless a future Owner decision explicitly changes the infrastructure model.
- Shared managed storage/Drive may be used for files/media with strict tenant metadata and access control.
- Do not create one Render service, Supabase project, code branch, or hard-coded product fork per clinic.
- New clinics must be onboarded through configuration/data, not source-code edits.
- Relife is a flagship/reference tenant with advanced configuration, not a permanent special-case product fork.
- A client clinic receives only the core and optional modules it needs.

## 2. Canonical tenant identity

Runtime tenant-owned business logic must use explicit `organization_id + clinic_id` resolved from authenticated tenant membership/context.

- `organization_id` identifies the client organization/business boundary.
- `clinic_id` identifies one clinic/branch inside that organization.
- Department is authorization/business scope and never replaces clinic identity.
- Missing, blank, ambiguous, or mismatched tenant identity fails closed.
- No authenticated tenant runtime path may silently inject a Relife-specific clinic identity.

A single organization may own multiple clinics/branches. Authorized organization owners may switch between clinics and, when explicitly permitted, view consolidated organization-level summaries.

## 3. Core data ownership and storage model

### Supabase/Postgres — primary operational data

The target source of truth for transactional and configuration data includes at least:

- organizations
- clinics
- memberships
- roles/permissions
- clinic settings
- feature flags / entitlements
- rooms
- resources
- services and prices
- staff
- patients
- appointments
- payments
- expenses
- packages where enabled
- clinical/runtime records where enabled
- audit records
- readiness/provisioning state

Every tenant-owned row must be tenant scoped where applicable.

### Google Drive / managed file storage

Files/media may include:

- reports
- images
- X-rays
- scans
- PDFs
- attachments

Database records must store tenant-scoped ownership/reference metadata. File access must be authorized through the same tenant boundary and must not rely on obscurity of a shared folder URL.

### Google Sheets

Google Sheets is not the canonical real-time database for new commercial clinics.

Sheets may be used for:

- legacy compatibility
- data import
- data export
- reporting/admin compatibility
- verified migration boundaries

A clinic may have clinic-specific spreadsheet/workbook mappings when required, but `one clinic = one Sheet database` is not the target architecture.

## 4. New client / organization configuration

Creating a new client organization must require configuration, not code changes.

Platform Admin collects or configures:

- organization/business name
- owner name
- owner mobile
- owner email where available
- billing contact
- subscription/plan assignment
- activation/start date
- organization status

The system generates the canonical `organization_id`.

## 5. Clinic profile configuration

For each clinic/branch configure:

- clinic name
- clinic type
- branch name
- address
- phone
- email where applicable
- logo/branding where applicable
- currency
- timezone
- opening days
- opening time
- closing time
- weekly holidays
- clinic status

The system generates the canonical `clinic_id`.

## 6. Clinic templates

Templates are configuration presets only, never hard-coded product forks.

Initial template categories may include:

- Physiotherapy
- Dental
- Doctor Chamber
- Other clinic/service business types when approved

A template sets sensible defaults, but every enabled feature must remain configuration-driven.

Example Physiotherapy defaults:

- Patients ON
- Appointments ON
- Staff ON
- Services ON
- Basic Finance ON
- Reports ON
- Clinical optional
- Room/resource management optional
- Live Chamber optional
- Packages optional

## 7. Facility and resource configuration

Room, bed, chair, machine, or other physical-resource structure must never be assumed from Relife.

A clinic may have:

- no rooms/resources
- one room
- six rooms
- twelve beds
- dental chairs
- cabins
- treatment tables
- machines/equipment
- other configured resources

Canonical facility hierarchy:

`Organization -> Clinic -> Room/Area -> Resource`

Resource types may include:

- BED
- DENTAL_CHAIR
- TREATMENT_TABLE
- CABIN
- ROOM
- MACHINE
- OTHER

Each room/resource may have:

- display name
- type
- parent room/area
- active/inactive state
- capacity
- optional gender restriction
- bookable flag
- runtime-use-only flag

Bulk configuration must support workflows such as:

`6 rooms -> 2 beds each -> auto-create 12 beds`

After auto-creation, authorized users may rename, deactivate, add, or reorganize resources without code changes.

## 8. Booking configuration

Booking must be generic and clinic-configurable.

Supported booking modes:

### A. Simple/provider booking

For clinics that do not need rooms/beds/resources.

`Patient -> Date -> Time -> Provider -> Confirm`

### B. Capacity booking

The system enforces configured simultaneous capacity without pre-assigning a specific physical resource at booking time.

This is the preferred default for general Physiotherapy workflows where exact bed assignment belongs to treatment runtime, not appointment creation.

### C. Specific-resource booking

For clinics that genuinely reserve a specific room/chair/bed/resource during booking.

`Patient -> Date -> Time -> Provider/Resource -> Confirm`

This mode must be opt-in, not assumed globally.

Booking configuration may include:

- default appointment duration
- slot interval
- maximum simultaneous bookings
- provider required yes/no
- resource required yes/no
- duplicate-patient overlap blocking
- cancellation rules
- late-arrival rules
- walk-in support
- booking notes
- clinic-specific capacity/gender safety rules where applicable

## 9. Service and pricing configuration

Each clinic controls its own catalog.

A service may include:

- service name
- department
- price
- duration
- active/inactive state
- requires booking
- requires provider
- requires resource
- discount/tax applicability
- package eligibility

Relife prices or service names must never become universal defaults for commercial clients.

## 10. Package configuration

Packages are optional.

Where enabled, configure:

- package name
- session count
- validity
- price
- discount
- applicable services
- cancellation/refund rules

## 11. Staff configuration

Each staff member may include:

- name
- mobile
- email/login
- role
- department
- clinic/branch membership
- active/inactive state
- login enabled yes/no
- joining date
- salary configuration where enabled
- appointment-provider flag

Roles may include:

- Clinic Owner
- Manager
- Receptionist
- Therapist
- Doctor/Dentist
- Assistant
- Accountant
- Viewer

Roles do not replace permission checks. Membership and permission evaluation must remain deterministic and tenant scoped.

## 12. Permission model

Permissions must separate tenant ownership from functional access.

Example capabilities:

- patient registration/read/update
- appointment create/update/cancel
- payment collection
- expense access
- finance reports
- clinical notes
- staff management
- settings management
- audit viewing

Clinic Owner normally has broad access to the clinic(s) they own, subject to platform security policy.

Receptionist, therapist, clinician, accountant, and other roles receive only required capabilities.

No role may cross an unauthorized organization/clinic boundary.

## 13. Patient registration configuration

Recommended required/default fields:

- patient name
- mobile
- gender where required by workflow
- age or date of birth
- auto-generated clinic-local patient ID

Optional fields may include:

- address
- guardian
- occupation
- referral source
- emergency contact
- national ID
- blood group
- approved custom fields in a future bounded implementation

Clinic-local patient IDs may be reused across different clinics only when database constraints remain tenant scoped.

## 14. Finance configuration

Core finance must remain generic.

Configure per clinic:

- currency
- payment methods
- income categories
- expense categories
- opening cash balance where required
- outstanding receivables/payables for migration where required

Optional finance modules may include:

- salary
- staff advance
- cash custody
- approvals
- petty cash
- advanced owner finance
- clinic-specific treasury/cash-flow workflows

Relife-specific Home Treasury behavior is not a universal client default. It must remain a Relife configuration or an explicitly enabled advanced finance workflow.

Finance accounting invariants remain independent from tenant routing.

## 15. Feature flags and entitlements

Every clinic must have explicit feature configuration.

### Core default modules

- Dashboard
- Patients
- Appointments
- Staff
- Services
- Basic Finance
- Reports
- Profile/Settings

### Optional modules

- Live Chamber
- Room/Bed Runtime
- Clinical Notes
- Treatment Plans
- Packages
- Attendance
- Salary
- Inventory
- SMS
- Notifications
- Files/Documents
- Audit Viewer
- Advanced Finance
- Machines
- Gamification
- Rewards
- Live Chat

Disabled features must not clutter normal client navigation and must not create unnecessary runtime/realtime/data load.

Feature flags and commercial plan entitlements should be modeled separately so the platform can distinguish product capability from what a client has purchased/enabled.

## 16. Relife configuration

Relife runs on the same canonical tenant model.

Relife may enable a richer configuration, including advanced Physio workflows, Chamber runtime, machines, packages, attendance, salary, advanced finance, gamification, or other approved internal features.

Relife-specific behavior must not leak into another clinic unless that clinic explicitly enables/configures the same capability.

## 17. Owner experience

A Clinic Owner must be able to log in and see authorized clinic data such as:

- dashboard summary
- patients
- appointments
- finance
- staff
- reports
- clinic settings

Patient views may include, subject to enabled modules and permissions:

- profile
- contact/demographic data
- appointment history
- treatment/clinical records
- payment history
- outstanding amounts
- attached reports/files

A multi-branch owner must have a clinic switcher. Consolidated `All Clinics` views require explicit organization-level authorization and tenant-safe aggregation.

## 18. Platform Admin boundary

Platform Admin is not the same role as Clinic Owner.

Platform Admin may manage:

- organizations
- clinics
- subscriptions/plans
- activation status
- readiness
- feature entitlements
- support status
- infrastructure/storage usage
- system errors
- security/audit alerts

Routine support screens should not expose unrestricted patient clinical details. Elevated support access, where genuinely required, must be explicit, least-privilege, time-bounded where feasible, and audited.

## 19. Existing data import

New clients may start fresh or import existing data.

Supported onboarding path should include:

- CSV/Excel upload where supported
- Google Sheet mapping where required
- column mapping
- validation preview
- deterministic import
- rollback/failure evidence
- audit trail

Imports must not bypass tenant isolation or business invariants.

## 20. Client data export

Authorized clinic owners should be able to export their own clinic data in supported formats.

Target export areas include:

- patients
- appointments
- finance
- staff
- reports

Full tenant export/portability may be implemented as a later bounded capability, but no export may cross tenant boundaries.

## 21. Clinic lifecycle

Canonical clinic lifecycle states:

- draft
- setup
- ready
- active
- suspended
- archived

Suspension must not silently delete tenant data.

## 22. Code-free onboarding wizard

Target onboarding flow:

1. Business / Organization
2. Clinic Profile
3. Facility / Rooms / Resources
4. Services / Prices
5. Staff / Roles / Memberships
6. Booking Rules
7. Finance Configuration
8. Feature Selection
9. Existing Data Import or Skip
10. Review / Readiness Validation
11. Activate Clinic

Once the productization work is complete, onboarding a normal new clinic must not require programmer intervention or source-code conditions.

## 23. Readiness gate

A clinic may not become production-active until required readiness checks pass.

Readiness must verify at least:

- valid organization
- valid clinic
- correct owner/staff membership
- deterministic role/permission mapping
- valid booking configuration
- valid data/storage mapping
- required finance configuration
- required schema readiness
- explicit tenant parameters in active runtime paths
- no fixed Relife fallback in the clinic activation path
- cross-tenant isolation verification
- rollback/dry-run evidence for provisioning/migration where required

Readiness must fail closed on missing or ambiguous evidence.

## 24. Security and isolation invariants

Clinic A must not be able to read, mutate, reserve, export, operate, audit, or fetch media belonging to Clinic B unless an explicitly authorized system-admin boundary permits a narrowly defined action.

Every active tenant-owned runtime path must enforce the canonical tenant identity.

Department authorization is additive to tenant isolation and never a substitute for it.

Privileged/service-role/BYPASSRLS paths require independent tenant enforcement and audit semantics; ordinary RLS must not be assumed to protect privileged traffic.

## 25. Productization implementation phases

### Phase A — Tenant Foundation

- organization/clinic identity
- memberships
- permissions
- strict tenant isolation
- privileged-path hardening
- tenant-safe local business keys/constraints

### Phase B — Configuration Core

- clinic settings
- feature flags
- entitlements
- services/pricing
- operating hours
- lifecycle/status

### Phase C — Facility + Booking

- generic room/resource model
- bulk resource creation
- simple booking
- capacity booking
- specific-resource booking only where enabled
- clinic-specific booking rules

### Phase D — Staff + Finance

- staff provisioning
- role/permission setup
- basic finance configuration
- optional finance modules

### Phase E — Owner UX

- tenant-scoped owner dashboard
- patient access
- clinic switcher
- settings/configuration UI
- organization-level aggregation where authorized

### Phase F — Onboarding & Portability

- onboarding wizard
- import/mapping
- readiness engine
- export foundations
- provisioning rollback/dry-run evidence

### Phase G — Real Clinic #2 Proof

Onboard a real production-style Clinic #2 using the canonical mechanism with no clinic-specific code branch.

Prove Clinic #2 cannot cross tenant boundaries and can independently operate its configured core modules.

### Phase H — Repeatability

Onboard Clinics #3-#5 with the same mechanism and no source-code changes required for ordinary configuration differences.

Only after this repeatability gate passes should Clinics #6-#20 be batched for commercial rollout.

## 26. Required implementation rule

Normal differences between clinics must be represented as data/configuration, not code conditionals.

Examples that must not require source-code changes:

- 1 room vs 6 rooms
- 2 beds vs 12 beds
- no beds at all
- Physio vs Dental template
- different services/prices
- different appointment durations
- different staff counts
- different roles/permissions
- Chamber ON/OFF
- Gamification ON/OFF
- Salary ON/OFF
- Advanced Finance ON/OFF
- existing-data import vs fresh start

Code changes are reserved for new platform capabilities, not ordinary client onboarding.

## 27. Migration and compatibility rule

Existing Relife compatibility code may remain only where needed during migration.

Any compatibility boundary must be:

1. explicit and named;
2. auditable;
3. isolated from canonical tenant runtime logic;
4. accompanied by a removal/migration path;
5. forbidden from introducing new Relife-specific defaults into commercial tenant paths.

## 28. Definition of commercial clinic readiness

The platform is ready for repeatable commercial clinic onboarding only when:

- tenant isolation is closed for active runtime paths;
- multi-clinic local keys/constraints are safe;
- clinic provisioning is configuration-driven;
- staff membership/permissions are deterministic and fail closed;
- facility/resource configuration is generic;
- booking behavior is configurable;
- feature flags work per clinic;
- data-source/storage mapping is clinic aware;
- Clinic #2 passes real isolation and operational smoke tests;
- Clinics #3-#5 onboard with the same runbook and without source-code edits for normal differences;
- the same mechanism can provision Clinics #6-#20;
- no active commercial path depends on an undocumented Relife-only fallback.

## 29. Out of scope until the repeatability gate is closed

Unless required to complete the master plan above, defer:

- speculative 50/100-clinic performance tuning
- broad unrelated feature expansion
- new one-off Relife-only workflows
- per-clinic infrastructure forks
- unrelated SMS/Undo/backlog work
- speculative rewrites that do not advance configuration-driven onboarding, isolation, or commercial readiness

## 30. Governing rollout sequence

The governing execution order is:

`Tenant hardening -> multi-clinic constraints -> configuration core -> generic facility/resource model -> configurable booking -> staff/finance configuration -> owner UX -> onboarding/readiness -> real Clinic #2 isolation -> Clinics #3-#5 repeatability -> Clinics #6-#20 commercial rollout`

All future implementation plans, Claude/ChatGPT task prompts, PR reviews, acceptance criteria, and merge decisions for clinic productization must be evaluated against this contract.
