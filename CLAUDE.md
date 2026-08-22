# Relife Clinic OS: Owner Workspace (Web/PWA Primary)

## Claude execution role

Claude is the sandbox artifact builder defined in `docs/RELIFE_ENGINE_LITE.md`.
For each task it receives one complete prompt, changes only the requested scope,
runs available checks, and returns the required handoff artifact. Claude must not
push, create or merge a PR, deploy, access credentials, or mutate live Sheets or
Supabase data. A truthful `BLOCKED.md` is the correct output when required source,
authority, or evidence is unavailable.

## Architecture Decision

**Web/PWA App (relife-owner-app) = PRIMARY** operational system for all clinic staff and owner.
**Telegram Bot (relife-clinic-os) = OPTIONAL** notification/convenience layer only (or removed entirely post-migration).

This is the OPPOSITE of original bot-primary design. App must be production-ready, web-first, and capable of replacing bot completely. Scale target: 10,000 clinics (5000 Physio + 5000 Dental chambers).

---

## Business Scope

- **Clinics**: Multi-tenant, department-isolated (Physio ≠ Dental in billing/records)
- **Departments**: Physio (Male/Female gender tracking, room+bed allocation, inventory) and Dental (no gender tracking)
- **Roles**: Owner, Manager, Receptionist, Therapist, Dentist, Dental_Assistant, Auditor, System_Admin (defined in lib/webos/access.ts ROLE_ACTIONS)
- **Timezone**: Bangladesh (GMT+6)
- **Language**: Mixed Bengali/English in UI
- **Data Source**: Google Sheets (operational source of truth) + Supabase (audit/shadow ledger)

---

## Critical Production Risks (Dual-Writer Problem)

**BEFORE A HIGH-RISK AUTHORITY/WRITER/SCHEMA CHANGE: Review and update `MIGRATION_AUDIT.md`.**

Standard UI, read-only, test, documentation, and bounded canonical-path fixes use
the concise preflight in `AGENTS.md`; they do not require a new full migration audit.

Python bot (relife-clinic-os) and TypeScript app (relife-owner-app) both write to same Google Sheets:
- `06_Payments` — Both create payment rows (bot via Telegram, app via web)
- `02_Patients` — Both register patients (bot CLI, app form)
- `04_Appointments` — Both book appointments (bot CLI, app calendar)
- `07_Expenses` — Both create expense requests (bot, app)
- `21_Cash_Movement` — Both create cash transfer requests (bot, app)
- `13_Salary` — Both record salary payments (bot CLI, app form)

**Race Condition Risk**: No row-level locking in Sheets. If bot and app write same sheet concurrently → data corruption.

**Mitigation Strategy**:
1. **During Migration**: Unify ALL write operations under single TypeScript API (lib/domain/finance/, lib/domain/clinical/, lib/domain/reception/). Remove Python write logic.
2. **Mutation Locks**: App uses withMutationLock() — extend to ALL operations (not just payment). Verify locks work in multi-instance deployment.
3. **Idempotency**: requestId deduplication mandatory for all financial operations.
4. **Supabase Two-Ledger** (if concurrent bot+app during transition): Switch to supabase DB mode (not shadow). Sheets becomes read-only cache; Supabase is canonical write log.

---

## Finance Business Rules (Non-Negotiable)

These rules MUST work identically in both bot and app. Do NOT regress:

1. **Payment Collection**:
   - Read only from `06_Payments` sheet
   - Patient ID + date match determines due
   - Session count tracked per payment
   - Department isolation: Physio patients see Physio payments only
   - Discount entry with reason required
   - Receipt number server-issued (not user input)
   - Duplicate detection via (patientId, amount, requestId)

2. **Cash Custody** (NOT expense):
   - Cash moves Reception → Treasury → Bank (three positions)
   - Movement is request→accept workflow (owner approval)
   - NOT subtracted from collection (separate ledger)
   - Audit trail: who requested, who accepted, actual amount if different

3. **Expense Workflow**:
   - Staff requests (amount, category, reason, receipt)
   - Owner approves/rejects
   - Approved → mark paid
   - NOT subtracted from payment collection
   - Budget tracking by category

4. **Salary**:
   - Fixed commitment per staff + department
   - Tracking: paid vs. advance vs. unpaid
   - Month-wise settlement
   - Bank export for bulk transfer

5. **Financial Position (Month Business)**:
   - Collection = sum(06_Payments, date in month, department scoped)
   - Liability = variable clinic cost + fixed overhead + fixed salary commitment
   - Surplus/Uncovered = collection - liability
   - Recovery % = collection / liability

6. **Department Isolation**:
   - Physio data strictly separate from Dental
   - Staff can see ONLY their department (except Owner + Auditor with explicit scope toggle)
   - Patient records department-scoped
   - Salary, expenses, cash movements all department-scoped

---

## Migration Strategy (Phased, NOT Reckless Rewrite)

### PHASE 0: Authority & Audit (Blocking Gate)
**Produce MIGRATION_AUDIT.md with**:
- Dual-writer risk matrix: exact sheet + column locations where Python and TypeScript both write
- Function parity matrix: every Python bot.py function vs. TypeScript equivalent (or gap)
- Authority decisions: after migration, which implementation is canonical (TypeScript)
- Concurrency protection: how to unify mutation locks
- Cutover plan: phases, parity gates, rollback triggers

