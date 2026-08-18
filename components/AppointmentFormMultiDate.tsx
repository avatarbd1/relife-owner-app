"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Spinner, StatusBadge } from "@/components/FeedbackUI";
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

type SchedulePreview = {
  date: string;
  dayName: string;
  time: string;
  therapist: string;
};

export default function AppointmentFormMultiDate({
  patients,
  clinicians,
  modalityOptions,
  defaultPatientId,
  defaultDepartment,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  modalityOptions: ModalityOption[];
  defaultPatientId?: string;
  defaultDepartment?: Department;
}) {
  const router = useRouter();
  const requestIdRef = useRef("");
  const defaultPatient = patients.find((patient) => patient.patientId === defaultPatientId);
  const initialDepartment = defaultPatient?.department === "Physio" || defaultPatient?.department === "Dental"
    ? defaultPatient.department
    : defaultDepartment;

  const [departmentFilter, setDepartmentFilter] = useState<Department | "All">(initialDepartment || "All");
  const [patientText, setPatientText] = useState(
    defaultPatient ? `${defaultPatient.patientId} — ${defaultPatient.fullName}` : ""
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [time, setTime] = useState("09:00");
  const [therapist, setTherapist] = useState("");
  const [remarks, setRemarks] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [results, setResults] = useState<Array<{ date: string; success: boolean; message: string }>>([]);

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

  // Generate dates based on date range and selected days of week
  function generateScheduleDates(): SchedulePreview[] {
    if (!startDate || !endDate) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const preview: SchedulePreview[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (daysOfWeek.includes(dayOfWeek)) {
        const dateStr = d.toISOString().split("T")[0];
        preview.push({
          date: dateStr,
          dayName: dayNames[dayOfWeek],
          time,
          therapist,
        });
      }
    }

    return preview;
  }

  const scheduledDates = generateScheduleDates();

  function toggleDayOfWeek(day: number) {
    haptic("tap");
    setDaysOfWeek((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    );
  }

  function toggleModality(value: string) {
    haptic("tap");
    setModalities((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedPatient || !startDate || !endDate || !time || !therapist || daysOfWeek.length === 0) {
      setError("All fields required: Patient, date range, time, days of week, therapist");
      haptic("error");
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setError("End date must be after or equal to start date");
      haptic("error");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    setResults([]);

    try {
      const datesToBook = scheduledDates;
      if (datesToBook.length === 0) {
        setError("No dates selected based on your criteria");
        setBusy(false);
        return;
      }

      const results: Array<{ date: string; success: boolean; message: string }> = [];
      let successCount = 0;

      for (const scheduled of datesToBook) {
        try {
          const response = await fetch("/api/appointments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              patientId: selectedPatient.patientId,
              date: scheduled.date,
              time: scheduled.time,
              therapist: scheduled.therapist,
              remarks,
              modalities: selectedPatient.department === "Physio" ? modalities : [],
              requestId: `APPT${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            }),
          });

          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            results.push({
              date: scheduled.date,
              success: false,
              message: result.error || `HTTP ${response.status}`,
            });
          } else {
            results.push({
              date: scheduled.date,
              success: true,
              message: "Booked ✓",
            });
            successCount++;
          }
        } catch (err) {
          results.push({
            date: scheduled.date,
            success: false,
            message: err instanceof Error ? err.message : "Error booking",
          });
        }
      }

      setResults(results);
      if (successCount > 0) {
        haptic("success");
        setSuccess(`${successCount} of ${datesToBook.length} appointments booked successfully`);
        if (successCount === datesToBook.length) {
          setTimeout(() => {
            router.push("/appointments");
            router.refresh();
          }, 2000);
        }
      } else {
        haptic("error");
        setError("All appointments failed to book");
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Error booking appointments");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-sm font-bold text-blue-900">📅 Book Multiple Appointments</p>
        <p className="text-xs text-blue-700">Select a date range and days of week to book recurring slots</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Department */}
        <div>
          <p className="text-xs font-semibold text-slate-700">Department</p>
          <div className="mt-2 grid grid-cols-3 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
            {(["All", "Physio", "Dental"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  haptic("tap");
                  setDepartmentFilter(item);
                  if (selectedPatient && item !== "All" && selectedPatient.department !== item) {
                    setPatientText("");
                    setTherapist("");
                    setModalities([]);
                  }
                }}
                className={`relife-interactive min-h-10 rounded-lg px-2 text-xs font-semibold ${
                  departmentFilter === item
                    ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {/* Patient */}
        <label className="block text-xs font-semibold text-slate-700">
          Patient *
          <input
            list="multidate-patients"
            value={patientText}
            onChange={(event) => {
              setPatientText(event.target.value);
              setTherapist("");
              setModalities([]);
            }}
            placeholder="Patient ID বা নাম লিখুন"
            className={inputClass}
          />
          <datalist id="multidate-patients">
            {visiblePatients.map((patient) => (
              <option key={`${patient.department}-${patient.patientId}`} value={`${patient.patientId} — ${patient.fullName}`} />
            ))}
          </datalist>
        </label>

        {selectedPatient && (
          <div className={`rounded-xl border px-3 py-2.5 text-xs ${
            selectedPatient.department === "Dental"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-blue-200 bg-blue-50 text-blue-800"
          }`}>
            <p className="font-semibold">{selectedPatient.fullName}</p>
            <p className="mt-0.5 text-[11px] opacity-75">{selectedPatient.patientId} · {selectedPatient.department}</p>
          </div>
        )}

        {/* Therapist */}
        <TapChoice
          label={`${selectedPatient?.department === "Dental" ? "Dentist" : "Therapist"} *`}
          value={therapist}
          disabled={!selectedPatient}
          columns={departmentClinicians.length >= 3 ? 3 : 2}
          tone={selectedPatient?.department === "Dental" ? "emerald" : "blue"}
          options={departmentClinicians.map((item) => ({
            value: item.fullName,
            label: item.fullName,
          }))}
          onChange={(value) => {
            haptic("tap");
            setTherapist(value);
          }}
        />

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-slate-700">
            Start Date *
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            End Date *
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        {/* Days of Week */}
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">Days of Week *</p>
          <div className="grid grid-cols-7 gap-1">
            {dayLabels.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDayOfWeek(day)}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  daysOfWeek.includes(day)
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 text-slate-600 bg-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        <label className="block text-xs font-semibold text-slate-700">
          Time *
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClass}
          />
        </label>

        {/* Remarks */}
        <label className="block text-xs font-semibold text-slate-700">
          Remarks (optional)
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Any notes or special instructions"
            rows={2}
            className={inputClass}
          />
        </label>

        {/* Error / Success */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
            ✓ {success}
          </div>
        )}

        {/* Schedule Preview */}
        {scheduledDates.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-900 mb-2">Preview ({scheduledDates.length} appointments)</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {scheduledDates.slice(0, 10).map((slot, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-700 bg-white rounded px-2 py-1">
                  <span>{slot.dayName}, {slot.date}</span>
                  <span className="font-medium">{slot.time}</span>
                </div>
              ))}
              {scheduledDates.length > 10 && (
                <p className="text-xs text-slate-500 px-2 py-1">... and {scheduledDates.length - 10} more</p>
              )}
            </div>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-900 mb-2">Results</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={`flex justify-between items-center text-xs px-2 py-1 rounded ${
                    result.success
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  <span>{result.date}</span>
                  <span>{result.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={busy || scheduledDates.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy && <Spinner size="sm" className="border-white/30 border-t-white" />}
          {busy ? "Booking..." : `Book ${scheduledDates.length} Appointments`}
        </button>
      </form>
    </div>
  );
}
