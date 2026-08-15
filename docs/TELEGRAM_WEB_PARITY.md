# Telegram → Web parity

This file tracks production-established Telegram workflows mirrored into the Relife Web/PWA.

## Shared rules

- Telegram remains a compatibility/source-of-truth reference during migration; Web writes use the same Google Sheets workbooks.
- Every Web read/write is re-authorized server-side by live Staff role + department scope.
- Physio and Dental data remain department-separated unless the caller has explicit `All` access.
- `Dental_Temporary_Data_Entry` is not a general Receptionist clinical permission. Web mirrors the Telegram fail-closed rule: Receptionist + primary Dental + Dental-only access + exact scope flag.
- Reception → Home Treasury/Bank is a cash movement, not an expense.

## Web routes

| Telegram workflow | Web route | Notes |
|---|---|---|
| Home | `/home` | role-aware landing |
| Attendance | `/daily` | Check In, Break Out/In, Check Out, team readiness when allowed |
| Patient registration | `/patients/new` | Physio/Dental scoped |
| Patient list/file | `/patients` | live scope + role enforcement |
| My Patients / Today | `/patients?view=today` | Therapist/Dentist appointment-linked view |
| New appointment | `/appointments/new` | duplicate/capacity protection |
| Today appointments | `/appointments` | scoped list + status update for roles with `appointment.update` |
| Physio clinical | `/patients/{id}/clinical` | assessment, plan, treatment session/history |
| Dental clinical | `/patients/{id}/clinical` | Procedure → Tooth/Area → Clinical note → Status → history |
| Payment / finance actions | `/operations` | payment, expense, handover, salary according to permission |
| Cash handover receive | `/finance/cash-receive` | pending handover acceptance/rejection + actual received amount |
| Expense / cash / salary history | `/finance/history` | scoped read history; rejected expenses included |
| Daily Register | `/register` | dual-department 06_Payments; money hidden without amount permission |
| Owner dashboard | `/finance` | Physio/Dental/Combined scopes |
| Reports | `/reports` | role + department scoped |
| Physio Tools | `/tools` | AI, case studies, inventory, Physio history/report utilities |
| Owner controls/settings | `/more` | owner approvals + security/staff access |
| Telegram menu map | `/menu` | role-specific navigation to the mirrored workflows |

## Intentional boundaries

- `Dental_Assistant` remains fail-closed until a production allowlist is explicitly approved.
- Physio-specific AI/case-study/inventory internals are not exposed as Dental clinical tools merely for visual parity.
- Owner-only controls remain owner-only even when another role can perform a narrower equivalent operation; e.g. Manager cash acceptance uses `/finance/cash-receive`, not Owner `/more`.
