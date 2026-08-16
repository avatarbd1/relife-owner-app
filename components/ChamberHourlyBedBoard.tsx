"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";

type BedId = "BED-1" | "BED-2" | "BED-3" | "BED-4" | "TRACTION-BED";

type PatientOption = {
  patientId: string;
  fullName: string;
  gender: string;
  defaultTherapist: string;
};

type ClinicianOption = {
  staffId: string;
  fullName: string;
};

type BoardAppointment = {
  appointmentId: string;
  date: string;
  time: string;
  startMinute: number;
  endMinute: number;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  assignedBedId: BedId | "";
  treatmentDurationMin: number;
  bedHoldDurationMin: number;
  modalities: string[];
};

type Slot = {
  startMinute: number;
  time: string;
  label: string;
};

type ModalityOption = {
  value: string;
  label: string;
  durationMin: number;
  resourceId: string;
  resourceName: string;
  machine: boolean;
};

type Validation = {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  requestedBedId: BedId;
  roomId: string;
  slotStartMinute: number;
  slotEndMinute: number;
  slotLabel: string;
  treatmentDurationMin: number;
  bedHoldDurationMin: number;
  conflicts: Array<{ type: string; message: string }>;
  suggestedModalities: string[];
  modalityOptions: ModalityOption[];
};

type OpenSlot = { bedId: BedId; time: string; label: string; startMinute: number };

const BEDS: Array<{ id: BedId; label: string; room: string }> = [
  { id: "BED-1", label: "Bed 1", room: "Room 1" },
  { id: "BED-2", label: "Bed 2", room: "Room 1" },
  { id: "BED-3", label: "Bed 3", room: "Room 2" },
  { id: "BED-4", label: "Bed 4", room: "Room 2" },
  { id: "TRACTION-BED", label: "Traction", room: "Traction Room" },
];

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function statusKind(status: string): "booked" | "arrived" | "treatment" | "completed" | "blocked" {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "completed";
  if (value === "in treatment") return "treatment";
  if (value === "arrived" || value === "waiting" || value === "received") return "arrived";
  if (value === "blocked" || value === "unavailable") return "blocked";
  return "booked";
}

function cardStyle(status: string): string {
  const kind = statusKind(status);
  if (kind === "completed") return "border-teal-200 bg-teal-50 text-teal-950";
  if (kind === "treatment") return "border-violet-300 bg-violet-50 text-violet-950";
  if (kind === "arrived") return "border-amber-300 bg-amber-50 text-amber-950";
  if (kind === "blocked") return "border-red-300 bg-red-50 text-red-950";
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function statusLabel(status: string): string {
  const kind = statusKind(status);
  if (kind === "completed") return "COMPLETED";
  if (kind === "treatment") return "IN TREATMENT";
  if (kind === "arrived") return status.trim().toLowerCase() === "waiting" ? "WAITING" : "ARRIVED";
  if (kind === "blocked") return "BLOCKED";
  return "BOOKED";
}

function dateShift(value: string, delta: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(year, month - 1, day, 12));
}

