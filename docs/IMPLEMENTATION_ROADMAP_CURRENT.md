# Relife Clinic OS — Current Implementation Roadmap

Baseline reviewed: `main` at `f62c3cfe9527f8858f91175674323c3770006276` (18 Aug 2026).

This document reconciles the uploaded **Advanced Design Implementation Roadmap** with the current App-primary production architecture. It does not replace working canonical writers with parallel implementations.

## Status keys

- **DONE** — current production code already provides the capability, or the capability is implemented in this reviewed merge slice.
- **PARTIAL** — useful production capability exists, but the roadmap target is not complete.
- **NEXT** — high-value missing work suitable for the next implementation slice.
- **DEFER** — intentionally later because of safety, cost, or architectural dependency.
- **REMOVE/REPLACE** — roadmap proposal should not be implemented literally because current architecture has a safer canonical path.

## Phase 3a — Chat, messaging and notifications

| Roadmap capability | Current status | Current architecture / decision |
|---|---|---|
| Chamber chat UI | DONE | `ChamberCommsClient` is integrated under Chamber → Team. |
| Message API | DONE | `/api/chamber/comms` is the canonical Chamber communication API. |
| Normal / Urgent messages | DONE | Stored in existing `28_Chat_Messages`; urgent Team messages are visual priority, not phone-style calls. |
| Equipment workflow | DONE | Equipment requests and status transitions are integrated in Team. |
| Direct staff call | DONE | Explicit `CALL:STAFF:*` targeting. |
| Direct role call | DONE | Explicit `CALL:ROLE:*` targeting. |
| Loud persistent call alert | DONE | Full-scale Web Audio signal + vibration; repeats until accepted. Final hardware volume remains device-controlled. |
| Call acceptance | DONE | Server re-authorizes target, distributed-locks the call, marks existing chat row Accepted and writes audit. |
| 09:00–21:00 Dhaka sound rule | DONE | Outside the window the communication record remains, but phone-style ring is silent. |
| Emergency broadcast | DONE (this slice) | Same canonical Chamber comms path with `CALL:ALL:PHYSIO`; Owner/Manager only; first authorized acknowledgement stops the broadcast for all Chamber devices. |
| Dedicated call history panel | PARTIAL | Call send/accept state exists in chat + `20_Data_Audit`; dedicated history UI is still missing. |
| General message read receipts | PARTIAL | `Seen_By` exists and is used by call acceptance; ordinary message read-state UI is not complete. |
| Real-time delivery | PARTIAL | Current production flow polls the canonical API (alerts 5s, Team refresh 10s). No Supabase Realtime subscription is authoritative yet. |
| Push notifications | PARTIAL | Browser/PWA system notifications exist for phone-style alerts. No FCM transport is configured. |
| Per-user notification settings | PARTIAL | Local call-sound preference + fixed Dhaka alert window exist. Per-staff DND/settings persistence is not implemented. |
| Staff online/away/busy presence | NEXT | No canonical presence model yet. |
| Voice note recording | NEXT | Not implemented. |
| Voice-to-text transcription | NEXT | Not implemented. |
| Offline chat queue | DEFER | Do not introduce an offline mutation queue until message idempotency/reconciliation is defined. |

### Phase 3a architecture correction

The uploaded roadmap proposes new Supabase `comms_messages`, `comms_call_history` and `comms_notification_settings` tables and a parallel `app/api/comms/*` API family. **Do not implement that literally now.**

Current production already has a canonical Chamber communication writer backed by `28_Chat_Messages`, existing RBAC, distributed mutation locks and `20_Data_Audit`. A second writer would create authority drift.

When true realtime is added, it should be introduced behind the current communication boundary or through an explicit migration/cutover plan. Supabase can be used as realtime transport/shadow only after authority and reconciliation rules are defined.

## Phase 3b — Charts and AI

