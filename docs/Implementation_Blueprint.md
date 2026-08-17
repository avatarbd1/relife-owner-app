# Relife App V1 — Implementation Blueprint

Status: **Verification blueprint / business-logic coding hold**  
Golden functional reference: `relife-clinic-os@db0c605ea524d79dec7cd00c1e6dcc564966b50e`  
Production implementation: `relife-owner-app` current `main`  

## 0. Non-negotiable consolidation rule

Golden Bot V3 is a **functional/UX reference**, not a second production writer. The web/PWA remains the production application. A Bot capability is restored by implementing the same or better user outcome through the current app architecture. Unsafe Bot behavior (destructive correction, positional schema assumptions, weak audit, multi-write hazards) must not be copied.

Definition of done for each restored workflow:

`Bot capability preserved -> App data correct -> role/department correct -> user flow equal/better -> failure recovery works -> regression impact checked -> live user-flow verified`

No unrelated feature work until required V1 parity rows are green.

---

# 1. Golden Bot V3 verified capability inventory

## 1.1 Roles present in Golden snapshot

- Owner
- Manager
- Receptionist
- Therapist
- Dentist
- Dental_Assistant
- Auditor
- System Admin

The visible menu was fully defined mainly for Owner/Manager/Receptionist/Therapist; the other role enums and department/access infrastructure already existed. Role behavior must therefore be compared at action level, not just menu-button count.

## 1.2 Golden operational areas verified from handler registration and `roles.py`

### Identity / navigation
- `/start`
- patient search command/flow
- role-aware main menus
- hidden/submenu actions
- department-scoped access helpers

### Patient
- registration
- patient list/search
- patient file/history
- patient report/file view
- patient-card inline actions
  - Owner: History / Appointment / Payment / Treatment
  - Receptionist: History / Appointment / Payment
  - Therapist: History / Treatment
  - Manager: History / Appointment / Payment

### Appointment / schedule
- create appointment
- search/select patient
- capture missing Physio gender
- date selection
- time selection
- provider/therapist selection or auto-selection
- confirmation
- today schedule
- appointment status callbacks
- patient-list quick appointment entry

### Attendance
- Check In
- Break Out
- Break In
- Check Out
- clinic location validation
- late/working-hour/overtime calculation

### Clinical / treatment
- today patients and sessions
- receive patient
- treatment note
- keep same treatment plan or modify
- edit Exercise
- edit Electrotherapy
- edit Manual Therapy
- patient comment
- progress/pain score
- AI question inside treatment flow
- treatment history
- Dental procedure workflow

### Assessment / Treatment Plan
- detailed assessment/TP
- Quick Assessment + Plan
- 7 / 14 / 21 / 28 session choices (+ custom input)
- quick protocol parsing into Exercise / Electro / Manual
- review before save
- edit Exercise / Electro / Manual / Finding / Sessions before save
- duplicate active-plan guard

### Patient clinical summary added in Golden commit
- diagnosis/problem
- latest assessment/finding
- active plan
- session progress
- Exercise
- Electro
- Manual

### Finance
- payment recording
- payment/session information
- same-day correction/delete legacy flow
- salary payment/history/my payments
- expense request
- expense approval/reject
- approved expense payment
- expense tracker/rejected expenses
- reception cash handover
- cash receive/accept
- cash movement history
- custody balance
- owner clinic expense
- household withdrawal
- Physio/Dental finance dashboards
- finance overview/date-range views

### Reports / tools
- daily register
- date-based report
- reports and analytics
- inventory + stock change log
- patient report/media
- Staff AI query
- Clinical AI
- Case Study
- learning progress
- delete log
- data audit

## 1.3 Golden Sheets touched

Golden `config.py` identifies these production tabs:

`02_Patients`, `03_Attendance`, `04_Appointments`, `05_Treatments`, `06_Payments`, `07_Expenses`, `08_Staff`, `Staff_Department_Access`, `09_Inventory`, `10_Assessments`, `11_Packages`, `12_Treatment_Plans`, `13_Salary`, `14_Reports`, `15_Case_Studies`, `16_Delete_Log`, `17_Inventory_Log`, `18_Learning_Progress`, `19_Consent`, `20_Data_Audit`, `21_Cash_Movement`.

