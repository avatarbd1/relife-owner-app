# Relife Clinic OS — Full Web/PWA Migration

Status: W0 foundation

## Objective

Evolve the existing Relife Owner PWA into the full Relife Clinic OS Web/PWA without interrupting the live Telegram bot. The web app will progressively replace bot workflows while continuing to use the existing Physio and Dental data contracts during migration.

## Non-negotiable migration rules

1. No big-bang rewrite.
2. The Telegram bot stays live until the equivalent web workflow reaches functional parity and passes production validation.
3. No live bot feature is deleted merely because a web screen exists.
4. Role and Department are separate authorization dimensions.
5. Every protected read/write is fail-closed.
6. Menu visibility is never treated as the security boundary; authorization is enforced server-side on the actual data action.
7. Existing audit, cash-custody, department, salary and approval semantics must be preserved.
8. Shared records retain Department. Combined business reporting may aggregate totals but must not erase source Department.
9. Clinical notes remain append-only and author/assignment rules remain enforceable.
10. During the Sheets era, both web and bot operate against the same canonical live data. A database migration, if introduced later, is a separate controlled phase.

## Source systems

### Telegram production source

Repository: `avatarbd1/relife-clinic-os`

Primary runtime: `03_Bot/bot.py`

Supporting production modules include role/menu policy, attendance/location, clinical AI, case study, finance/cash custody, Google Sheets access, department scope and multi-tenant helpers.

### Web target

Repository: `avatarbd1/relife-owner-app`

The current Owner PWA already provides production foundations for:

- installable PWA shell;
- signed owner session;
- private Google Sheets access;
- Physio / Dental / Combined scope;
- Owner Home, Finance, Patients and Reports;
- protected Owner expense and cash-movement controls;
- PIN-gated writes and audit logging.

The app is now the migration target for all clinic roles, not a separate replacement project.

## Canonical role model

Roles:

- Owner
- Manager
- Receptionist
- Therapist
- Dentist
- Dental_Assistant
- Auditor
- System Admin

Departments:

- Physio
- Dental
- All

Owner has explicit `All` scope. Unknown role, unknown department, missing staff mapping or unresolved record department must deny access.

## Module map

| Module | Major bot capability | Web state | Migration phase | Retirement condition |
|---|---|---|---|---|
| Owner dashboard | cash, finance, reports, approvals | live | W0/W1 | already web-primary after QA |
| Authentication / staff identity | Telegram user mapping | owner-only web auth | W1 | staff login + server authorization verified |
| Role + department access | role menus + scope layer | foundation | W1 | all protected web routes/actions covered |
| Patient registration | patient create + duplicate checks | patient read/search live | W2 | create/edit/duplicate-safe parity |
| Patient files | list, history, direct ID lookup | read/search live | W2 | scoped file view parity |
| Appointment | create, therapist/date/time, today schedule | not migrated | W2 | collision-safe scheduling parity |
| Reception billing | payment collection, due, receipts | finance reads live | W3 | payment create/void/receipt parity |
| Expenses | request, approve, pay, rejected history | owner approve/reject live | W3 | requester + payer + audit parity |
| Cash custody | handover, accept, balances/history | owner accept/reject live | W3 | reception/manager workflows migrated |
| Salary | commitment, advance/payment/history | owner reporting live | W3 | staff workflow + payment parity |
| Attendance | check-in, break, checkout, location | not migrated | W4 | location and duplicate-guard parity |
| Daily register | operational register | partial reports | W4 | operational parity |
| Assessment | structured physio assessment | not migrated | W5 | scoped clinical create/read parity |
| Treatment plan | plan + assignment | not migrated | W5 | clinical write rules verified |
| Daily treatment note | append treatment note | not migrated | W5 | author/assignment/cross-cover parity |
| Treatment history | patient treatment history | not migrated | W5 | scoped history parity |
| Dental clinical | dental procedures/tooth/lab/material | not migrated | W6 | dedicated dental schema/UI parity |
| Clinical AI | clinical assistant | not migrated | W7 | redaction + role/scope safety verified |
| Case study | case-study workflow | not migrated | W7 | scoped web workflow parity |
| Staff AI query | bot AI query | not migrated | W7 | privacy-safe replacement only |
| Inventory | inventory + log | not migrated | W8 | stock mutation/audit parity |
| Settings / admin | configuration and admin actions | partial | W8 | web-safe admin coverage |
| Telegram notifications | bot transport | live | W9 | optional notification-only role |

## Migration sequence

### W0 — Foundation and parity map

- freeze migration rules;
- create the web module registry;
- create a centralized authorization contract;
- document bot-to-web parity gates;
- make no destructive production changes.

### W1 — Staff authentication and authorization

- replace owner-only identity with staff session identity;
- resolve staff from `08_Staff` and authoritative department-access mapping;
- enforce role + department on server actions;
- create role-specific navigation from permissions, not from client guesses;
- preserve Owner All scope and Auditor read-only behavior.

### W2 — Reception core

Migrate together because they share patient identity and scheduling constraints:

- patient registration;
- patient lookup/file;
- duplicate-phone/identity handling;
- appointments;
- today schedule;
- appointment collision prevention.

### W3 — Money movement

- payment creation and receipts;
- due handling;
- expense request → approval → payment;
- cash handover → acceptance;
- salary advance/payment/history;
- void/reversal instead of destructive deletion;
- audit every consequential mutation.

### W4 — Staff operations

- attendance with clinic-location verification;
- break out / break in / check out;
- duplicate-action guards;
- daily operational register.

### W5 — Physio clinical

- assessment;
- treatment plan;
- assigned patient list;
- append-only daily treatment notes;
- treatment history;
- explicit current-day cross-cover.

Therapists may see clearance/session state but not financial amounts unless explicitly granted a financial permission.

### W6 — Dental clinical

- Dental procedures;
- tooth chart;
- dental treatment plan;
- lab orders;
- material usage;
- Dentist assignment and append-only notes;
- Dental Assistant explicit allowlist before production enablement.

### W7 — AI and documents

- report upload/read;
- Clinical AI;
- case study;
- staff AI replacement with minimum necessary scoped data;
- no whole-sheet patient/staff/payment dumps to external AI.

### W8 — Inventory and administration

- inventory and inventory log;
- controlled settings;
- staff/access administration;
- audit review tools.

### W9 — Telegram retirement

For each Telegram capability:

`bot behavior audit → web implementation → parity tests → live web trial → reconciliation → mark web-primary → retire bot button`

Telegram may remain as a notification/backup transport after operational migration. Full shutdown is optional and happens only after all required parity gates are green.

## Backend boundary

Web UI must never write Sheets directly from client code.

```text
Browser/PWA
   ↓ authenticated request
Next.js server route/action
   ↓ identity + role + department authorization
Domain service
   ↓ validation / duplicate guard / invariant / audit
Data adapter
   ↓
Google Sheets (migration era)
```

Future database storage must replace only the data-adapter layer, not rewrite authorization or domain workflows.

## Parity gate for every migrated module

A bot workflow can be marked retired only when all are true:

- required role(s) can complete it on web;
- forbidden role/department combinations are denied server-side;
- direct-ID access cannot bypass scope;
- duplicate/retry behavior is safe;
- consequential writes are audited;
- live row/state is rechecked immediately before mutation where needed;
- the resulting Sheet/data matches the bot contract;
- production reconciliation passes;
- rollback path exists.

## Immediate next build

W1 starts with **staff identity + centralized access**, then W2 starts with **Patient + Reception**. The existing owner experience remains operational throughout these changes.
