"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";
import { PHYSIO_CHAMBER_STARTS } from "@/lib/domain/chamber/hours";

type Department = "Physio" | "Dental";
type BedId = "BED-1" | "BED-2" | "BED-3" | "BED-4" | "TRACTION-BED";

type Patient = {
  patientId: string;
  fullName: string;
  department: Department | "All";
  gender?: string;
};

type Clinician = {
  staffId: string;
  fullName: string;
  department: Department;
};

type ModalityOption = {
  value: string;
  label: string;
  durationMin: number;
  resourceId: string;
  resourceName: string;
  machine: boolean;
};

type BookingSlot = { date: string; time: string };
type Conflict = { type: string; message: string };
type BedValidation = {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  requestedBedId: BedId;
  roomId: string;
  conflicts: Conflict[];
  totalSelectedMin: number;
  remainingMin: number;
  needsTraction: boolean;
};

type SlotBedState = {
  choices: Partial<Record<BedId, BedValidation>>;
  selectedBedId: BedId | "";
  checked: boolean;
};

type BookingResult = {
  slot: BookingSlot;
  status: "success" | "failed";
  bedId?: BedId;
  error?: string;
};

const TREATMENT_BEDS: Array<{ id: BedId; label: string; room: string }> = [
  { id: "BED-1", label: "Bed 1", room: "Room 1" },
  { id: "BED-2", label: "Bed 2", room: "Room 1" },
  { id: "BED-3", label: "Bed 3", room: "Room 2" },
  { id: "BED-4", label: "Bed 4", room: "Room 2" },
];

const DENTAL_TIME_SLOTS = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "13:00",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
];

function addDaysIso(startDate: string, days: number): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(Date.UTC(year, month - 1, day, 6)));
}