| Roadmap capability | Current status | Current architecture / decision |
|---|---|---|
| Date-range finance reports | DONE | Today/Yesterday/7-day/Month/Custom reporting already exists. |
| CSV export | DONE | Permission-scoped multi-dataset CSV export exists. |
| Graphical charts | NEXT | No charting library is currently installed; `recharts` is not a current dependency. |
| Dashboard trend charts | NEXT | Existing dashboard metrics can become the source; do not create a second finance calculation engine. |
| Service profitability charts | NEXT | Must reuse canonical finance/report policy. |
| AI photo-assisted registration | DONE | Extraction is draft-only and requires human review before patient creation. |
| Clinical AI support | PARTIAL | Existing clinical AI/tooling exists, but the uploaded roadmap's broad suggestion engine is not complete. |
| Inventory reorder suggestions | NEXT | Can be recommendation-only on top of canonical inventory data. |
| Follow-up reminder suggestions | NEXT | Recommendation-only; no automatic clinical mutation. |
| Auto-discount | DEFER | Financial business rule requires explicit Owner policy before implementation. AI must not silently change patient charges. |
| AI medication suggestions | DEFER | Must remain clinician-assist only and require explicit clinical safety/product approval; never auto-prescribe. |

## Phase 3c — Mobile and appearance

| Roadmap capability | Current status | Current architecture / decision |
|---|---|---|
| Mobile bottom navigation | DONE | Shared BottomNav is already production architecture. |
| Responsive appointment UI | DONE/PARTIAL | Major mobile appointment fixes and safe-area/sticky context are already merged. Continue per-screen QA rather than creating duplicate mobile routes. |
| Swipe navigation | DONE | Safe Swipe Guard prevents accidental navigation during forms/scrolling. |
| Dedicated `/mobile` pages | REMOVE/REPLACE | Prefer one responsive canonical route per workflow instead of separate mobile mutation surfaces. |
| Dark mode | NEXT | Not implemented. |
| PWA/offline shell | PARTIAL | PWA exists; offline financial/clinical mutation queues remain intentionally constrained for safety. |

## Phase 4 — VoIP

| Roadmap capability | Current status | Decision |
|---|---|---|
| Browser-to-browser audio | DEFER | No WebRTC/Twilio/Agora implementation exists. |
| Call token/signaling APIs | DEFER | Introduce only after Phase 3a communication state/history is stable. |
| Speaker/mic controls | DEFER | Requires real VoIP layer. |
| Recording | DEFER | Requires consent, retention and clinical/privacy policy before implementation. |

The current **Direct Call** feature is a clinic call-bell alert, not two-way audio VoIP.

## Roadmap items already superseded by current production

- Role-specific Home dashboards — DONE.
- Full Staff Management create/edit/reactivate/deactivate + access onboarding — DONE.
- Physio fixed-hour booking and Chamber capacity — DONE: 09:00–13:00 and 15:00–21:00, four patient beds, max 40/day.
- Traction as a treatment resource rather than a fifth booking bed — DONE.
- Multi-date appointment booking — DONE.
- Same-as-last treatment and pain tracking — DONE.
- Dedicated Physio inventory workspace — DONE.
- Private patient report/photo storage — DONE.
- Bulk patient CSV import — DONE.
- Expense request and canonical cash movement request UI — DONE.
- Dental tools workspace — DONE.

## Current critical path

1. **Complete the remaining Phase 3a gaps on the existing communication authority**
   - Dedicated call history and ordinary-message read/ack state.
   - Presence model.
   - Realtime transport without introducing a second writer.
   - Voice note/transcription after the core state model is stable.
2. **Charts and analytics presentation**
   - Build charts on existing report calculations, not new finance formulas.
3. **Dark mode and remaining mobile polish**.
4. **VoIP evaluation and implementation** only after the communication state/history layer is production-stable.

## Non-negotiable implementation rules

- Keep Web/PWA as the primary Clinic OS.
- Preserve Physio/Dental department isolation and current RBAC.
- Do not create duplicate patient, appointment, clinical, finance, staff or Chamber writers.
- Preserve distributed mutation locks, same-origin protection, idempotency and audit on writes.
- No hard deletion of financial/clinical/audit history.
- Do not switch communication or finance authority to Supabase without an explicit cutover and reconciliation plan.
- CI impact gate, lint, full tests and production build must pass before merge.