Golden Bot routes all Google Sheets access through `03_Bot/sheets.py`, not directly from UI handlers. That wrapper already contains tenant/worksheet identity checks, department authorization helpers, cache invalidation, retry/rate limiting, and a mixture of header-aware and positional mutations.

## 1.4 Golden write-safety classification

### Safer patterns already present
- worksheet identity assertion
- department-scoped patient/appointment resolution
- header lookup for some fields (e.g. Gender)
- cache invalidation after writes
- retry/rate-limiting wrapper
- unified metadata append helper

### Unsafe/legacy patterns that must NOT be ported
- positional update columns remain in several helpers
- payment/correction legacy lifecycle could hard-delete and then compensate related rows
- some operations require multiple write calls without a true database transaction
- generated sequential IDs can race without a shared transactional allocator
- in-memory conversation draft state can disappear with process/session loss

---

# 2. Current App verified state

## 2.1 Current screens/routes present

Verified dashboard routes include:

- `/home`
- `/patients`, `/patients/new`, `/patients/[patientId]`, `/patients/[patientId]/clinical`
- `/appointments`, `/appointments/new`
- `/chamber`, `/chamber/chat`
- `/daily`
- `/payments`
- `/expenses`
- `/finance`, `/finance/cash-receive`, `/finance/history`, `/finance/operations`
- `/salary`
- `/reports`
- `/corrections`
- `/audit`
- `/security`, `/security/passkeys`, `/security/staff-access`
- `/settings`
- `/tools`
- `/register`
- `/pwa`
- compatibility routes `/operations`, `/menu`, `/more`

Current APIs already exist for patients, appointments, attendance, clinical assessment/plan/session/Dental, finance payment/expense/cash/salary, chamber runtime/scheduling/comms, corrections, inventory, report upload, Clinical AI, Staff AI, case study, authentication/passkeys, and staff enrollment.

Therefore the old claim “most write endpoints missing” is obsolete.

## 2.2 Current migration registry

### Live
- owner dashboard
- staff authentication
- role + department authorization
- patients
- appointments
- attendance
- daily register
- Physio clinical
- Dental clinical
- inventory

### Partial / parity still open
- payments
- expenses
- cash custody
- salary
- clinical AI / case study
- admin/settings

A route existing does **not** make a module parity-complete.

## 2.3 Current patient-file comparison

Current patient file already improves on Bot with:
- profile editing
- permission-scoped Paid/Due display
- reports/media gallery
- report upload
- appointment history
- direct appointment creation
- clinical-file link

But Bot V3 had a stronger operational hub:
- direct Payment action from patient context
- direct Treatment action from patient context
- role-specific quick action set
- compact clinical snapshot visible with the patient

### Required V1 change
Patient File becomes the operational hub again, while keeping current App improvements.

Expected role-aware quick actions:
- Owner: Payment / Appointment / Treatment or Clinical / History or Reports
- Receptionist: Payment / Appointment / History or Reports
- Therapist: Treatment / Clinical / History
- Manager: Appointment / History, plus payment only if final desired permission policy explicitly allows it
- Dentist: Dental Clinical / Appointment / Reports
- Dental Assistant: only explicit allowlist after review
- Auditor: no clinical mutation shortcuts

---

# 3. Live data-source and schema map

Both live workbooks currently report timezone `Asia/Dhaka`.

## 3.1 Physio workbook verified schema highlights

### `02_Patients`
Patient identity/profile + Department + Diagnosis + Therapist + Session_No + Treatment_Plan + Payment_Status + Total_Bill + Paid + Due + Advance_Balance + provenance metadata.

### `04_Appointments`
Base appointment fields plus:
- `Received_By`
- `Assigned_Bed_ID`
- `Modalities_JSON`
- `Expected_Duration_Min`
- `Timeline_ID`
- `Booking_Validation_Version`

### `05_Treatments`
Base treatment fields plus:
- Department
- Pain_Before
- Pain_After
- Response
- Modification

### `06_Payments`
Receipt/date/SL/patient/department/amount/discount/due/method/received-by/remarks/time/session-type + provenance.

