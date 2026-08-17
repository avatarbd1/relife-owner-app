# V1-B Access + Patient Hub Authority Map

## Scope

V1-B consolidates the Patient Hub around the existing patient file and makes role + department authorization explicit. It does not change Appointment/Chamber authority and does not change the finance source-of-truth model completed in V1-A.

## Patient business-record authority

Google Sheets remains the patient business-record authority.

- Physio patient rows: Physio workbook `02_Patients`
- Dental patient rows: Dental workbook `02_Patients`
- Patient registration writer: `POST /api/patients` -> `lib/webos/reception.ts::registerPatient()` -> `02_Patients`
- Patient profile writer: `PATCH /api/patients/[patientId]` -> `lib/webos/patientUpdate.ts::updatePatientProfile()` -> `02_Patients`
- Patient reads: `lib/patients.ts` reads both `02_Patients` sheets and exposes a short-lived 30-second in-process read cache.

`lib/patients.ts` is not a competing write authority. Supabase patient/cache tables are not promoted to patient write authority by V1-B.

The canonical patient create, update, and payment APIs invalidate the patient read cache after a successful write so Patient Hub redirects do not intentionally wait for cache expiry.

## Canonical access boundary

Authorization is resolved server-side from `AccessContext` and enforced by `lib/webos/access.ts`.

Two independent dimensions are required:

1. Role capability: whether the role allows the requested action.
2. Department scope: whether the staff mapping explicitly allows the record department.

Rules:

- Owner may use explicit `All` scope.
- Non-owner Physio-only scope cannot read/write Dental patient records.
- Non-owner Dental-only scope cannot read/write Physio patient records.
- Missing/empty department mapping fails closed.
- System Admin has no implicit patient/clinical/finance capability.
- Auditor remains non-mutating for patient/payment/appointment/clinical actions.
- Temporary Dental data entry remains an explicit exception only for a Receptionist with exactly Dental scope and `Dental_Temporary_Data_Entry`; it does not grant Physio access.

## Patient Hub surface

Canonical workspace: `/patients/[patientId]`.

The patient file resolves the patient through `getPatientForContext()` before rendering. It shows the patient name, patient ID and department in the header and exposes only authorized surfaces:

- Profile/overview
- Edit patient
- Appointment action
- Appointment history
- Payment action
- Paid/Due summary when money visibility is permitted
- Clinical file
- Reports upload
- Reports/media gallery

The clinical file remains `/patients/[patientId]/clinical` and contains the department-appropriate clinical history/workspace. V1-B does not create a second duplicate Patient Hub or a parallel patient writer.

The Patient Hub payment button deep-links to the existing canonical `/payments?patientId=...` workspace. It does not create a second payment form or bypass V1-A finance logic.

## Dental phone rule

Dental phone number is optional.

- The registration UI labels Dental phone as optional and does not mark the phone input required.
- `registerPatient()` runs duplicate-phone matching only when the normalized phone is non-empty.
- Blank phone is stored as blank and therefore is not treated as a duplicate-phone key.
- Existing duplicate protection remains active when a non-empty phone is supplied.

## Patient mutation lock authority

V1-B reuses the V1-A distributed mutation lock. No Redis or second locking authority is introduced.

### Registration

`patient-register:{department}`

The lock covers registration duplicate-phone checking, existing-ID inspection/ID allocation, and the Sheet write. Registration is department-scoped because two new patients in the same department must not allocate from the same pre-write state.

### Existing patient mutation

`patient:{department}:{patientId}`

This is the canonical same-patient mutation scope for patient profile updates and patient-scoped clinical writes. It serializes conflicting operations for one patient while allowing unrelated patients to proceed independently.

Physio clinical write routes using this scope:

- Quick assessment
- Treatment-plan creation/supersession
- Treatment-session creation and `Sessions_Done` update

Dental clinical note writes use the same pattern with `Dental` as department.

This prevents two concurrent treatment-plan creators from both reading the same active-plan state and prevents treatment-session number / `Sessions_Done` read-check-write races from competing with another same-patient clinical mutation.

Production distributed-lock mode remains fail-closed as established in V1-A.

## Clinical authority

V1-B does not change clinical business-record authority.

Physio clinical records remain Google Sheets-backed:

- `10_Assessments`
- `12_Treatment_Plans`
- `05_Treatments`

Dental clinical treatment notes remain Google Sheets-backed in Dental `05_Treatments`.

The new work only aligns same-patient concurrency and retains existing server-side assignment/cross-cover and department checks.

## Finance authority

V1-A remains authoritative for payment mutation behavior.

Patient Hub only exposes payment creation when `payment.create` is authorized. The existing `/api/finance/payment` -> finance production wrapper -> Sheets/Supabase V1-A flow remains unchanged, including V1-A audit atomicity, request-id idempotency and finance lock behavior.

## Appointment / Chamber boundary

V1-B does not consolidate or replace Appointment/Chamber writers. Patient Hub uses existing appointment read/create surfaces only. Appointment/Chamber authority consolidation remains V1-C scope.

## V1-B production invariants

Before merge/deploy:

- Physio/Dental cross-department access must fail closed.
- Owner/Manager/Receptionist payment visibility must follow role + department authorization.
- Therapist/Dentist base roles must not gain `payment.create`.
- Dental blank-phone registration must remain valid.
- Same-patient profile/clinical mutations must use the canonical patient lock scope.
- Google Sheets must remain patient/clinical business-record authority.
- V1-A finance behavior must remain green.
- Latest PR head must pass impact gate, lint, domain tests, and production build.
- No fake production patient, clinical, appointment or finance write is required for verification.

Validation authority: GitHub CI on the exact PR head is required before merge readiness is reported.