export default function ChamberHourlyBedBoard({
  date,
  today,
  appointments,
  slots,
  patients,
  clinicians,
  canBook,
}: {
  date: string;
  today: string;
  appointments: BoardAppointment[];
  slots: Slot[];
  patients: PatientOption[];
  clinicians: ClinicianOption[];
  canBook: boolean;
}) {
  const router = useRouter();
  const [bedId, setBedId] = useState<BedId>("BED-1");
  const [openSlot, setOpenSlot] = useState<OpenSlot | null>(null);
  const [patientText, setPatientText] = useState("");
  const [therapist, setTherapist] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [remarks, setRemarks] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [statusBusy, setStatusBusy] = useState("");

  const patientId = patientText.split("—")[0]?.trim() || "";
  const selectedPatient = patients.find((item) => item.patientId === patientId);
  const selectedBed = BEDS.find((item) => item.id === bedId) || BEDS[0];
  const modalOptions = validation?.modalityOptions || [];

  const slotAppointments = useMemo(() => {
    const result = new Map<number, BoardAppointment[]>();
    for (const slot of slots) {
      const end = slot.startMinute + 60;
      result.set(
        slot.startMinute,
        appointments.filter(
          (item) => item.assignedBedId === bedId && overlaps(slot.startMinute, end, item.startMinute, item.endMinute)
        )
      );
    }
    return result;
  }, [appointments, bedId, slots]);

  function resetBooking(slot?: OpenSlot | null) {
    setOpenSlot(slot || null);
    setPatientText("");
    setTherapist("");
    setModalities([]);
    setRemarks("");
    setValidation(null);
    setSuggestionsApplied(false);
    setError("");
  }

  useEffect(() => {
    if (!openSlot || !selectedPatient) return;
    const preferred = clinicians.find((item) => item.fullName === selectedPatient.defaultTherapist)?.fullName || "";
    if (!therapist && preferred) setTherapist(preferred);
  }, [clinicians, openSlot, selectedPatient, therapist]);

  useEffect(() => {
    if (!openSlot || !selectedPatient || !therapist) {
      setValidation(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setChecking(true);
      setError("");
      try {
        const response = await fetch("/api/chamber/hourly-booking", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "validate",
            patientId: selectedPatient.patientId,
            date,
            time: openSlot.time,
            therapist,
            modalities,
            remarks,
            requestedBedId: openSlot.bedId,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.detail || result.error || "Validation failed");
        if (cancelled) return;
        const next = result.validation as Validation;
        setValidation(next);
        if (!suggestionsApplied && modalities.length === 0 && next.suggestedModalities.length > 0) {
          setSuggestionsApplied(true);
          setModalities(next.suggestedModalities);
        }
      } catch (validationError) {
        if (!cancelled) {
          setValidation(null);
          setError(validationError instanceof Error ? validationError.message : "Validation failed");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [date, modalities, openSlot, remarks, selectedPatient, suggestionsApplied, therapist]);

  async function createBooking() {
    if (!openSlot || !selectedPatient || !therapist || !validation?.isValid || creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/chamber/hourly-booking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          patientId: selectedPatient.patientId,
          date,
          time: openSlot.time,
          therapist,
          modalities,
          remarks,
          requestedBedId: openSlot.bedId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        const detail = result.validation?.conflicts?.map((item: { message: string }) => item.message).join(" · ");
        throw new Error(detail || result.detail || result.error || "Booking failed");
      }
      haptic("success");
      resetBooking(null);
      router.refresh();
    } catch (createError) {
      haptic("error");
      setError(createError instanceof Error ? createError.message : "Booking failed");
    } finally {
      setCreating(false);
    }
  }

  async function markArrived(appointmentId: string) {
    if (statusBusy) return;
    setStatusBusy(appointmentId);
    try {
      const response = await fetch("/api/appointments/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId, department: "Physio", status: "Arrived" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Arrival update failed");
      haptic("success");
      router.refresh();
    } catch (arrivalError) {
      haptic("error");
      setError(arrivalError instanceof Error ? arrivalError.message : "Arrival update failed");
    } finally {
      setStatusBusy("");
    }
  }

  function goDate(next: string) {
    haptic("tap");
    router.push(next === today ? "/chamber" : `/chamber?date=${encodeURIComponent(next)}`);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" id="hourly-bed-board">
      <div className="border-b border-slate-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">Bed schedule</p>
            <h2 className="mt-0.5 text-lg font-bold text-slate-950">1-hour Chamber slots</h2>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">Tap a bed, then tap a FREE hour. No half-hour booking.</p>
          </div>
          <StatusBadge tone={date === today ? "success" : "info"}>{date === today ? "Today" : displayDate(date)}</StatusBadge>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => goDate(dateShift(date, -1))} className="min-h-10 min-w-10 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-600">‹</button>
          <button type="button" onClick={() => goDate(today)} className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">Today</button>
          <label className="min-w-0 flex-1"><span className="sr-only">Schedule date</span><input type="date" value={date} onChange={(event) => goDate(event.target.value)} className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-700" /></label>
          <button type="button" onClick={() => goDate(dateShift(date, 1))} className="min-h-10 min-w-10 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-600">›</button>
        </div>
      </div>

      <div className="p-4">
        <div className="-mx-1 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2 px-1">
            {BEDS.map((bed) => {
              const active = bed.id === bedId;
              const bookedCount = appointments.filter((item) => item.assignedBedId === bed.id).length;
              return (
                <button
                  type="button"
                  key={bed.id}
                  onClick={() => { setBedId(bed.id); resetBooking(null); haptic("tap"); }}
                  className={`min-h-14 min-w-[92px] rounded-xl border px-3 text-left ${active ? "border-blue-800 bg-blue-800 text-white shadow-md" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  <span className="block text-xs font-bold">{bed.label}</span>
                  <span className={`mt-0.5 block text-[9px] ${active ? "text-blue-100" : "text-slate-400"}`}>{bed.room} · {bookedCount} booked</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-bold text-slate-800">{selectedBed.label}</p><p className="text-[10px] text-slate-500">{selectedBed.room}</p></div>
            <span className="text-[10px] font-semibold text-slate-400">{displayDate(date)}</span>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {slots.map((slot) => {
            const booked = slotAppointments.get(slot.startMinute) || [];
            const appointment = booked[0];
            if (!appointment) {
              return (
                <button
                  type="button"
                  key={`${bedId}-${slot.startMinute}`}
                  disabled={!canBook}
                  onClick={() => resetBooking({ bedId, time: slot.time, label: slot.label, startMinute: slot.startMinute })}
                  className="relife-interactive flex min-h-[72px] w-full items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-left disabled:opacity-55"
                >
                  <div><p className="text-sm font-bold tabular-nums text-slate-900">{slot.label}</p><p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">FREE</p></div>
                  <span className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">+ Book</span>
                </button>
              );
            }
            const kind = statusKind(appointment.status);
            return (
              <article key={`${bedId}-${slot.startMinute}-${appointment.appointmentId}`} className={`rounded-xl border px-4 py-3 ${cardStyle(appointment.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold tabular-nums text-slate-500">{slot.label}</p>
                    <h3 className="mt-1 truncate text-sm font-bold">{appointment.patientName || appointment.patientId}</h3>
                    <p className="mt-0.5 truncate text-[10px] opacity-70">{appointment.patientId} · {appointment.therapist || "Unassigned"}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-current/15 bg-white/60 px-2 py-1 text-[9px] font-bold">{statusLabel(appointment.status)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {appointment.modalities.slice(0, 3).map((item) => <span key={item} className="rounded-md bg-white/70 px-2 py-1 font-semibold">{item}</span>)}
                  {appointment.modalities.length > 3 && <span className="rounded-md bg-white/70 px-2 py-1 font-semibold">+{appointment.modalities.length - 3}</span>}
                </div>
                {booked.length > 1 && <p className="mt-2 text-[10px] font-bold text-red-700">⚠ {booked.length} overlapping records detected</p>}
                <div className="mt-3 flex gap-2">
                  {kind === "booked" && canBook && (
                    <button type="button" disabled={Boolean(statusBusy)} onClick={() => void markArrived(appointment.appointmentId)} className="min-h-10 flex-1 rounded-lg bg-amber-500 px-3 text-[11px] font-bold text-white disabled:opacity-50">
                      {statusBusy === appointment.appointmentId ? "Updating…" : "Mark Arrived"}
                    </button>
                  )}
                  {(kind === "arrived" || kind === "treatment") && (
                    <button type="button" onClick={() => document.getElementById("live-treatment")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="min-h-10 flex-1 rounded-lg bg-violet-700 px-3 text-[11px] font-bold text-white">Treatment controls ↓</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {openSlot && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/45 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label="Book Chamber slot">
          <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 pb-3 pt-4 backdrop-blur">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">Quick booking</p><h2 className="mt-0.5 text-lg font-bold text-slate-950">{BEDS.find((bed) => bed.id === openSlot.bedId)?.label} · {openSlot.label}</h2><p className="text-[11px] text-slate-500">{displayDate(date)} · 1-hour bed slot</p></div>
                <button type="button" onClick={() => resetBooking(null)} className="min-h-10 min-w-10 rounded-full bg-slate-100 text-lg font-semibold text-slate-600">×</button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <label className="block text-xs font-semibold text-slate-700">
                Patient *
                <input
                  list="chamber-hour-patients"
                  value={patientText}
                  onChange={(event) => {
                    setPatientText(event.target.value);
                    setTherapist("");
                    setModalities([]);
                    setSuggestionsApplied(false);
                    setValidation(null);
                  }}
                  placeholder="Patient ID বা নাম লিখুন"
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
                />
                <datalist id="chamber-hour-patients">
                  {patients.map((patient) => <option key={patient.patientId} value={`${patient.patientId} — ${patient.fullName}`} />)}
                </datalist>
              </label>

              {selectedPatient && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-800"><strong>{selectedPatient.fullName}</strong><span className="ml-2 text-[10px] opacity-70">{selectedPatient.patientId} · {selectedPatient.gender || "Gender missing"}</span></div>
              )}

              <TapChoice
                label="Therapist *"
                value={therapist}
                columns={clinicians.length >= 3 ? 3 : 2}
                options={clinicians.map((item) => ({ value: item.fullName, label: item.fullName, subtitle: item.staffId }))}
                onChange={setTherapist}
              />

              {modalOptions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-700">Modality (optional)</p>{validation && <span className="text-[10px] font-semibold text-slate-400">Treatment ~{validation.treatmentDurationMin}m</span>}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {modalOptions.map((option) => {
                      const active = modalities.includes(option.value);
                      return (
                        <button type="button" key={option.value} onClick={() => { setSuggestionsApplied(true); setModalities((current) => active ? current.filter((item) => item !== option.value) : [...current, option.value]); haptic("tap"); }} className={`min-h-11 rounded-xl border px-3 text-left ${active ? "border-blue-700 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                          <span className="block text-xs font-semibold">{option.label}</span><span className={`block text-[9px] ${active ? "text-blue-100" : "text-slate-400"}`}>{option.durationMin} min</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="block text-xs font-semibold text-slate-700">Note (optional)<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700" /></label>

              <div className={`rounded-xl border p-3 ${checking ? "border-slate-200 bg-slate-50" : validation?.isValid ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                {checking ? <div className="flex items-center gap-2 text-xs text-slate-600"><Spinner size="sm" label="Checking slot" />Checking bed, therapist, gender and machines…</div> : validation ? (
                  validation.isValid ? (
                    <div><p className="text-xs font-bold text-emerald-800">✓ Ready to book</p><p className="mt-1 text-[10px] leading-4 text-emerald-700">{selectedBed.label} held for {openSlot.label}. Treatment estimate {validation.treatmentDurationMin} min; machine timing uses actual modality duration.</p></div>
                  ) : (
                    <div><p className="text-xs font-bold text-amber-900">Booking blocked</p><div className="mt-1 space-y-1">{validation.conflicts.map((item, index) => <p key={`${item.type}-${index}`} className="text-[10px] leading-4 text-amber-800">• {item.message}</p>)}</div></div>
                  )
                ) : <p className="text-xs text-slate-500">Select patient and therapist to check this slot.</p>}
              </div>

              {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</p>}

              <button type="button" onClick={() => void createBooking()} disabled={!validation?.isValid || checking || creating || !selectedPatient || !therapist} className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 py-3.5 text-sm font-bold text-white shadow-md disabled:opacity-45">
                {creating && <Spinner size="sm" className="border-white/40 border-t-white" label="Booking" />}
                {creating ? "Booking…" : `Confirm ${selectedBed.label} · ${openSlot.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