### `07_Expenses`
Type / Paid_From / Status / Requested_By / Approved_By / Approved_At / Paid_By / Paid_At / Department.

### `08_Staff`
Role + Machines + Primary_Department + Department_Access + Clinical_Write_Scope + Financial_Access.

### `12_Treatment_Plans`
Plan_ID / Patient / Diagnosis / Total_Sessions / Sessions_Done / Exercise / Electrotherapy / Manual / creator/date/status/Department.

### `21_Cash_Movement`
Status + confirmation + Department + source/destination custodian IDs + requested/received/difference + request/accept/complete/update timestamps.

### Verified schema defect
`18_Learning_Progress` currently contains `Full_Name\t` (trailing tab), not a clean `Full_Name` header.

## 3.2 Dental workbook verified divergence

Dental uses the same core patient/payment/expense/cash/report structures and has added treatment/assessment/package/TP/case/delete/inventory-log/learning tabs.

Important divergences:
- Dental `04_Appointments` has `Received_By` but not the extra Physio Chamber allocation/timeline columns.
- Dental `08_Staff` does **not** expose a `Department_Access` header; it has Primary_Department, Clinical_Write_Scope, Financial_Access.
- Dental `18_Learning_Progress` uses clean `Full_Name`, unlike Physio.

### Pre-flight rule
Do not assume Physio and Dental workbook schemas are identical. Every shared repository/helper must validate the actual required headers per workbook.

---

# 4. Current App read/write architecture and safety

## 4.1 Sheets access

`lib/data/googleSheets.ts` provides:
- private service-account access
- batched reads
- retry/backoff
- in-flight de-duplication
- bounded fresh/stale cache
- cache invalidation after write
- values update/append
- Spreadsheet `batchUpdate`

## 4.2 Multi-operation Sheet mutation

`lib/webos/sheetTransaction.ts` can place entity mutations and audit writes in one Google Spreadsheet `batchUpdate` request.

This is materially safer than a sequence of unrelated HTTP requests, but it is still not equivalent to a Postgres transaction and it still allows explicit row/column coordinates internally.

## 4.3 Mutation locking

`lib/webos/mutationLock.ts` serializes read-check-write mutations **within one Render process**.

Limitation: it is process-local. It is safe only while the deployment is a single mutation authority/process. Before horizontal scaling, replace with datastore-enforced uniqueness/locking or a distributed lock.

## 4.4 Payment implementation — concrete finding

Current payment flow is much safer than Golden Bot:
- header-driven required-column validation
- patient Department check
- request-id idempotency marker (`WEBREQ:`)
- random web receipt ID
- patient balance updates + payment append in one Spreadsheet batch update
- schema mismatch fails closed

But two real gaps remain:

### P0-FIN-01: same-patient concurrent payment race
Payment reads Paid/Due, calculates new values, then batch-writes them. The payment command is not currently wrapped by the process mutation lock. Two simultaneous requests for the same patient can both calculate from the same old balance.

Required before payment parity sign-off:
`payment:<department>:<patientId>` mutation serialization or datastore atomicity + concurrent-payment regression test.

### P0-FIN-02: audit is outside payment batch
The payment row/patient balance batch completes first. `PAYMENT_CREATED` audit append is a second request and catches/logs audit failure instead of failing the payment.

Required decision:
- include audit row in the same Spreadsheet batch while Sheets is authoritative, or
- make Supabase finance operation the durable transactional audit authority before declaring cutover.

No hard-delete correction should return.

---

# 5. Current App role matrix (verified)

## Owner
Broad operational + finance + clinical + chamber + audit + settings access across explicitly authorized departments.

## Manager
Patient create/update, appointments, operational reports, expense read/request, cash read/accept, team attendance, clinical read, inventory write, chamber receive/run. No owner-only salary or financial-report powers.

## Receptionist
Patient create/update, reports upload/read, appointments, payment read/create, own-today correction, expense request/pay, cash read/request, attendance self, inventory read/write, chamber read/receive.

## Therapist
Patient/report read, report upload, appointment read/create, attendance self, clinical read/write subject to assignment/cross-cover, inventory read, chamber read/run. No finance mutations.