function timeLabel(value: string): string {
  const [hourRaw, minute] = value.split(":");
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${minute} ${suffix}`;
}

function endTimeLabel(value: string, minutes: number): string {
  const [hourRaw, minuteRaw] = value.split(":");
  const start = Number(hourRaw) * 60 + Number(minuteRaw);
  const end = start + minutes;
  const hour24 = Math.floor(end / 60) % 24;
  const minute = end % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function slotKey(slot: BookingSlot): string {
  return `${slot.date}|${slot.time}`;
}

function bedLabel(value: BedId | ""): string {
  if (value === "TRACTION-BED") return "Traction Bed";
  const found = TREATMENT_BEDS.find((item) => item.id === value);
  return found?.label || "";
}

function bedRoom(value: BedId | ""): string {
  if (value === "TRACTION-BED") return "Traction Room";
  return TREATMENT_BEDS.find((item) => item.id === value)?.room || "";
}

function shortConflict(validation: BedValidation | undefined): string {
  const conflict = validation?.conflicts?.[0];
  if (!conflict) return "Unavailable";
  if (conflict.type === "bed_busy") return "Busy";
  if (conflict.type === "gender_rule") return "Gender lock";
  if (conflict.type === "therapist_busy") return "Therapist busy";
  if (conflict.type === "machine_busy") return "Machine busy";
  if (conflict.type === "duplicate") return "Already booked";
  if (conflict.type === "duration_overflow") return "> 60 min";
  if (conflict.type === "treatment_plan") return "Traction needed";
  return conflict.message || "Unavailable";
}

function uniqueConflictMessages(state: SlotBedState | undefined): string[] {
  if (!state) return [];
  const messages = Object.values(state.choices)
    .flatMap((value) => value?.conflicts || [])
    .map((item) => item.message)
    .filter(Boolean);
  return [...new Set(messages)].slice(0, 3);
}

export default function AppointmentFormGenderBed({
  patients,
  clinicians,
  modalityOptions,
  defaultPatientId,
  startDate,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  modalityOptions: ModalityOption[];
  defaultPatientId?: string;
  startDate: string;
  defaultDepartment?: Department;
}) {
  const router = useRouter();
  const requestIds = useRef(new Map<string, string>());
  const selectedPatient = patients.find((item) => item.patientId === defaultPatientId) || patients[0];
  const department = selectedPatient?.department === "Dental" ? "Dental" : "Physio";
  const timeSlots = department === "Physio" ? [...PHYSIO_CHAMBER_STARTS] : DENTAL_TIME_SLOTS;
  const departmentClinicians = useMemo(
    () => clinicians.filter((item) => item.department === department),
    [clinicians, department]
  );

  const [therapist, setTherapist] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [remarks, setRemarks] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set([startDate]));
  const [selectedTimes, setSelectedTimes] = useState<Map<string, Set<string>>>(new Map());
  const [expandedDate, setExpandedDate] = useState(startDate);
  const [customDate, setCustomDate] = useState("");
  const [bedStates, setBedStates] = useState<Map<string, SlotBedState>>(new Map());
  const [validatedSlots, setValidatedSlots] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<BookingResult[]>([]);

  const quickDates = useMemo(
    () => Array.from({ length: 21 }, (_, index) => addDaysIso(startDate, index)),
    [startDate]
  );
  const selectedSlots = useMemo<BookingSlot[]>(() => {
    const output: BookingSlot[] = [];
    for (const date of [...selectedDates].sort()) {
      for (const time of [...(selectedTimes.get(date) || new Set<string>())].sort()) {
        output.push({ date, time });
      }
    }
    return output;
  }, [selectedDates, selectedTimes]);
  const selectedTotal = modalities.reduce(
    (sum, value) => sum + (modalityOptions.find((item) => item.value === value)?.durationMin || 0),
    0
  );

  useEffect(() => {
    if (!selectedPatient || department !== "Physio") return;
    let cancelled = false;
    setProfileBusy(true);
    void fetch("/api/appointments/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientId: selectedPatient.patientId }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Treatment plan load failed");
        if (cancelled) return;
        const suggested = Array.isArray(payload.profile?.suggestedModalities)
          ? payload.profile.suggestedModalities.map(String)
          : [];
        setModalities(suggested);
      })
      .catch((profileError) => {
        if (!cancelled) setError(profileError instanceof Error ? profileError.message : "Treatment plan load failed");
      })
      .finally(() => {
        if (!cancelled) setProfileBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [department, selectedPatient?.patientId]);

  function invalidateChecks() {
    setBedStates(new Map());
    setValidatedSlots(new Set());
    setResults([]);
    setError("");
    requestIds.current.clear();
  }

  function chooseTherapist(value: string) {
    setTherapist(value);
    invalidateChecks();
  }

  function toggleModality(value: string) {
    setModalities((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
    invalidateChecks();
    haptic("tap");
  }

  function toggleDate(date: string) {
    const nextDates = new Set(selectedDates);
    const nextTimes = new Map(selectedTimes);
    if (nextDates.has(date)) {
      nextDates.delete(date);
      nextTimes.delete(date);
      if (expandedDate === date) setExpandedDate("");
    } else {
      nextDates.add(date);
      setExpandedDate(date);
    }
    setSelectedDates(nextDates);
    setSelectedTimes(nextTimes);
    invalidateChecks();
    haptic("tap");
  }

  function addCustomDate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) return;
    const next = new Set(selectedDates);
    next.add(customDate);
    setSelectedDates(next);
    setExpandedDate(customDate);
    setCustomDate("");
    invalidateChecks();
    haptic("tap");
  }

  function toggleTime(date: string, time: string) {
    const next = new Map(selectedTimes);
    const times = new Set(next.get(date) || []);
    if (times.has(time)) {
      times.delete(time);
    } else {
      if (times.size >= 2) {
        setError("একই দিনে সর্বোচ্চ ২টি appointment time নির্বাচন করা যাবে।");
        haptic("error");
        return;
      }
      times.add(time);
    }
    if (times.size) next.set(date, times);
    else next.delete(date);
    setSelectedTimes(next);
    invalidateChecks();
    haptic("tap");
  }

  async function validateBed(slot: BookingSlot, requestedBedId: BedId): Promise<BedValidation> {
    if (!selectedPatient) throw new Error("Patient not selected");
    const response = await fetch("/api/chamber/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "validate",
        patientId: selectedPatient.patientId,
        date: slot.date,
        time: slot.time,
        therapist,
        modalities,
        remarks,
        requestedBedId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.detail || payload.error || "Bed validation failed");
    }
    return payload.validation as BedValidation;
  }

  async function validatePhysioSlot(slot: BookingSlot): Promise<[string, SlotBedState]> {
    const key = slotKey(slot);
    const treatmentResults = await Promise.all(
      TREATMENT_BEDS.map(async (bed) => [bed.id, await validateBed(slot, bed.id)] as const)
    );
    const choices: Partial<Record<BedId, BedValidation>> = Object.fromEntries(treatmentResults);
    const needsTraction = treatmentResults.some(([, validation]) => validation.needsTraction);
    if (needsTraction) {
      choices["TRACTION-BED"] = await validateBed(slot, "TRACTION-BED");
    }
    const allowedIds: BedId[] = needsTraction
      ? ["TRACTION-BED"]
      : TREATMENT_BEDS.map((item) => item.id);
    const previous = bedStates.get(key)?.selectedBedId || "";
    const selectedBedId =
      (previous && allowedIds.includes(previous) && choices[previous]?.isValid ? previous : "") ||
      allowedIds.find((bedId) => choices[bedId]?.isValid) ||
      "";
    return [key, { choices, selectedBedId, checked: true }];
  }

  async function validateAll() {
    if (!selectedPatient || !therapist || selectedSlots.length === 0 || checking) {
      if (!selectedPatient || !therapist || selectedSlots.length === 0) {
        setError("Patient, clinician এবং অন্তত একটি time নির্বাচন করুন।");
        haptic("error");
      }
      return;
    }
    if (department === "Physio" && selectedTotal > 60) {
      setError(`Selected treatment ${selectedTotal} min. 60-minute appointment block-এর মধ্যে রাখতে হবে।`);
      haptic("error");
      return;
    }
    setChecking(true);
    setError("");
    try {
      if (department === "Dental") {
        setValidatedSlots(new Set(selectedSlots.map(slotKey)));
        setBedStates(new Map());
        haptic("success");
        return;
      }
      const entries = await Promise.all(selectedSlots.map(validatePhysioSlot));
      const nextStates = new Map(entries);
      setBedStates(nextStates);
      setValidatedSlots(new Set(entries.map(([key]) => key)));
      if (entries.every(([, state]) => Boolean(state.selectedBedId))) haptic("success");
      else haptic("warning");
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
      haptic("error");
    } finally {
      setChecking(false);
    }
  }

  function selectBed(slot: BookingSlot, bedId: BedId) {
    const key = slotKey(slot);
    const current = bedStates.get(key);
    if (!current?.choices[bedId]?.isValid) return;
    const next = new Map(bedStates);
    next.set(key, { ...current, selectedBedId: bedId });
    setBedStates(next);
    haptic("tap");
  }

  function requestIdFor(slot: BookingSlot): string {
    const key = slotKey(slot);
    const existing = requestIds.current.get(key);
    if (existing) return existing;
    const suffix = typeof window !== "undefined" && window.crypto?.randomUUID
      ? window.crypto.randomUUID().replaceAll("-", "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const created = `APPT${suffix}`;
    requestIds.current.set(key, created);
    return created;
  }

  async function confirmBookings() {
    if (!selectedPatient || !therapist || selectedSlots.length === 0 || booking) return;
    if (validatedSlots.size !== selectedSlots.length) {
      setError("Confirm করার আগে Check beds / Validate চাপুন।");
      haptic("error");
      return;
    }
    if (department === "Physio" && selectedSlots.some((slot) => !bedStates.get(slotKey(slot))?.selectedBedId)) {
      setError("প্রতিটি Physio appointment-এর জন্য একটি gender-safe bed select করুন।");
      haptic("error");
      return;
    }

    setBooking(true);
    setError("");
    const nextResults: BookingResult[] = [];
    for (const slot of selectedSlots) {
      const requestedBedId = bedStates.get(slotKey(slot))?.selectedBedId || "";
      try {
        const body = {
          patientId: selectedPatient.patientId,
          date: slot.date,
          time: slot.time,
          therapist,
          modalities: department === "Physio" ? modalities : [],
          remarks,
          requestId: requestIdFor(slot),
        };
        const response = await fetch(
          department === "Physio" ? "/api/chamber/schedule" : "/api/appointments",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              department === "Physio"
                ? { ...body, action: "create", requestedBedId }
                : body
            ),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.detail || payload.error || "Booking failed");
        }
        nextResults.push({ slot, status: "success", bedId: requestedBedId || undefined });
      } catch (bookingError) {
        nextResults.push({
          slot,
          status: "failed",
          bedId: requestedBedId || undefined,
          error: bookingError instanceof Error ? bookingError.message : "Booking failed",
        });
      }
    }
    setResults(nextResults);
    setBooking(false);
    if (nextResults.every((item) => item.status === "success")) haptic("success");
    else haptic("warning");
  }

  if (!selectedPatient) {
    return <p className="text-sm font-semibold text-red-700">Patient not available for booking.</p>;
  }

  if (results.length > 0) {
    const failed = results.filter((item) => item.status === "failed").length;
    return (
      <div className="space-y-4">
        <div className={`rounded-xl border p-4 ${failed ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className="text-sm font-bold text-slate-900">Booking result</p>
          <p className="mt-1 text-xs text-slate-600">{results.length - failed} booked · {failed} failed</p>
        </div>
        <div className="space-y-2">
          {results.map((result) => (
            <div key={slotKey(result.slot)} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{dayLabel(result.slot.date)} · {timeLabel(result.slot.time)}</p>
                  {result.bedId ? <p className="mt-1 text-xs text-slate-500">{bedRoom(result.bedId)} · {bedLabel(result.bedId)}</p> : null}
                  {result.error ? <p className="mt-1 text-xs text-red-700">{result.error}</p> : null}
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${result.status === "success" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {result.status === "success" ? "BOOKED" : "FAILED"}
                </span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { router.push("/appointments"); router.refresh(); }}
          className="min-h-12 w-full rounded-xl bg-blue-800 px-4 text-sm font-bold text-white"
        >
          Done
        </button>
      </div>
    );
  }

  const allReady =
    selectedSlots.length > 0 &&
    validatedSlots.size === selectedSlots.length &&
    (department === "Dental" || selectedSlots.every((slot) => Boolean(bedStates.get(slotKey(slot))?.selectedBedId)));

  return (
    <div className="space-y-4" data-unsaved-changes={selectedSlots.length > 0 ? "true" : "false"}>
      <TapChoice
        label={`${department === "Dental" ? "Dentist" : "Therapist"} *`}
        value={therapist}
        columns={departmentClinicians.length >= 3 ? 3 : 2}
        tone={department === "Dental" ? "emerald" : "blue"}
        options={departmentClinicians.map((item) => ({ value: item.fullName, label: item.fullName, subtitle: item.staffId }))}
        onChange={chooseTherapist}
      />

      {department === "Physio" ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-900">Treatment modalities</p>
              <p className="mt-0.5 text-[11px] text-slate-500">60-minute booking block; clinical flow may finish a few minutes earlier/later.</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${selectedTotal > 60 ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
              {profileBusy ? "Loading…" : `${selectedTotal}/60 min`}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {modalityOptions.map((option) => {
              const active = modalities.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleModality(option.value)}
                  className={`min-h-14 rounded-xl border px-3 py-2 text-left ${active ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span className={`mt-1 block text-[10px] ${active ? "text-blue-100" : "text-slate-400"}`}>{option.durationMin} min{option.machine ? " · machine" : ""}</span>
                </button>
              );
            })}
          </div>
          {selectedTotal > 60 ? <p className="mt-2 text-xs font-semibold text-red-700">Treatment total 60 min-এর বেশি। কিছু modality সরান।</p> : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-900">Select dates</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Quick 21-day picker + custom date</p>
          </div>
          <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">{selectedDates.size} dates</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {quickDates.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => toggleDate(date)}
              className={`min-h-12 rounded-lg border px-2 text-xs font-semibold ${selectedDates.has(date) ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}
            >
              {dayLabel(date)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} className="min-h-11 flex-1 rounded-lg border border-slate-200 px-3 text-sm" />
          <button type="button" onClick={addCustomDate} disabled={!customDate} className="min-h-11 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40">Add</button>
        </div>
      </section>

      {[...selectedDates].sort().map((date) => {
        const times = selectedTimes.get(date) || new Set<string>();
        return (
          <section key={date} className="rounded-xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setExpandedDate(expandedDate === date ? "" : date)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left">
              <span className="text-xs font-bold text-slate-900">{dayLabel(date)}</span>
              <span className="text-[11px] text-slate-500">{times.size}/2 times</span>
            </button>
            {expandedDate === date ? (
              <div className="border-t border-slate-100 p-3">
                {department === "Physio" ? (
                  <p className="mb-2 text-[10px] font-semibold text-blue-700">Hourly starts only · 9 AM–1 PM & 3–9 PM · gender-safe 4-bed allocation.</p>
                ) : null}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {timeSlots.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => toggleTime(date, time)}
                      className={`min-h-10 rounded-lg border px-2 text-xs font-semibold ${times.has(time) ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}
                    >
                      {timeLabel(time)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      {selectedSlots.length > 0 ? (
        <section className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-blue-950">Selected appointments</p>
              <p className="mt-0.5 text-[10px] text-blue-700">{department === "Physio" ? "Check beds → choose/confirm bed → book" : "Validate → book"}</p>
            </div>
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-blue-700">{selectedSlots.length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {selectedSlots.map((slot) => {
              const state = bedStates.get(slotKey(slot));
              const needsTraction = Object.values(state?.choices || {}).some((value) => value?.needsTraction);
              const options = needsTraction
                ? [{ id: "TRACTION-BED" as BedId, label: "Traction Bed", room: "Traction Room" }]
                : TREATMENT_BEDS;
              return (
                <div key={slotKey(slot)} className="rounded-xl border border-blue-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-900">{dayLabel(slot.date)} · {timeLabel(slot.time)}–{endTimeLabel(slot.time, department === "Physio" ? 60 : 30)}</p>
                      {department === "Physio" && state?.selectedBedId ? (
                        <p className="mt-1 text-[11px] font-semibold text-emerald-700">{bedRoom(state.selectedBedId)} · {bedLabel(state.selectedBedId)} · {selectedPatient.gender || "Gender set"}</p>
                      ) : null}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${validatedSlots.has(slotKey(slot)) ? (department === "Dental" || state?.selectedBedId ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700") : "bg-slate-100 text-slate-500"}`}>
                      {validatedSlots.has(slotKey(slot)) ? (department === "Dental" || state?.selectedBedId ? "READY" : "BLOCKED") : "NOT CHECKED"}
                    </span>
                  </div>

                  {department === "Physio" && state?.checked ? (
                    <div className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Gender-safe bed</p>
                      <div className={`mt-2 grid gap-2 ${options.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4"}`}>
                        {options.map((bed) => {
                          const validation = state.choices[bed.id];
                          const available = Boolean(validation?.isValid);
                          const active = state.selectedBedId === bed.id;
                          return (
                            <button
                              key={bed.id}
                              type="button"
                              disabled={!available}
                              onClick={() => selectBed(slot, bed.id)}
                              title={!available ? validation?.conflicts?.map((item) => item.message).join(" | ") : `${bed.room} · available`}
                              className={`min-h-14 rounded-xl border px-2 py-2 text-left ${active ? "border-emerald-600 bg-emerald-600 text-white" : available ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-100 text-slate-400"}`}
                            >
                              <span className="block text-xs font-bold">{bed.label}</span>
                              <span className={`mt-0.5 block text-[10px] ${active ? "text-emerald-100" : ""}`}>{available ? bed.room : shortConflict(validation)}</span>
                            </button>
                          );
                        })}
                      </div>
                      {!state.selectedBedId ? (
                        <div className="mt-2 space-y-1">
                          {uniqueConflictMessages(state).map((message) => <p key={message} className="text-[10px] text-red-700">• {message}</p>)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <label className="block text-xs font-semibold text-slate-700">
        Remarks
        <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" />
      </label>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div> : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void validateAll()}
          disabled={checking || booking || !therapist || selectedSlots.length === 0}
          className="min-h-12 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-800 disabled:opacity-40"
        >
          {checking ? "Checking…" : department === "Physio" ? "Check beds" : "Validate all"}
        </button>
        <button
          type="button"
          onClick={() => void confirmBookings()}
          disabled={booking || checking || !allReady}
          className="min-h-12 rounded-xl bg-blue-800 px-3 text-sm font-bold text-white disabled:opacity-40"
        >
          {booking ? "Booking…" : `Confirm ${selectedSlots.length}`}
        </button>
      </div>
    </div>
  );
}
