"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  patients: Patient[];
  clinicians: Clinician[];
  defaultPatientId?: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const defaultPatient = patients.find((patient) => patient.patientId === defaultPatientId);
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
      router.push("/appointments");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Appointment failed");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400";

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-xs font-medium text-slate-600">
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
          {patients.map((patient) => (
            <option key={`${patient.department}-${patient.patientId}`} value={`${patient.patientId} — ${patient.fullName}`} />
          ))}
        </datalist>
      </label>

      {selectedPatient && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {selectedPatient.fullName} · {selectedPatient.patientId} · {selectedPatient.department}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          Date *
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Time *
          <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
        </label>
      </div>

      <label className="block text-xs font-medium text-slate-600">
        Clinician *
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

      <label className="block text-xs font-medium text-slate-600">
        Remarks
        <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className={inputClass} />
      </label>

      {selectedPatient?.department === "Physio" && (
        <p className="text-[11px] leading-4 text-slate-400">
          Physio booking-এ Web OS live slot দেখে treatment bed/traction allocation tag তৈরি করবে। Gender না থাকলে Waiting allocation হবে।
        </p>
      )}

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || !selectedPatient || !date || !time || !therapist}
        className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving..." : "Create appointment"}
      </button>
    </form>
  );
}
