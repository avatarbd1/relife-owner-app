"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

type Patient = {
  patientId: string;
  fullName: string;
  department: Department | "All";
};

type Clinician = {
  staffId: string;
  fullName: string;
  department: Department;
};

export default function AppointmentForm({
  patients,
  clinicians,
  defaultPatientId,
  defaultDate,
  defaultDepartment,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  defaultPatientId?: string;
  defaultDate: string;
  defaultDepartment?: Department;
}) {
  const router = useRouter();
  const defaultPatient = patients.find((patient) => patient.patientId === defaultPatientId);
  const initialDepartment = defaultPatient?.department === "Physio" || defaultPatient?.department === "Dental"
    ? defaultPatient.department
    : defaultDepartment;
  const [departmentFilter, setDepartmentFilter] = useState<Department | "All">(initialDepartment || "All");
  const [patientText, setPatientText] = useState(
    defaultPatient ? `${defaultPatient.patientId} — ${defaultPatient.fullName}` : ""
  );
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [therapist, setTherapist] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPatient || !date || !time || !therapist || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.patientId,
          date,
          time,
          therapist,
          remarks,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.error === "APPOINTMENT_DUPLICATE") {
          throw new Error("এই রোগীর একই সময়ের appointment আগে থেকেই আছে।");
        }
        if (result.error === "APPOINTMENT_CAPACITY") {
          throw new Error(result.detail || "এই slot-এ treatment capacity খালি নেই।");
        }
        if (result.error === "ACCESS_DENIED") {
          throw new Error("এই Department-এ appointment create permission নেই।");
        }
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      haptic("success");
      router.push(`/appointments?date=${encodeURIComponent(date)}`);
      router.refresh();
    } catch (submitError) {
      haptic("error");
      setError(submitError instanceof Error ? submitError.message : "Appointment failed");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors duration-100 focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

  return (
    <form onSubmit={submit} className="space-y-4">
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

      <label className="block text-xs font-semibold text-slate-700">
        Patient *
        <input
          list="appointment-patients"
          value={patientText}
          onChange={(event) => {
            setPatientText(event.target.value);
            setTherapist("");
          }}
          placeholder="Patient ID বা নাম লিখুন"
          className={inputClass}
        />
        <datalist id="appointment-patients">
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

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-700">
          Date *
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Time *
          <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
        </label>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        {selectedPatient?.department === "Dental" ? "Dentist" : "Therapist"} *
        <select
          required
          value={therapist}
          onChange={(event) => setTherapist(event.target.value)}
          disabled={!selectedPatient}
          className={inputClass}
        >
          <option value="">Select clinician</option>
          {departmentClinicians.map((item) => (
            <option key={item.staffId} value={item.fullName}>{item.fullName}</option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-semibold text-slate-700">
        Remarks
        <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} className={inputClass} />
      </label>

      {selectedPatient?.department === "Physio" && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] leading-4 text-blue-800">
          Room/bed/traction allocation is calculated from the live slot, patient gender and active treatment plan. If gender is missing, the booking is marked Waiting for allocation.
        </div>
      )}

      {error && (
        <p className="relife-error-shake rounded-xl border border-red-200 bg-red-100 px-3 py-2.5 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !selectedPatient || !date || !time || !therapist}
        className="relife-interactive inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Spinner size="sm" className="border-white/40 border-t-white" label="Creating appointment" />}
        {busy ? "Creating appointment…" : "Create appointment"}
      </button>
    </form>
  );
}
