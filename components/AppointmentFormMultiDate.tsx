"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";

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

type BookingSlot = {
  date: string;
  time: string;
};

type BookingResult = {
  slot: BookingSlot;
  status: "success" | "failed" | "pending";
  requestId: string;
  error?: string;
};

type SlotValidation = {
  slot: BookingSlot;
  isValid: boolean;
  conflict?: string;
  suggestion?: string;
};

function bedLabel(value: string): string {
  if (value === "TRACTION-BED") return "Traction Bed";
  const match = /^BED-([1-4])$/.exec(value);
  return match ? `Bed ${match[1]}` : value || "—";
}

// Generate stable deterministic requestId for a given date/time/patient/therapist
function generateDeterministicRequestId(
  patientId: string,
  date: string,
  time: string,
  therapistId: string
): string {
  const input = `${patientId}|${date}|${time}|${therapistId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    hash = ((hash << 5) - hash) + byte;
    hash = hash & hash; // 32-bit integer
  }
  return `APPT${Math.abs(hash).toString(16).padStart(16, "0")}`;
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
  const defaultPatient = patients.find((patient) => patient.patientId === defaultPatientId);
  const initialDepartment =
    defaultPatient?.department === "Physio" || defaultPatient?.department === "Dental"
      ? defaultPatient.department
      : defaultDepartment;

  // State: Patient & Therapist selection
  const [departmentFilter, setDepartmentFilter] = useState<Department | "All">(initialDepartment || "All");
  const [patientText, setPatientText] = useState(
    defaultPatient ? `${defaultPatient.patientId} — ${defaultPatient.fullName}` : ""
  );
  const [therapist, setTherapist] = useState("");
  const [remarks, setRemarks] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);

  // State: Multi-date/multi-time selection
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedTimes, setSelectedTimes] = useState<Map<string, Set<string>>>(new Map()); // date -> Set<time>
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState<string | null>(null); // date currently selecting times for

  // State: Validation & Booking
  const [slotValidations, setSlotValidations] = useState<Map<string, SlotValidation>>(new Map());
  const [bookingResults, setBookingResults] = useState<BookingResult[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [validationBusy, setValidationBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [error, setError] = useState("");

  const patientId = patientText.split("—")[0]?.trim() || "";
  const selectedPatient = patients.find((patient) => patient.patientId === patientId);
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

  // Fetch booking profile when patient changes
  useEffect(() => {
    if (!selectedPatient || selectedPatient.department !== "Physio") {
      setModalities([]);
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
        if (suggested.length > 0) setModalities(suggested);
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

  // Collect all selected slots (date + time combinations)
  const selectedSlots = useMemo<BookingSlot[]>(() => {
    const slots: BookingSlot[] = [];
    Array.from(selectedDates).sort().forEach((date) => {
      const timesForDate = selectedTimes.get(date) || new Set();
      Array.from(timesForDate)
        .sort()
        .forEach((time) => {
          slots.push({ date, time });
        });
    });
    return slots;
  }, [selectedDates, selectedTimes]);

  // Preflight validate all selected slots
  const preflightValidate = async () => {
    if (!selectedPatient || !therapist || selectedSlots.length === 0) {
      setError("Patient, therapist, and at least one date/time required");
      return;
    }
    setError("");
    setValidationBusy(true);
    const validations = new Map<string, SlotValidation>();

    for (const slot of selectedSlots) {
      const slotKey = `${slot.date}|${slot.time}`;
      try {
        const response = await fetch("/api/appointments/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientId: selectedPatient.patientId,
            date: slot.date,
            time: slot.time,
            therapist,
            modalities: selectedPatient.department === "Physio" ? modalities : [],
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          validations.set(slotKey, {
            slot,
            isValid: false,
            conflict: payload.conflictType || payload.error || "Validation failed",
            suggestion: payload.detail,
          });
        } else {
          validations.set(slotKey, { slot, isValid: true });
        }
      } catch (e) {
        validations.set(slotKey, {
          slot,
          isValid: false,
          conflict: "Network error",
        });
      }
    }

    setSlotValidations(validations);
    setValidationBusy(false);
    return validations;
  };

  // Book all valid slots sequentially
  const bookAllSlots = async () => {
    if (!selectedPatient || !therapist) {
      setError("Patient and therapist required");
      return;
    }

    setError("");
    setBookingBusy(true);
    setBookingResults([]);
    const results: BookingResult[] = [];

    for (const slot of selectedSlots) {
      const slotKey = `${slot.date}|${slot.time}`;
      const validation = slotValidations.get(slotKey);
      if (!validation?.isValid) {
        results.push({
          slot,
          status: "failed",
          requestId: "",
          error: validation?.conflict || "Preflight validation failed",
        });
        continue;
      }

      const requestId = generateDeterministicRequestId(selectedPatient.patientId, slot.date, slot.time, therapist);
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
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          results.push({
            slot,
            status: "failed",
            requestId,
            error:
              result.error === "APPOINTMENT_DUPLICATE"
                ? "Already booked"
                : result.detail || result.error || `HTTP ${response.status}`,
          });
        } else {
          results.push({ slot, status: "success", requestId });
        }
      } catch (e) {
        results.push({
          slot,
          status: "failed",
          requestId,
          error: e instanceof Error ? e.message : "Booking failed",
        });
      }
    }

    setBookingResults(results);
    setBookingBusy(false);

    // If all successful, redirect after delay
    const successCount = results.filter((r) => r.status === "success").length;
    if (successCount === selectedSlots.length) {
      haptic("success");
      setTimeout(() => {
        router.push(`/appointments?date=${encodeURIComponent(selectedSlots[0].date)}`);
        router.refresh();
      }, 1000);
    } else if (successCount > 0) {
      haptic("warning");
    } else {
      haptic("error");
    }
  };

  // Toggle date selection
  const toggleDate = (dateStr: string) => {
    haptic("tap");
    const newDates = new Set(selectedDates);
    if (newDates.has(dateStr)) {
      newDates.delete(dateStr);
      const newTimes = new Map(selectedTimes);
      newTimes.delete(dateStr);
      setSelectedTimes(newTimes);
    } else {
      newDates.add(dateStr);
    }
    setSelectedDates(newDates);
  };

  // Toggle time for a specific date (max 2 per day)
  const toggleTime = (dateStr: string, timeStr: string) => {
    haptic("tap");
    const timesForDate = new Set(selectedTimes.get(dateStr) || []);
    if (timesForDate.has(timeStr)) {
      timesForDate.delete(timeStr);
    } else {
      if (timesForDate.size >= 2) {
        haptic("error");
        setError("Maximum 2 time slots per day");
        return;
      }
      timesForDate.add(timeStr);
    }
    const newTimes = new Map(selectedTimes);
    if (timesForDate.size === 0) {
      newTimes.delete(dateStr);
    } else {
      newTimes.set(dateStr, timesForDate);
    }
    setSelectedTimes(newTimes);
  };

  // Generate date range (14 days from start)
  const dateRange = useMemo(() => {
    const dates = [];
    const startDate_ = new Date(startDate + "T00:00:00");
    for (let i = 0; i < 14; i++) {
      const d = new Date(startDate_);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    return dates;
  }, [startDate]);

  // Common time slots
  const timeSlots = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "13:00", "14:00", "14:30", "15:00", "15:30", "16:00"];

  const bookedCount = bookingResults.filter((r) => r.status === "success").length;
  const failedCount = bookingResults.filter((r) => r.status === "failed").length;

  if (bookingResults.length > 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Booking Results</h2>
          <p className="text-sm text-slate-500">
            {bookedCount} booked, {failedCount} failed
          </p>
        </div>

        {bookingResults.map((result, idx) => (
          <div
            key={idx}
            className={`rounded-lg border-l-4 px-4 py-3 ${
              result.status === "success"
                ? "border-green-500 bg-green-50"
                : "border-red-500 bg-red-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-950">
                  {result.slot.date} at {result.slot.time}
                </p>
                {result.error && <p className="text-xs text-slate-600">{result.error}</p>}
              </div>
              <StatusBadge status={result.status === "success" ? "confirmed" : "error"} />
            </div>
          </div>
        ))}

        <div className="flex gap-2 pt-4">
          {failedCount > 0 && (
            <button
              onClick={() => {
                setBookingResults([]);
                setSelectedSlots((current) =>
                  current.filter((slot) => !bookingResults.some((r) => r.slot === slot && r.status === "failed"))
                );
              }}
              className="relife-interactive flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600"
            >
              Retry Failed
            </button>
          )}
          <button
            onClick={() => router.push("/appointments")}
            className="relife-interactive flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-4">
      {/* Patient Selection */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Patient</label>
        <input
          type="text"
          list="patient-list"
          value={patientText}
          onChange={(e) => setPatientText(e.currentTarget.value)}
          placeholder="Patient ID or name"
          className="relife-input mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        />
        <datalist id="patient-list">
          {visiblePatients.map((patient) => (
            <option key={patient.patientId} value={`${patient.patientId} — ${patient.fullName}`} />
          ))}
        </datalist>
      </div>

      {/* Therapist Selection */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Therapist</label>
        <select
          value={therapist}
          onChange={(e) => setTherapist(e.currentTarget.value)}
          className="relife-input mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        >
          <option value="">Select therapist</option>
          {departmentClinicians.map((c) => (
            <option key={c.staffId} value={c.staffId}>
              {c.fullName}
            </option>
          ))}
        </select>
      </div>

      {/* Multi-Date Selection */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">
          Select Dates ({selectedDates.size})
        </label>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {dateRange.map((dateStr) => {
            const dateObj = new Date(dateStr + "T00:00:00");
            const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dateObj.getDay()];
            const dayNum = dateObj.getDate();
            const isSelected = selectedDates.has(dateStr);
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => toggleDate(dateStr)}
                className={`relife-interactive rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                  isSelected
                    ? "bg-blue-600 text-white"
                    : "border border-slate-300 bg-white text-slate-600"
                }`}
              >
                <div>{dayName}</div>
                <div className="text-base">{dayNum}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Multi-Time Selection (per selected date) */}
      {Array.from(selectedDates)
        .sort()
        .map((dateStr) => (
          <div key={dateStr}>
            <button
              type="button"
              onClick={() => setShowTimePicker(showTimePicker === dateStr ? null : dateStr)}
              className="relife-interactive text-xs font-semibold uppercase tracking-[0.12em] text-blue-700"
            >
              {dateStr} — Select Times ({(selectedTimes.get(dateStr) || new Set()).size}/2)
            </button>
            {showTimePicker === dateStr && (
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {timeSlots.map((timeStr) => {
                  const timesForDate = selectedTimes.get(dateStr) || new Set();
                  const isSelected = timesForDate.has(timeStr);
                  return (
                    <button
                      key={timeStr}
                      type="button"
                      onClick={() => toggleTime(dateStr, timeStr)}
                      className={`relife-interactive rounded-lg px-2 py-2.5 text-xs font-semibold transition-colors ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "border border-slate-300 bg-white text-slate-600"
                      }`}
                    >
                      {timeStr}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

      {/* Summary */}
      {selectedSlots.length > 0 && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-blue-900">
            Selected: {selectedSlots.length} appointments
          </p>
          <ul className="mt-1 space-y-1 text-xs text-blue-800">
            {selectedSlots.map((slot, idx) => (
              <li key={idx}>
                {slot.date} at {slot.time}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error */}
      {error && <InlineNotice type="error" message={error} />}

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <button
          type="button"
          onClick={preflightValidate}
          disabled={validationBusy || selectedSlots.length === 0}
          className="relife-interactive flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50"
        >
          {validationBusy ? <Spinner /> : "Validate"}
        </button>
        <button
          type="button"
          onClick={bookAllSlots}
          disabled={bookingBusy || selectedSlots.length === 0 || slotValidations.size === 0}
          className="relife-interactive flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {bookingBusy ? <Spinner /> : `Confirm ${selectedSlots.length} Bookings`}
        </button>
      </div>
    </form>
  );
}