**Success Criteria**:
- MIGRATION_AUDIT.md exists
- All dual-writer operations documented
- No surprises during implementation

### PHASE 1: Core Operations (Inventory + Authority)
**Build in TypeScript**:
1. Daily Register UI (real-time dashboard, concurrent entry, offline queue)
2. Appointments (calendar, booking, conflict detection, room allocation for Physio)
3. Patient Registration (form UI, bulk import, duplicate detection)
4. Treatment Entry (rich notes, photo upload, templates, AI suggestions)
5. Inventory (stock tracking for Physio, reorder points, expiry dates)

**Remove from Python**: Do NOT call Python for these; TypeScript is canonical.
**Verify**: Department isolation, mutation locks, idempotency on all writes.

### PHASE 2: Finance Authority (Highest Safety)
**Migrate Authority**:
1. Expense Request → Approval → Payment (UI form, wraps existing API)
2. Cash Movement Request → Acceptance (UI form)
3. Salary Review → Payment (UI form, with bulk export)
4. Unify all financial mutations under lib/domain/finance/ (single source of truth)

**Remove from Python**: Python finance flows become thin CLI wrappers calling TypeScript API (if kept at all; likely removed entirely).
**Verify**: All finance test cases from Python port to TypeScript + pass.

### PHASE 3: Support Systems (Parallel)
1. Staff Management (roles, permissions, salary config)
2. Reports & Analytics (dashboards, export, custom periods)
3. Audit Dashboard (full trail of changes, by whom, when, why)
4. SMS/Notification Integration (appointment reminders, approval alerts)

### PHASE 4: Telegram Thin Client (Optional)
Convert bot to thin API client:
- Remove all Python business logic
- Keep ONLY Telegram formatting, command parsing, notification handling
- Call TypeScript API endpoints for all operations
- Or delete bot entirely if not needed

---

## Constraints (What NOT to Do)

1. **DO NOT rewrite recklessly**: Follow PHASE 0 → audit first, identify parity gaps, plan controlled migration.
2. **DO NOT create new dual logic**: If Python bot needs feature X, build in TypeScript first. Do NOT duplicate.
3. **DO NOT change Sheets schema**: Columns must remain stable. New data? Add new sheet with proper references.
4. **DO NOT deploy app until PHASE 1 complete**: App must be self-sufficient for staff operations before bot is removed.
5. **DO NOT merge dual-writer code**: During migration, disable Python write path immediately after TypeScript equivalent launches (do not run both).
6. **DO NOT skip tests**: Port Python finance tests to TypeScript Jest. All existing test cases must pass.

---

## What App Already Has (Fully Working)

✅ Home dashboard (real-time collections, cash position)
✅ Finance dashboard (month business position, salary status)
✅ Payment collection interface (with offline support, receipt generation)
✅ Patient list + due tracking (department-scoped)
✅ Appointments view (today's schedule, status)
✅ Authentication (passkey-based)
✅ Role-based access control (Owner, Manager, Therapist, Receptionist, Auditor)
✅ Mutation locks (concurrency safety for writes)
✅ Supabase shadow sync (optional dual-ledger audit trail)

## What App Needs (Gaps vs. Bot)

❌ Daily Register UI (staff check-in/out, patient counter, session counter, real-time board)
❌ Appointment booking (calendar with room/bed allocation for Physio, conflict detection)
❌ Treatment entry UI (rich notes, photos, templates, AI suggestions)
❌ Patient registration form UI (currently exists, needs enhancement + bulk import)
❌ Expense approval forms (API ready, UI missing)
❌ Cash movement approval forms (API ready, UI missing)
❌ Salary payment forms (API ready, UI missing)
❌ Inventory module (stock tracking, low stock alerts)
❌ Clinical AI in web UI (case studies, assessment templates — currently in bot only)
❌ Reports & analytics (detailed dashboards, export, trends)
❌ Audit dashboard (full change trail)

---

## Success Condition

**App is Production-Ready When**:
1. All core operations (daily register, appointments, treatments, payments, patients) work in web UI
2. ZERO dual-writer code (Python bot logic removed or converted to thin client)
3. All finance business rules verified in TypeScript tests (Python tests ported)
4. Department isolation confirmed (Physio ≠ Dental, staff see only their department)
5. Mutation locks + idempotency verified under load
6. Can scale to 10,000 concurrent users (deployment config verified)
7. Audit trail complete (who did what when)
8. Staff trained + using app exclusively
9. Bot (if kept) is notification-only, calls app APIs

---

## Implementation Guidelines

1. **Read before edit**: Always Read the file/spec first.
2. **Domain-first**: Put business logic in lib/domain/, not in components or API routes.
3. **Test-driven**: Write tests BEFORE implementation. Port Python tests.
4. **Mutation safety**: Every write uses withMutationLock(), returns idempotent result.
5. **Department scoping**: Every data read filters by department. Every write checks department access.
6. **Offline-first**: PWA + IndexedDB queue for writes. Sync when online.
7. **No breaking changes**: If changing schema, add new column/sheet; don't delete existing.

---

**Start rule**: classify the task using `AGENTS.md`. Use PHASE 0 only for a high-risk
authority, writer, schema, migration, or cutover decision. Otherwise reuse the
existing audit and canonical path, then produce the artifact contract output.