## Dentist
Dental-scoped patient/report/appointment/clinical access; clinical write subject to assignment/cross-cover. No finance mutations by default.

## Dental_Assistant
Current production allowlist intentionally empty. **Parity blocker until desired role is explicitly defined and tested.**

## Auditor
Read-only register/operational+financial reports/expense/cash/salary/team attendance/audit. No patient create, finance mutation, clinical write or chamber run.

## System Admin
Settings only; no implicit patient access.

## Golden-vs-current policy note
Golden patient-card shortcuts are a UX baseline, **not automatically the desired permission policy**. If Golden Manager had Payment but current policy intentionally removes it, the blueprint records this as an explicit policy change rather than reintroducing privilege silently.

---

# 6. Ten major user flows: Bot V3 vs current App

| # | Task | Golden Bot behavior | Current App | V1 status / friction |
|---|---|---|---|---|
| 1 | Register patient | guided conversation, role/department scoped | dedicated form | Keep App form; validate duplicate + Dental phone optional + fast save. |
| 2 | Find/open patient | search/list -> patient card -> inline actions | patient list -> patient page; capabilities split | **Regression:** restore operational hub shortcuts. |
| 3 | Book appointment | patient context, guided date/time/provider, missing-gender capture, auto-provider | appointment form + advanced validation | Keep App safety; reduce taps and preserve patient context. |
| 4 | Receive/start daily work | Today patients -> receive -> treatment workflow | Chamber + clinical routes | App is stronger technically; must align actual receive-time queue and remove navigation friction. |
| 5 | Quick Assessment + TP | category/findings/protocol/session -> review/edit -> save | clinical workspace exists | Must verify same or lower effort and preserve review/edit of Exercise/Electro/Manual/Finding/Sessions. |
| 6 | Treatment/session note | guided same/edit plan + modalities + comment + pain/progress | clinical session workspace | Verify direct patient action, structured pain before/after, response/modification without excess taps. |
| 7 | Take payment | patient card direct -> amount/method/confirm | payments screen/API; no patient-card Take Payment | **Clear UX regression:** add contextual Payment shortcut and close concurrency/audit gaps. |
| 8 | Expense/cash | role-aware guided request/approve/pay/handover/accept | finance pages/APIs exist, registry partial | Functional lifecycle must reconcile balances/audit before green. |
| 9 | Attendance | direct check in/break/check out + location | attendance API/workflow live | Verify duplicate taps/location/refresh recovery as user. |
| 10 | Report/AI/inventory/tools | menu-driven reports, media, Case Study, Clinical AI, Staff AI, inventory | routes/APIs mostly exist; AI/admin partial | Restore discoverability/notification parity; verify minimum-necessary AI data and role scope. |

---

# 7. Notification and reminder parity

Telegram transport provided natural push/reminder behavior. The current App has chamber alert/comms components, but Bot-equivalent operational notification lifecycle is not yet proven.

V1 requirement is outcome parity, not Telegram duplication:
- event created
- intended role/staff receives it
- unread state visible
- opening marks read when appropriate
- task completion clears/archives the alert
- refresh/reconnect does not resurrect completed alerts
- critical approval/reminder has a reliable delivery/fallback path

Do not call notification parity complete based on a popup component alone.

---

# 8. Architecture/source-of-truth decisions

Existing architecture target is correct:

`UI -> API -> domain command/query -> repository/transaction -> persistence -> audit`

## Production authority rule
No entity may gain a second independent writer during parity work.

### Current direction
- Patients/profile/legacy ledgers: Sheets-compatible until explicit cutover
- Chamber high-frequency runtime: Supabase target/authority depending on configured mode
- Finance: currently Sheets-first with optional Supabase shadow/production operation recording; parity cannot be signed off until the authoritative mode and audit semantics are explicit
- Report/media bytes: file storage; metadata/reference in data layer

### Required source-of-truth registry before runtime PRs
For each entity record:
- authoritative store
- read compatibility store
- write owner command
- audit authority
- idempotency key
- rollback/compensation path

