"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";

type BedId = "BED-1" | "BED-2" | "BED-3" | "BED-4" | "TRACTION-BED";
type PatientOption = { patientId: string; fullName: string; gender: string; defaultTherapist: string };
type ClinicianOption = { staffId: string; fullName: string };
type BoardAppointment = { appointmentId: string; date: string; time: string; startMinute: number; endMinute: number; patientId: string; patientName: string; therapist: string; status: string; assignedBedId: BedId | ""; treatmentDurationMin: number; bedHoldDurationMin: number; modalities: string[] };
type Slot = { startMinute: number; time: string; label: string };
type ModalityOption = { value: string; label: string; durationMin: number; resourceId: string; machine: boolean };
type PlanStep = { sequence: number; name: string; value: string; resourceId: string; durationMin: number; startMinute: number; endMinute: number; startTime: string; endTime: string };
type Validation = { isValid: boolean; patientId: string; patientName: string; gender: "Male" | "Female" | ""; requestedBedId: BedId; roomId: string; slotStartMinute: number; slotEndMinute: number; slotLabel: string; totalSelectedMin: number; remainingMin: number; timeline: PlanStep[]; conflicts: Array<{ type: string; message: string }>; suggestedModalities: string[]; modalityOptions: ModalityOption[]; needsTraction: boolean };
type RuntimeSession = { appointmentId: string; sessionId: string; sessionStatus: string; stationId: string; startedAt: string; currentStep: string; currentResourceId: string; expectedReleaseAt: string };
type RuntimeState = { permissions: { receive: boolean; run: boolean }; sessions: Record<string, RuntimeSession> };
type OpenSlot = { bedId: BedId; time: string; label: string; startMinute: number };

const BEDS: Array<{ id: BedId; label: string; room: string }> = [
  { id: "BED-1", label: "Bed 1", room: "Room 1" },
  { id: "BED-2", label: "Bed 2", room: "Room 1" },
  { id: "BED-3", label: "Bed 3", room: "Room 2" },
  { id: "BED-4", label: "Bed 4", room: "Room 2" },
];
const FIXED_CATALOG: Record<string, ModalityOption> = {
  "IFT-01": { value: "IFT-01", label: "IFT", durationMin: 20, resourceId: "IFT-01", machine: true },
  "TENS-01": { value: "TENS-01", label: "TENS", durationMin: 20, resourceId: "TENS-01", machine: true },
  "WAX-01": { value: "WAX-01", label: "Wax", durationMin: 10, resourceId: "WAX-01", machine: true },
  "UST-01": { value: "UST-01", label: "Ultrasound", durationMin: 10, resourceId: "UST-01", machine: true },
  "EMS-01": { value: "EMS-01", label: "EMS", durationMin: 15, resourceId: "EMS-01", machine: true },
  "SWD-01": { value: "SWD-01", label: "SWD", durationMin: 15, resourceId: "SWD-01", machine: true },
  "IRR-01": { value: "IRR-01", label: "IRR", durationMin: 10, resourceId: "IRR-01", machine: true },
  "FACIAL-TENS-01": { value: "FACIAL-TENS-01", label: "Facial TENS", durationMin: 10, resourceId: "FACIAL-TENS-01", machine: true },
  "SHOCKWAVE-01": { value: "SHOCKWAVE-01", label: "Shockwave SK5", durationMin: 5, resourceId: "SHOCKWAVE-01", machine: true },
  MANUAL: { value: "MANUAL", label: "Manual Therapy", durationMin: 10, resourceId: "", machine: false },
};
const AUTO_KEY = "relife_auto_fixed_session:";

