<!-- NEXA-START-HERE -->
> **যেকোনো AI agent (Claude, Codex, Gemini, ChatGPT) — কাজ শুরুর আগে বাধ্যতামূলক:**
> 1. পড়ো: laptop/WSL-এ `/mnt/c/Users/Avatar/NexaControl/START_HERE.md` (Windows: `C:\Users\Avatar\NexaControl\START_HERE.md`)।
>    Laptop দেখতে না পেলে: Google Drive → "OWNER COMPANY REGISTRY — Master / NexaControl — AI Handover (START HERE)" → `00 START_HERE` ও `01 PLAN`।
>    তারপর সেখানে বলা ফাইলগুলো: PLAN.md, decisions/, records/, playbooks/।
> 2. পড়া শেষে Owner-কে ৫ লাইনে বলো: এখন কোন Stage, এই কাজটা কোন Stage-এর, আর আগে থেকে কী আছে যা reuse করবে।
> 3. Merge, deploy, কিছু মোছা বা টাকার কাজ Owner-এর অনুমতি ছাড়া নয়। প্রমাণ = laptop-এ local যাচাই (GitHub CI বা AI-এর কথা নয়)।
> 4. কাজ শেষে NexaControl-এর `records/who-did-what.md`-এ এক লাইন। নিয়ম/সিদ্ধান্ত এই repo-তে নয়, NexaControl-এ।
> 5. Owner-এর সাথে বাংলায়, সংক্ষেপে।
<!-- /NEXA-START-HERE -->

# Relife Owner App — Builder context

Cross-repo AI/team/process/release-control rules are centralized in `avatarbd1/multi-ai-commander` under `docs/RELIFE_PROGRAM_CONTROL.md`.

## Product identity
- `relife-owner-app` is the primary Web/PWA product runtime.
- `relife-clinic-os` is legacy Telegram/support runtime during migration.
- Product direction is one multi-tenant codebase with strict clinic/department isolation.
- The first commercial production target is 20 Physio clinics. 50/100-clinic scaling is out of scope until that gate is closed.
- `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md` is the authoritative local rollout/tenancy contract. Historical single-clinic notes do not override it.
- Current product/runtime truth comes from current code, product docs, active issues/PRs, and verified runtime evidence.

## Product-local invariants
- Reuse existing canonical readers/writers/domain services; no duplicate business engine.
- Runtime tenant-owned reads/writes use explicit `organizationId + clinicId` from canonical tenant context and fail closed on missing/ambiguous/mismatched scope.
- Department is authorization/business scope, not a substitute for `clinicId`.
- Do not add new production helpers or admin views that silently inject `RELIFE`, `RELIFE-PHYSIO`, `RELIFE-DENTAL`, `amtali-main`, or another fixed clinic identity.
- Legacy Relife identifiers are allowed only at explicit migration/compatibility boundaries with a removal path; Relife is not a permanent special-case tenant.
- Preserve current Google Sheets/Supabase authority unless an Owner-approved product issue changes it.
- Finance truth remains separated: billed services, collections, outstanding, expenses, salary, and cash custody are not interchangeable.
- Internal cash handover is custody movement, not revenue or expense.
- Booking and live treatment operation remain separate domains.
- Critical writes require authorization, durable locking/idempotency where applicable, and audit evidence.
- Schema/RLS, authority, migration/cutover and tenancy changes require current product evidence and rollback-aware review.
- Clinic onboarding must become configuration/data-driven; adding a clinic must not require per-clinic source-code conditions.

## Product documentation to read when relevant
- `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md`
- `ARCHITECTURE.md`
- `MIGRATION_AUDIT.md`
- `TENANCY.md`
- `docs/CANONICAL_PATH_REGISTRY.md`
- `docs/MULTITENANT_KERNEL_V1.md`
- `docs/TENANT1_CUTOVER_AUDIT.md`
- domain-specific active issue/PR

## Builder boundary
Implement only the approved product scope. Do not redefine business strategy, create a second writer/permission model, create a Relife-only runtime shortcut, claim live verification from local tests, or expose credentials/production data.