Entities:
Patient, Appointment, Chamber Booking, Chamber Runtime, Treatment, Assessment, Treatment Plan, Payment, Expense, Cash Movement, Salary Payment, Attendance, Inventory Mutation, Report Metadata, Notification/Task.

---

# 9. Pre-flight blockers before business-logic consolidation

## BLOCKER A — Schema contract
- normalize/fix Physio `18_Learning_Progress.Full_Name\t`
- explicitly handle Dental `08_Staff` missing `Department_Access`
- inventory every remaining positional mutation in current App and Golden reference
- require header validation before mutable Sheets operations

## BLOCKER B — Payment concurrency + audit durability
- serialize same-patient payment calculation/write or move invariant to transactional datastore
- put authoritative payment audit in the same durable commit boundary
- retain idempotency marker
- test simultaneous two-payment scenario

## BLOCKER C — Dental Assistant desired policy
- define exact allowed screens/actions
- keep Physio denied
- automate permission tests

## BLOCKER D — Chamber one-engine ownership
Current migration-era schedulers must not continue diverging. Final booking/runtime command layer must own bed, therapist, gender-room, patient duplicate and machine conflicts.

## BLOCKER E — Live user-flow evidence
Code tests cannot prove usability. Each domain needs at least one authenticated clinic-device flow with expected data read/write verified before green sign-off.

---

# 10. Serial implementation order after pre-flight

This is dependency order, not calendar estimates.

1. **Schema + source-of-truth contract**
2. **Permission policy gaps** (especially Dental Assistant and any intentional Golden-vs-current difference)
3. **Patient Hub parity**
4. **Appointment + Chamber single workflow**
5. **Clinical: Quick Assessment/TP + Treatment session parity**
6. **Payment lifecycle + reconciliation**
7. **Expense lifecycle**
8. **Cash custody lifecycle**
9. **Salary lifecycle**
10. **Attendance + daily register**
11. **Reports/media + Inventory**
12. **Clinical AI / Staff AI / Case Study**
13. **Notification/reminder lifecycle**
14. **Admin/settings/audit/corrections**
15. **Whole-clinic role/device/E2E sign-off**

A domain is not left half-fixed to start an unrelated domain unless a blocking dependency requires it.

---

# 11. Required test gates per domain

## Gate A — Automated behavior
- permission tests
- schema/header tests
- idempotency tests
- domain invariant tests
- duplicate/double-submit tests
- failure-path tests

## Gate B — Integration/data
- intended row/table changes only
- audit evidence created
- no cross-department leakage
- cached read invalidated/refreshed correctly
- legacy rows still readable

## Gate C — User flow
- authenticated role
- real screen/button sequence
- expected tap/step count recorded
- back/refresh/retry tested
- no dead end or hidden required action

## Gate D — Impact/regression
- affected roles
- affected screens/routes
- affected data stores
- finance impact
- chamber impact
- notifications/PWA impact
- rollback procedure

## Gate E — Live verification
- deployed revision known
- production flow completed
- resulting record/audit checked
- logs checked for new runtime errors

Only after A+B+C+D+E: `✅ Done`.

---

# 12. GO / NO-GO

## GO
- Continue documentation/parity auditing.
- Fix isolated schema/access pre-flight defects with narrowly scoped PRs after backup/impact review.
- Build tests that protect existing behavior.

## NO-GO (currently)
Do **not** begin broad Patient/Finance/Clinical/Chamber business-logic consolidation until:

1. source-of-truth registry is frozen,
2. schema anomalies above are resolved or intentionally adapter-handled,
3. same-patient payment concurrency/audit boundary is decided,
4. Dental Assistant target policy is explicit,
5. current role/user-flow baseline is recorded.

This NO-GO is a safety gate, not a request for more speculative planning. Each blocker should be closed serially and then the first domain (Patient Hub) begins.

---

# 13. Evidence limitations

- Repository code, Golden Bot commit, current app code, and live Sheet headers were inspected.
- A literal browser DevTools Network-tab session cannot be performed from the current connector environment.
- Therefore route/command write wiring can be verified from server code and resulting live data, but UI click/network behavior must remain **unverified** until an authenticated browser/device user-flow test is performed.
- No feature is marked production-complete solely from this blueprint.