function overlaps(startA: number, endA: number, startB: number, endB: number) { return startA < endB && endA > startB; }
function dateShift(value: string, delta: number) { const [year, month, day] = value.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day + delta, 12)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
function displayDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(year, month - 1, day, 12)); }
function formatClock(minutes: number) { const hour24 = Math.floor(minutes / 60) % 24; const mins = minutes % 60; const suffix = hour24 >= 12 ? "PM" : "AM"; const hour12 = hour24 % 12 || 12; return `${hour12}:${String(mins).padStart(2, "0")} ${suffix}`; }
function newBookingRequestId() { const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}${Math.random().toString(36).slice(2)}`; return `CBK${suffix}`; }
function statusKind(status: string, runtime?: RuntimeSession): "booked" | "arrived" | "treatment" | "completed" { if (runtime?.sessionStatus === "In Treatment") return "treatment"; if (runtime?.sessionStatus === "Waiting") return "arrived"; const value = status.trim().toLowerCase(); if (value === "completed") return "completed"; if (value === "in treatment") return "treatment"; if (["arrived", "waiting", "received"].includes(value)) return "arrived"; return "booked"; }
function statusText(kind: ReturnType<typeof statusKind>) { if (kind === "completed") return "COMPLETED"; if (kind === "treatment") return "IN TREATMENT"; if (kind === "arrived") return "ARRIVED"; return "BOOKED"; }
function cellClasses(kind: ReturnType<typeof statusKind>) { if (kind === "completed") return "border-teal-200 bg-teal-50 text-teal-950"; if (kind === "treatment") return "border-violet-300 bg-violet-50 text-violet-950"; if (kind === "arrived") return "border-amber-300 bg-amber-50 text-amber-950"; return "border-blue-200 bg-blue-50 text-blue-950"; }

function planForAppointment(appointment: BoardAppointment) {
  const selected = appointment.modalities.flatMap((value) => FIXED_CATALOG[value] ? [FIXED_CATALOG[value]] : []);
  let cursor = 0;
  const steps = selected.map((option) => { const startOffset = cursor; cursor += option.durationMin; return { name: option.label, value: option.value, resourceId: option.resourceId, durationMin: option.durationMin, startOffset, endOffset: cursor }; });
  if (selected.length === 0) steps.push({ name: "Therapist session", value: "THERAPIST-TIME", resourceId: "", durationMin: 60, startOffset: 0, endOffset: 60 });
  return steps;
}

function runtimeFromSnapshot(payload: unknown): RuntimeState | null {
  const result = payload as { ok?: boolean; snapshot?: { permissions?: { receive?: boolean; run?: boolean }; queue?: Array<Record<string, unknown>>; stations?: Array<{ session?: Record<string, unknown> | null }> } };
  if (!result?.ok || !result.snapshot) return null;
  const sessions: Record<string, RuntimeSession> = {};
  for (const item of result.snapshot.queue || []) {
    const appointmentId = String(item.appointmentId || ""); const sessionId = String(item.sessionId || ""); if (!appointmentId || !sessionId) continue;
    sessions[appointmentId] = { appointmentId, sessionId, sessionStatus: String(item.sessionStatus || "Waiting"), stationId: String(item.recommendedStationId || ""), startedAt: "", currentStep: "", currentResourceId: "", expectedReleaseAt: "" };
  }
  for (const station of result.snapshot.stations || []) {
    const session = station.session; if (!session) continue; const appointmentId = String(session.appointmentId || ""); const sessionId = String(session.sessionId || ""); if (!appointmentId || !sessionId) continue;
    sessions[appointmentId] = { appointmentId, sessionId, sessionStatus: String(session.status || "In Treatment"), stationId: String(session.stationId || ""), startedAt: String(session.startedAt || ""), currentStep: String(session.currentStep || ""), currentResourceId: String(session.currentResourceId || ""), expectedReleaseAt: String(session.expectedReleaseAt || "") };
  }
  return { permissions: { receive: Boolean(result.snapshot.permissions?.receive), run: Boolean(result.snapshot.permissions?.run) }, sessions };
}

export default function ChamberHourlyBedBoard({ date, today, appointments, slots, patients, clinicians, canBook }: { date: string; today: string; appointments: BoardAppointment[]; slots: Slot[]; patients: PatientOption[]; clinicians: ClinicianOption[]; canBook: boolean }) {
  const router = useRouter();
  const [openSlot, setOpenSlot] = useState<OpenSlot | null>(null);
  const [expandedAppointment, setExpandedAppointment] = useState("");
  const [patientText, setPatientText] = useState("");
  const [therapist, setTherapist] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [remarks, setRemarks] = useState("");
  const [bookingRequestId, setBookingRequestId] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeState>({ permissions: { receive: false, run: false }, sessions: {} });
  const [tick, setTick] = useState(Date.now());
  const autoSyncing = useRef(new Set<string>());
  const patientId = patientText.split("—")[0]?.trim() || "";
  const selectedPatient = patients.find((item) => item.patientId === patientId);
  const modalityOptions = validation?.modalityOptions || Object.values(FIXED_CATALOG);
  const selectedTotal = modalities.reduce((sum, value) => sum + (modalityOptions.find((item) => item.value === value)?.durationMin || FIXED_CATALOG[value]?.durationMin || 0), 0);

  const refreshRuntime = useCallback(async () => {
    if (date !== today) return;
    try { const response = await fetch("/api/chamber", { cache: "no-store" }); const payload = await response.json().catch(() => ({})); const next = runtimeFromSnapshot(payload); if (next) setRuntime(next); } catch { }
  }, [date, today]);

  useEffect(() => { void refreshRuntime(); const timer = window.setInterval(() => { setTick(Date.now()); void refreshRuntime(); }, 10_000); return () => window.clearInterval(timer); }, [refreshRuntime]);
  useEffect(() => { if (!openSlot || !selectedPatient) return; const preferred = clinicians.find((item) => item.fullName === selectedPatient.defaultTherapist)?.fullName || ""; if (!therapist && preferred) setTherapist(preferred); }, [clinicians, openSlot, selectedPatient, therapist]);

  useEffect(() => {
    if (!openSlot || !selectedPatient || !therapist) { setValidation(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setChecking(true); setError("");
      try {
        const response = await fetch("/api/chamber/fixed-hour", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "validate", patientId: selectedPatient.patientId, date, time: openSlot.time, therapist, modalities, remarks, requestedBedId: openSlot.bedId }) });
        const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.detail || result.error || "Validation failed"); if (cancelled) return;
        const next = result.validation as Validation; setValidation(next);
        if (!suggestionsApplied && modalities.length === 0 && next.suggestedModalities.length > 0) {
          const suggestionTotal = next.suggestedModalities.reduce((sum, value) => sum + (next.modalityOptions.find((item) => item.value === value)?.durationMin || 0), 0);
          if (suggestionTotal <= 60) { setSuggestionsApplied(true); setModalities(next.suggestedModalities); }
        }
      } catch (validationError) { if (!cancelled) { setValidation(null); setError(validationError instanceof Error ? validationError.message : "Validation failed"); } } finally { if (!cancelled) setChecking(false); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [date, modalities, openSlot, remarks, selectedPatient, suggestionsApplied, therapist]);

  async function postChamber(body: Record<string, unknown>) { const response = await fetch("/api/chamber", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || "Chamber action failed"); return result as Record<string, unknown>; }
  function closeBooking() { setOpenSlot(null); setPatientText(""); setTherapist(""); setModalities([]); setRemarks(""); setBookingRequestId(""); setValidation(null); setSuggestionsApplied(false); setError(""); }
  function toggleModality(value: string) { setSuggestionsApplied(true); setModalities((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); haptic("tap"); }

  async function createBooking() {
    if (!openSlot || !selectedPatient || !therapist || !validation?.isValid || creating) return; setCreating(true); setError("");
    const requestId = bookingRequestId || newBookingRequestId(); if (!bookingRequestId) setBookingRequestId(requestId);
    try { const response = await fetch("/api/chamber/fixed-hour", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", patientId: selectedPatient.patientId, date, time: openSlot.time, therapist, modalities, remarks, requestedBedId: openSlot.bedId, requestId }) }); const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) { const detail = result.validation?.conflicts?.map((item: { message: string }) => item.message).join(" · "); throw new Error(detail || result.detail || result.error || "Booking failed"); } haptic("success"); closeBooking(); router.refresh(); }
    catch (createError) { haptic("error"); setError(createError instanceof Error ? createError.message : "Booking failed"); } finally { setCreating(false); }
  }

  async function markArrived(appointment: BoardAppointment) {
    if (busy) return; setBusy(`arrive:${appointment.appointmentId}`); setError("");
    try { await postChamber({ action: "receive", appointmentId: appointment.appointmentId }); haptic("success"); await refreshRuntime(); router.refresh(); }
    catch (actionError) { haptic("error"); setError(actionError instanceof Error ? actionError.message : "Arrival failed"); } finally { setBusy(""); }
  }

  async function startSession(appointment: BoardAppointment) {
    if (busy) return; setBusy(`start:${appointment.appointmentId}`); setError("");
    try {
      let session = runtime.sessions[appointment.appointmentId];
      if (!session?.sessionId) {
        if (!runtime.permissions.receive) throw new Error("Reception must mark Arrived first.");
        const received = await postChamber({ action: "receive", appointmentId: appointment.appointmentId });
        session = { appointmentId: appointment.appointmentId, sessionId: String(received.sessionId || ""), sessionStatus: "Waiting", stationId: "", startedAt: "", currentStep: "", currentResourceId: "", expectedReleaseAt: "" };
      }
      if (!runtime.permissions.run) throw new Error("Therapist permission is required to start treatment.");
      const started = await postChamber({ action: "start", sessionId: session.sessionId }); const stationId = String(started.stationId || ""); const first = planForAppointment(appointment)[0];
      if (first) await postChamber({ action: "step", sessionId: session.sessionId, stationId, step: first.name, resourceId: first.resourceId, durationMin: first.durationMin });
      sessionStorage.setItem(`${AUTO_KEY}${appointment.appointmentId}`, "on"); haptic("success"); await refreshRuntime(); router.refresh();
    } catch (actionError) { haptic("error"); setError(actionError instanceof Error ? actionError.message : "Start failed"); } finally { setBusy(""); }
  }

  async function completeSession(appointment: BoardAppointment) {
    const session = runtime.sessions[appointment.appointmentId]; if (!session?.sessionId || busy) return; setBusy(`complete:${appointment.appointmentId}`); setError("");
    try { await postChamber({ action: "complete", sessionId: session.sessionId }); sessionStorage.removeItem(`${AUTO_KEY}${appointment.appointmentId}`); haptic("success"); await refreshRuntime(); router.refresh(); }
    catch (actionError) { haptic("error"); setError(actionError instanceof Error ? actionError.message : "Complete failed"); } finally { setBusy(""); }
  }

  useEffect(() => {
    if (date !== today || !runtime.permissions.run) return;
    const candidates = appointments.filter((appointment) => { const session = runtime.sessions[appointment.appointmentId]; return session?.sessionStatus === "In Treatment" && session.startedAt && sessionStorage.getItem(`${AUTO_KEY}${appointment.appointmentId}`) === "on"; });
    for (const appointment of candidates) {
      const session = runtime.sessions[appointment.appointmentId]; if (!session || autoSyncing.current.has(appointment.appointmentId)) continue; const startedAt = Date.parse(session.startedAt); if (!Number.isFinite(startedAt)) continue; const elapsed = Math.max(0, Math.floor((tick - startedAt) / 60_000)); const plan = planForAppointment(appointment); const desired = plan.find((step) => elapsed >= step.startOffset && elapsed < step.endOffset); if (!desired || elapsed >= 60) continue; if (session.currentStep === desired.name && session.currentResourceId === desired.resourceId) continue;
      autoSyncing.current.add(appointment.appointmentId);
      void postChamber({ action: "step", sessionId: session.sessionId, stationId: session.stationId, step: desired.name, resourceId: desired.resourceId, durationMin: desired.durationMin }).then(refreshRuntime).catch(() => undefined).finally(() => autoSyncing.current.delete(appointment.appointmentId));
    }
  }, [appointments, date, refreshRuntime, runtime, tick, today]);

  function goDate(next: string) { haptic("tap"); router.push(next === today ? "/chamber" : `/chamber?date=${encodeURIComponent(next)}`); }
  function appointmentAt(bed: BedId, slot: Slot) { return appointments.find((item) => item.assignedBedId === bed && overlaps(slot.startMinute, slot.startMinute + 60, item.startMinute, item.endMinute)); }

  function renderBedCell(bed: { id: BedId; label: string; room: string }, slot: Slot) {
    const appointment = appointmentAt(bed.id, slot);
    if (!appointment) return <button type="button" key={`${slot.startMinute}:${bed.id}`} disabled={!canBook} onClick={() => { setExpandedAppointment(""); setOpenSlot({ bedId: bed.id, time: slot.time, label: slot.label, startMinute: slot.startMinute }); setBookingRequestId(newBookingRequestId()); setError(""); }} className="min-h-[92px] rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left disabled:opacity-50"><span className="block text-xs font-bold text-slate-900">{bed.label}</span><span className="mt-1 block text-[10px] font-bold text-emerald-700">FREE</span><span className="mt-2 block text-[10px] font-semibold text-emerald-800">+ Book</span></button>;
    const session = runtime.sessions[appointment.appointmentId]; const kind = statusKind(appointment.status, session); const selected = expandedAppointment === appointment.appointmentId;
    return <button type="button" key={`${slot.startMinute}:${bed.id}`} onClick={() => { setOpenSlot(null); setBookingRequestId(""); setExpandedAppointment(selected ? "" : appointment.appointmentId); setError(""); haptic("tap"); }} className={`min-h-[92px] rounded-xl border p-3 text-left ${cellClasses(kind)} ${selected ? "ring-2 ring-blue-700 ring-offset-1" : ""}`}><span className="flex items-start justify-between gap-2"><span className="text-xs font-bold">{bed.label}</span><span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[8px] font-bold">{statusText(kind)}</span></span><span className="mt-2 block truncate text-[12px] font-bold">{appointment.patientName}</span><span className="mt-0.5 block truncate text-[9px] opacity-70">{appointment.patientId} · {appointment.therapist}</span></button>;
  }

  function renderExpanded(slot: Slot) {
    const appointment = appointments.find((item) => item.appointmentId === expandedAppointment); if (!appointment || !overlaps(slot.startMinute, slot.startMinute + 60, appointment.startMinute, appointment.endMinute)) return null;
    const session = runtime.sessions[appointment.appointmentId]; const kind = statusKind(appointment.status, session); const plan = planForAppointment(appointment); let elapsed = 0; if (session?.startedAt) { const started = Date.parse(session.startedAt); if (Number.isFinite(started)) elapsed = Math.max(0, Math.floor((tick - started) / 60_000)); } const current = plan.find((step) => elapsed >= step.startOffset && elapsed < step.endOffset); const next = current ? plan.find((step) => step.startOffset === current.endOffset) : plan[0]; const remaining = current ? Math.max(0, current.endOffset - elapsed) : 60;
    return <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-950">{appointment.patientName}</p><p className="mt-0.5 text-[10px] text-slate-500">{appointment.assignedBedId === "TRACTION-BED" ? "Traction" : `Bed ${appointment.assignedBedId.slice(-1)}`} · {slot.label} · {appointment.therapist}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{statusText(kind)}</span></div><div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">{plan.map((step, index) => <div key={`${step.value}:${index}`} className={`shrink-0 rounded-lg border px-2.5 py-2 ${kind === "treatment" && current?.name === step.name ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-slate-50"}`}><p className="text-[9px] font-bold text-slate-800">{step.name}</p><p className="mt-0.5 text-[8px] text-slate-500">{step.durationMin} min</p></div>)}</div>{kind === "treatment" && <div className="mt-3 rounded-lg bg-violet-50 p-3 ring-1 ring-violet-100"><div className="flex items-center justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-wide text-violet-600">Now</p><p className="text-sm font-bold text-violet-950">{current?.name || "Planned treatment steps complete"}</p>{current && <p className="mt-0.5 text-[10px] text-violet-700">{remaining} min left{next ? ` · Next ${next.name}` : ""}</p>}</div><div className="text-right"><p className="text-2xl font-bold text-violet-900">{Math.min(elapsed, 60)}</p><p className="text-[8px] text-violet-600">/ 60 min bed slot</p></div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.min(100, (elapsed / 60) * 100)}%` }} /></div></div>}<div className="mt-3 flex flex-wrap gap-2">{kind === "booked" && date === today && runtime.permissions.receive && <button type="button" disabled={Boolean(busy)} onClick={() => void markArrived(appointment)} className="min-h-11 flex-1 rounded-lg bg-amber-500 px-3 text-[11px] font-bold text-white disabled:opacity-50">{busy === `arrive:${appointment.appointmentId}` ? "Updating…" : "Mark Arrived"}</button>}{kind === "arrived" && date === today && runtime.permissions.run && <button type="button" disabled={Boolean(busy)} onClick={() => void startSession(appointment)} className="min-h-11 flex-1 rounded-lg bg-violet-700 px-3 text-[11px] font-bold text-white disabled:opacity-50">{busy === `start:${appointment.appointmentId}` ? "Starting…" : "▶ Start Session"}</button>}{kind === "arrived" && date === today && !runtime.permissions.run && <p className="w-full rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-500">Waiting for assigned therapist to start.</p>}{kind === "treatment" && date === today && runtime.permissions.run && <button type="button" disabled={Boolean(busy)} onClick={() => void completeSession(appointment)} className="min-h-11 flex-1 rounded-lg bg-teal-700 px-3 text-[11px] font-bold text-white disabled:opacity-50">{busy === `complete:${appointment.appointmentId}` ? "Completing…" : elapsed >= 60 ? "✓ Confirm Complete" : "Finish Early"}</button>}</div></div>;
  }

  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" id="hourly-bed-board"><div className="border-b border-slate-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">Chamber schedule</p><h2 className="mt-0.5 text-lg font-bold text-slate-950">Time → 4 beds</h2><p className="mt-1 text-[11px] leading-4 text-slate-500">Each hour shows Bed 1–4 together. Book, Arrive, Start and Complete without leaving this screen.</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${date === today ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>{date === today ? "TODAY" : displayDate(date)}</span></div><div className="mt-4 flex items-center gap-2"><button type="button" onClick={() => goDate(dateShift(date, -1))} className="min-h-10 min-w-10 rounded-xl border border-slate-200 text-lg font-semibold text-slate-600">‹</button><button type="button" onClick={() => goDate(today)} className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">Today</button><label className="min-w-0 flex-1"><span className="sr-only">Schedule date</span><input type="date" value={date} onChange={(event) => goDate(event.target.value)} className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" /></label><button type="button" onClick={() => goDate(dateShift(date, 1))} className="min-h-10 min-w-10 rounded-xl border border-slate-200 text-lg font-semibold text-slate-600">›</button></div></div><div className="space-y-3 p-4">{slots.map((slot) => <article key={slot.startMinute} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xl font-bold text-slate-950">{slot.label}</p><p className="text-[9px] font-semibold text-slate-400">{formatClock(slot.startMinute)}–{formatClock(slot.startMinute + 60)}</p></div><span className="text-[9px] font-semibold text-slate-400">{displayDate(date)}</span></div><div className="grid grid-cols-2 gap-2">{BEDS.map((bed) => renderBedCell(bed, slot))}</div>{renderExpanded(slot)}</article>)}</div>{error && <div className="mx-4 mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</div>}{openSlot && <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/40 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true"><div className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-w-lg sm:rounded-3xl"><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 sm:hidden" /><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">Book in Chamber</p><h3 className="mt-0.5 text-xl font-bold text-slate-950">{openSlot.label} · {openSlot.bedId === "TRACTION-BED" ? "Traction" : `Bed ${openSlot.bedId.slice(-1)}`}</h3><p className="text-[10px] text-slate-500">Fixed 60-minute bed slot</p></div><button type="button" onClick={closeBooking} className="min-h-10 min-w-10 rounded-full bg-slate-100 text-lg text-slate-600">×</button></div><label className="mt-4 block text-xs font-semibold text-slate-700">Patient<input list="chamber-patients" value={patientText} onChange={(event) => { setPatientText(event.target.value); setModalities([]); setSuggestionsApplied(false); }} placeholder="Search ID or name" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-700" /></label><datalist id="chamber-patients">{patients.map((patient) => <option key={patient.patientId} value={`${patient.patientId} — ${patient.fullName}`} />)}</datalist>{selectedPatient && <p className="mt-1 text-[10px] text-slate-500">{selectedPatient.fullName} · {selectedPatient.gender || "Gender missing"}</p>}<div className="mt-4"><TapChoice label="Therapist" value={therapist} columns={2} options={clinicians.map((item) => ({ value: item.fullName, label: item.fullName }))} onChange={(value) => setTherapist(value)} /></div>{selectedPatient && therapist && <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-700">Treatment sequence</p><p className={`text-xs font-bold ${selectedTotal > 60 ? "text-red-700" : selectedTotal === 60 ? "text-emerald-700" : "text-blue-700"}`}>{selectedTotal}/60 min</p></div><p className="mt-1 text-[10px] text-slate-400">Tap order = treatment order. Machine/manual durations are fixed; unused bed time does not reserve the therapist.</p><div className="mt-2 grid grid-cols-2 gap-2">{modalityOptions.map((option) => { const selectedIndex = modalities.indexOf(option.value); return <button type="button" key={option.value} onClick={() => toggleModality(option.value)} className={`min-h-12 rounded-xl border px-3 text-left ${selectedIndex >= 0 ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700"}`}><span className="block text-xs font-bold">{selectedIndex >= 0 ? `${selectedIndex + 1}. ` : ""}{option.label}</span><span className={`mt-0.5 block text-[9px] ${selectedIndex >= 0 ? "text-blue-100" : "text-slate-400"}`}>{option.durationMin} min fixed</span></button>; })}</div></div>}{checking && <div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700"><Spinner size="sm" label="Checking" /> Checking bed, gender, therapist and machines…</div>}{validation && !checking && <div className={`mt-4 rounded-xl border p-3 ${validation.isValid ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}><p className={`text-xs font-bold ${validation.isValid ? "text-emerald-800" : "text-red-800"}`}>{validation.isValid ? "✓ Safe to book" : "Booking blocked"}</p>{validation.isValid ? <><div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">{validation.timeline.map((step) => <div key={`${step.sequence}:${step.name}`} className="shrink-0 rounded-lg bg-white/80 px-2.5 py-2 ring-1 ring-emerald-100"><p className="text-[9px] font-bold text-slate-800">{step.name}</p><p className="text-[8px] text-slate-500">{step.startTime}–{step.endTime} · {step.durationMin}m</p></div>)}</div>{validation.remainingMin > 0 && modalities.length > 0 && <p className="mt-2 text-[9px] text-emerald-700">Bed buffer: {validation.remainingMin} min. Therapist is free outside therapist-required steps.</p>}</> : <div className="mt-2 space-y-1">{validation.conflicts.map((item, index) => <p key={`${item.type}:${index}`} className="text-[10px] text-red-700">• {item.message}</p>)}</div>}</div>}<label className="mt-4 block text-xs font-semibold text-slate-700">Note (optional)<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700" /></label><button type="button" disabled={!validation?.isValid || checking || creating || selectedTotal > 60} onClick={() => void createBooking()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 text-sm font-bold text-white disabled:opacity-40">{creating && <Spinner size="sm" className="border-white/40 border-t-white" label="Booking" />}Confirm booking</button></div></div>}</section>;
}
