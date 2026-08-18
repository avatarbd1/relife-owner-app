"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";
import { PHYSIO_CHAMBER_STARTS } from "@/lib/domain/chamber/hours";

type Department = "Physio" | "Dental";

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

type BookingSuggestion = {
  time: string;
  timeLabel?: string;
  assignedBedId?: string;
  totalDurationMin?: number;
};

type SlotValidation = {
  slot: BookingSlot;
  isValid: boolean;
  assignedBedId?: string;
  roomId?: string;
  totalDurationMin?: number;
  conflicts: string[];
  suggestions: BookingSuggestion[];
};

type BookingResult = {
  slot: BookingSlot;
  status: "success" | "failed";
  requestId?: string;
  error?: string;
};

const PHYSIO_TIME_SLOTS = [...PHYSIO_CHAMBER_STARTS];

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

function dayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 6)));
}

function timeLabel(value: string): string {
  const [hourRaw, minute] = value.split(":");
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${String(display).padStart(2, "0")}:${minute} ${suffix}`;
}

function slotKey(slot: BookingSlot): string {
  return `${slot.date}|${slot.time}`;
}

function friendlyBookingError(result: Record<string, unknown>, status: number): string {
  if (result.error === "APPOINTMENT_DUPLICATE") return "এই appointment আগে থেকেই আছে।";
  if (result.error === "APPOINTMENT_CONFLICT") return String(result.detail || "Bed/machine conflict detected.");
  if (result.error === "APPOINTMENT_CAPACITY") return String(result.detail || "এই slot-এ capacity খালি নেই।");
  if (result.error === "ACCESS_DENIED") return "এই Department-এ appointment create permission নেই।";
  if (result.error === "INVALID_SLOT") return "Physio booking 9 AM–1 PM ও 3–9 PM-এর hourly slot-এ করা যাবে।";
  return String(result.detail || result.error || `HTTP ${status}`);
}

export default function AppointmentFormMultiDate({
  patients,
  clinicians,
  modalityOptions,
  defaultPatientId,
  startDate,
  defaultDepartment,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  modalityOptions: ModalityOption[];
  defaultPatientId?: string;
  startDate: string;
  defaultDepartment?: Department;
}) {
  const router = useRouter();
  const requestIdsRef = useRef(new Map<string, string>());
  const defaultPatient = patients.find((patient) => patient.patientId === defaultPatientId);
  const initialDepartment =
    defaultPatient?.department === "Physio" || defaultPatient?.department === "Dental"
      ? defaultPatient.department
      : defaultDepartment;

  const [departmentFilter, setDepartmentFilter] = useState<Department | "All">(initialDepartment || "All");
  const [patientText, setPatientText] = useState(
    defaultPatient ? `${defaultPatient.patientId} — ${defaultPatient.fullName}` : ""
  );
  const [therapist, setTherapist] = useState("");
  const [remarks, setRemarks] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [suggestedModalities, setSuggestedModalities] = useState<string[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set([startDate]));
  const [selectedTimes, setSelectedTimes] = useState<Map<string, Set<string>>>(new Map());
  const [expandedDate, setExpandedDate] = useState<string>(startDate);
  const [customDate, setCustomDate] = useState("");

  const [slotValidations, setSlotValidations] = useState<Map<string, SlotValidation>>(new Map());
  const [bookingResults, setBookingResults] = useState<BookingResult[]>([]);
  const [validationBusy, setValidationBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [error, setError] = useState("");

  const patientId = patientText.split("—")[0]?.trim() || "";
  const selectedPatient = patients.find((patient) => patient.patientId === patientId);
  const timeSlots = selectedPatient?.department === "Physio" ? PHYSIO_TIME_SLOTS : DENTAL_TIME_SLOTS;

  const visiblePatients = useMemo(
    () => patients.filter((patient) => departmentFilter === "All" || patient.department === departmentFilter),
    [departmentFilter, patients]
  );
  const departmentClinicians = useMemo(
    () =>
      selectedPatient && selectedPatient.department !== "All"
        ? clinicians.filter((item) => item.department === selectedPatient.department)
        : [],
    [clinicians, selectedPatient]
  );
  const selectedOptions = useMemo(
    () => modalities.flatMap((value) => {
      const option = modalityOptions.find((item) => item.value === value);
      return option ? [option] : [];
    }),
    [modalities, modalityOptions]
  );
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
  const selectionSignature = selectedSlots.map(slotKey).join(",");
  const intentSignature = `${patientId}|${therapist}|${remarks}|${modalities.join(",")}`;

  useEffect(() => {
    setSlotValidations(new Map());
    setBookingResults([]);
    setError("");
  }, [selectionSignature, therapist, modalities]);

  useEffect(() => {
    if (!selectedPatient || selectedPatient.department !== "Physio") {
      setModalities([]);
      setSuggestedModalities([]);
      setProfileBusy(false);
      return;
    }
    let cancelled = false;
    setProfileBusy(true);
    void fetch("/api/appointments/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientId: selectedPatient.patientId }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || "BOOKING_PROFILE_FAILED");
        if (cancelled) return;
        const suggested = Array.isArray(payload.profile?.suggestedModalities)
          ? payload.profile.suggestedModalities.map(String)
          : [];
        setSuggestedModalities(suggested);
        setModalities(suggested);
      })
      .catch((profileError) => {
        if (!cancelled) setError(profileError instanceof Error ? profileError.message : "Booking profile failed");
      })
      .finally(() => {
        if (!cancelled) setProfileBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPatient?.patientId, selectedPatient?.department]);

  function resetPatientDependentState(nextText: string) {
    setPatientText(nextText);
    setTherapist("");
    setModalities([]);
    setSuggestedModalities([]);
    setSelectedTimes(new Map());
    setSlotValidations(new Map());
    setBookingResults([]);
    requestIdsRef.current.clear();
  }

  function toggleModality(value: string) {
    haptic("tap");
    setModalities((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  function toggleDate(date: string) {
    haptic("tap");
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
  }

  function addCustomDate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) return;
    const next = new Set(selectedDates);
    next.add(customDate);
    setSelectedDates(next);
    setExpandedDate(customDate);
    setCustomDate("");
    haptic("tap");
  }

  function toggleTime(date: string, time: string) {
    const next = new Map(selectedTimes);
    const times = new Set(next.get(date) || []);
    if (times.has(time)) {
      times.delete(time);
    } else {
      if (times.size >= 2) {
        setError("একই দিনে সর্বোচ্চ ২টি time slot নির্বাচন করা যাবে।");
        haptic("error");
        return;
      }
      times.add(time);
    }
    if (times.size) next.set(date, times);
    else next.delete(date);
    setSelectedTimes(next);
    setError("");
    haptic("tap");
  }

  function replaceTime(date: string, oldTime: string, newTime: string) {
    const next = new Map(selectedTimes);
    const times = new Set(next.get(date) || []);
    times.delete(oldTime);
    if (times.size >= 2 && !times.has(newTime)) {
      setError("Suggested time বসাতে আগে ওই দিনের একটি slot সরান।");
      return;
    }
    times.add(newTime);
    next.set(date, times);
    setSelectedTimes(next);
    haptic("tap");
  }

  async function validateSlot(slot: BookingSlot): Promise<SlotValidation> {
    if (!selectedPatient) {
      return { slot, isValid: false, conflicts: ["Patient not selected"], suggestions: [] };
    }
    if (selectedPatient.department === "Dental") {
      return { slot, isValid: true, conflicts: [], suggestions: [] };
    }
    try {
      const response = await fetch("/api/appointments/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.patientId,
          date: slot.date,
          time: slot.time,
          therapist,
          modalities,
          remarks,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        return {
          slot,
          isValid: false,
          conflicts: [String(payload.detail || payload.error || "Validation failed")],
          suggestions: [],
        };
      }
      const validation = payload.validation || {};
      return {
        slot,
        isValid: Boolean(validation.isValid),
        assignedBedId: String(validation.assignedBedId || ""),
        roomId: String(validation.roomId || ""),
        totalDurationMin: Number(validation.totalDurationMin || 0),
        conflicts: Array.isArray(validation.conflicts)
          ? validation.conflicts.map((item: { message?: unknown }) => String(item?.message || "Booking conflict"))
          : [],
        suggestions: Array.isArray(validation.suggestions)
          ? validation.suggestions.slice(0, 4).map((item: BookingSuggestion) => ({
              time: String(item.time || ""),
              timeLabel: String(item.timeLabel || ""),
              assignedBedId: String(item.assignedBedId || ""),
              totalDurationMin: Number(item.totalDurationMin || 0),
            }))
          : [],
      };
    } catch (validationError) {
      return {
        slot,
        isValid: false,
        conflicts: [validationError instanceof Error ? validationError.message : "Validation failed"],
        suggestions: [],
      };
    }
  }

  async function preflightValidate() {
    if (!selectedPatient || !therapist || selectedSlots.length === 0) {
      setError("Patient, clinician এবং অন্তত একটি date/time নির্বাচন করুন।");
      haptic("error");
      return;
    }
    setValidationBusy(true);
    setError("");
    const values = await Promise.all(selectedSlots.map(validateSlot));
    setSlotValidations(new Map(values.map((value) => [slotKey(value.slot), value])));
    setValidationBusy(false);
    if (values.every((value) => value.isValid)) haptic("success");
    else haptic("warning");
  }

  function requestIdFor(slot: BookingSlot): string {
    const key = `${intentSignature}|${slotKey(slot)}`;
    const existing = requestIdsRef.current.get(key);
    if (existing) return existing;
    const created = `APPT${window.crypto.randomUUID().replace(/-/g, "")}`;
    requestIdsRef.current.set(key, created);
    return created;
  }

  async function confirmBookings() {
    if (!selectedPatient || !therapist || selectedSlots.length === 0 || bookingBusy) return;
    if (slotValidations.size !== selectedSlots.length) {
      setError("Confirm করার আগে সব selected slot Validate করুন।");
      haptic("error");
      return;
    }
    const results: BookingResult[] = [];
    setBookingBusy(true);
    setError("");

    for (const slot of selectedSlots) {
      const validation = slotValidations.get(slotKey(slot));
      if (!validation?.isValid) {
        results.push({ slot, status: "failed", error: validation?.conflicts[0] || "Slot blocked" });
        continue;
      }
      const requestId = requestIdFor(slot);
      try {
        const response = await fetch("/api/appointments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientId: selectedPatient.patientId,
            date: slot.date,
            time: slot.time,
            therapist,
            remarks,
            modalities: selectedPatient.department === "Physio" ? modalities : [],
            requestId: selectedPatient.department === "Physio" ? requestId : undefined,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          results.push({ slot, status: "failed", requestId, error: friendlyBookingError(payload, response.status) });
        } else {
          results.push({ slot, status: "success", requestId });
        }
      } catch (submitError) {
        results.push({
          slot,
          status: "failed",
          requestId,
          error: submitError instanceof Error ? submitError.message : "Booking failed",
        });
      }
    }

    setBookingResults(results);
    setBookingBusy(false);
    if (results.every((item) => item.status === "success")) haptic("success");
    else if (results.some((item) => item.status === "success")) haptic("warning");
    else haptic("error");
  }

  function retryFailedOnly() {
    const failed = bookingResults.filter((item) => item.status === "failed").map((item) => item.slot);
    const dates = new Set<string>();
    const times = new Map<string, Set<string>>();
    for (const slot of failed) {
      dates.add(slot.date);
      const current = new Set(times.get(slot.date) || []);
      current.add(slot.time);
      times.set(slot.date, current);
    }
    setSelectedDates(dates);
    setSelectedTimes(times);
    setExpandedDate(failed[0]?.date || "");
    setSlotValidations(new Map());
    setBookingResults([]);
    setError("");
    haptic("tap");
  }

  const validCount = [...slotValidations.values()].filter((item) => item.isValid).length;
  const failedCount = bookingResults.filter((item) => item.status === "failed").length;
  const successCount = bookingResults.filter((item) => item.status === "success").length;

  if (bookingResults.length > 0) {
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-base font-semibold text-slate-950">Booking result</h2>
          <p className="mt-1 text-xs text-slate-500">{successCount} booked · {failedCount} failed</p>
        </section>
        <div className="space-y-2">
          {bookingResults.map((result) => (
            <article key={slotKey(result.slot)} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{dayLabel(result.slot.date)} · {timeLabel(result.slot.time)}</p>
                {result.error && <p className="mt-1 text-xs text-red-700">{result.error}</p>}
              </div>
              <StatusBadge tone={result.status === "success" ? "success" : "error"}>
                {result.status === "success" ? "Booked" : "Failed"}
              </StatusBadge>
            </article>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {failedCount > 0 && (
            <button type="button" onClick={retryFailedOnly} className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800">
              Retry failed only
            </button>
          )}
          <button type="button" onClick={() => { router.push("/appointments"); router.refresh(); }} className="min-h-11 rounded-xl bg-blue-800 px-3 text-sm font-semibold text-white">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-slate-700">Department</p>
        <div className="mt-2 grid grid-cols-3 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
          {(["All", "Physio", "Dental"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setDepartmentFilter(item);
                if (selectedPatient && item !== "All" && selectedPatient.department !== item) resetPatientDependentState("");
                haptic("tap");
              }}
              className={`min-h-10 rounded-lg px-2 text-xs font-semibold ${departmentFilter === item ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        Patient *
        <input
          list="multi-booking-patients"
          value={patientText}
          onChange={(event) => resetPatientDependentState(event.target.value)}
          placeholder="Patient ID বা নাম লিখুন"
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        />
        <datalist id="multi-booking-patients">
          {visiblePatients.map((patient) => (
            <option key={`${patient.department}-${patient.patientId}`} value={`${patient.patientId} — ${patient.fullName}`} />
          ))}
        </datalist>
      </label>

      {selectedPatient && (
        <div className={`rounded-xl border px-3 py-2.5 text-xs ${selectedPatient.department === "Dental" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
          <strong>{selectedPatient.fullName}</strong> · {selectedPatient.patientId} · {selectedPatient.department}
        </div>
      )}

      <TapChoice
        label={`${selectedPatient?.department === "Dental" ? "Dentist" : "Therapist"} *`}
        value={therapist}
        disabled={!selectedPatient}
        columns={departmentClinicians.length >= 3 ? 3 : 2}
        tone={selectedPatient?.department === "Dental" ? "emerald" : "blue"}
        options={departmentClinicians.map((item) => ({ value: item.fullName, label: item.fullName, subtitle: item.staffId }))}
        onChange={setTherapist}
      />

      {selectedPatient?.department === "Physio" && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-900">Treatment modalities</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Selection order is preserved for timeline validation.</p>
            </div>
            {profileBusy && <Spinner size="sm" label="Loading modality profile" />}
          </div>
          {suggestedModalities.length > 0 && (
            <p className="mt-2 text-[10px] text-blue-700">Plan suggestion: {suggestedModalities.map((value) => modalityOptions.find((item) => item.value === value)?.label || value).join(" → ")}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {modalityOptions.map((option) => {
              const active = modalities.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleModality(option.value)}
                  className={`min-h-14 rounded-xl border px-3 py-2 text-left ${active ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span className={`mt-1 block text-[10px] ${active ? "text-blue-100" : "text-slate-400"}`}>{option.durationMin} min{option.machine ? " · machine" : ""}</span>
                </button>
              );
            })}
          </div>
          {selectedOptions.length > 0 && <p className="mt-2 text-[10px] text-slate-500">{selectedOptions.map((item) => item.label).join(" → ")}</p>}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-900">Select dates</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Quick 21-day picker + custom date</p>
          </div>
          <StatusBadge tone="info">{selectedDates.size} dates</StatusBadge>
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
              <span className="text-xs font-semibold text-slate-900">{dayLabel(date)}</span>
              <span className="text-[11px] text-slate-500">{times.size}/2 times</span>
            </button>
            {expandedDate === date && (
              <div className="border-t border-slate-100 p-3">
                {selectedPatient?.department === "Physio" && (
                  <p className="mb-2 text-[10px] font-medium text-blue-700">60-minute slots · 9 AM–1 PM & 3–9 PM · 4 beds.</p>
                )}
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
            )}
          </section>
        );
      })}

      {selectedSlots.length > 0 && (
        <section className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-blue-950">Selected appointments</p>
            <StatusBadge tone="info">{selectedSlots.length}</StatusBadge>
          </div>
          <div className="mt-2 space-y-2">
            {selectedSlots.map((slot) => {
              const validation = slotValidations.get(slotKey(slot));
              return (
                <div key={slotKey(slot)} className="rounded-lg bg-white/80 p-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{dayLabel(slot.date)} · {timeLabel(slot.time)}</p>
                      {validation?.isValid && selectedPatient?.department === "Physio" && (
                        <p className="mt-1 text-[10px] text-emerald-700">{validation.assignedBedId || "Bed assigned"}{validation.roomId ? ` · ${validation.roomId}` : ""}{validation.totalDurationMin ? ` · ${validation.totalDurationMin}m` : ""}</p>
                      )}
                      {validation && !validation.isValid && validation.conflicts.map((conflict, index) => (
                        <p key={`${conflict}-${index}`} className="mt-1 text-[10px] text-red-700">{conflict}</p>
                      ))}
                    </div>
                    {validation ? <StatusBadge tone={validation.isValid ? "success" : "error"}>{validation.isValid ? "Safe" : "Blocked"}</StatusBadge> : <StatusBadge tone="neutral">Not checked</StatusBadge>}
                  </div>
                  {validation && !validation.isValid && validation.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {validation.suggestions.map((suggestion) => (
                        <button key={suggestion.time} type="button" onClick={() => replaceTime(slot.date, slot.time, suggestion.time)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold text-emerald-800">
                          Use {suggestion.timeLabel || timeLabel(suggestion.time)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <label className="block text-xs font-semibold text-slate-700">
        Remarks
        <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" />
      </label>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={preflightValidate}
          disabled={validationBusy || bookingBusy || !selectedPatient || !therapist || selectedSlots.length === 0}
          className="min-h-12 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 disabled:opacity-40"
        >
          {validationBusy ? "Checking…" : "Validate all"}
        </button>
        <button
          type="button"
          onClick={confirmBookings}
          disabled={bookingBusy || validationBusy || validCount === 0 || slotValidations.size !== selectedSlots.length}
          className="min-h-12 rounded-xl bg-blue-800 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {bookingBusy ? "Booking…" : `Confirm ${validCount || selectedSlots.length}`}
        </button>
      </div>
      <p className="text-center text-[10px] leading-4 text-slate-400">Each slot is written through the existing canonical appointment API and keeps its own retry/idempotency identity.</p>
    </div>
  );
}
