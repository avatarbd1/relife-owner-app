"use client";

import { useMemo, useState } from "react";
import AppointmentCapacityForm from "@/components/AppointmentCapacityForm";
import AppointmentFormGenderBed from "@/components/AppointmentFormGenderBed";
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

function normalizedGender(value: string | undefined): "Male" | "Female" | "" {
  const text = String(value || "").trim().toLowerCase();
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

export default function AppointmentBookingGate({
  patients,
  clinicians,
  modalityOptions,
  availableDepartments,
  defaultPatientId,
  startDate,
  defaultDepartment,
}: {
  patients: Patient[];
  clinicians: Clinician[];
  modalityOptions: ModalityOption[];
  availableDepartments: Department[];
  defaultPatientId?: string;
  startDate: string;
  defaultDepartment?: Department;
}) {
  const defaultPatient = patients.find((item) => item.patientId === defaultPatientId);
  const initialDepartment: Department =
    defaultPatient?.department !== "All" && defaultPatient?.department && availableDepartments.includes(defaultPatient.department)
      ? defaultPatient.department
      : defaultDepartment && availableDepartments.includes(defaultDepartment)
        ? defaultDepartment
        : availableDepartments[0] || "Physio";
  const [department, setDepartment] = useState<Department>(initialDepartment);
  const [patientId, setPatientId] = useState(defaultPatient?.patientId || "");
  const [genderOverrides, setGenderOverrides] = useState<Record<string, "Male" | "Female">>({});
  const [genderBusy, setGenderBusy] = useState(false);
  const [error, setError] = useState("");

  const visiblePatients = useMemo(
    () => patients.filter((item) => item.department === department),
    [department, patients]
  );
  const selectedPatient = patients.find((item) => item.patientId === patientId && item.department === department);
  const selectedGender = selectedPatient
    ? genderOverrides[selectedPatient.patientId] || normalizedGender(selectedPatient.gender)
    : "";

  function chooseDepartment(next: Department) {
    if (!availableDepartments.includes(next)) return;
    setDepartment(next);
    setPatientId("");
    setError("");
    haptic("tap");
  }

  async function saveGender(gender: "Male" | "Female") {
    if (!selectedPatient || selectedPatient.department !== "Physio" || genderBusy) return;
    setGenderBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(selectedPatient.patientId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gender }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Gender update failed");
      setGenderOverrides((current) => ({ ...current, [selectedPatient.patientId]: gender }));
      haptic("success");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Gender update failed");
      haptic("error");
    } finally {
      setGenderBusy(false);
    }
  }

  if (!selectedPatient) {
    return (
      <div className="space-y-4">
        {availableDepartments.length > 1 ? (
          <div>
            <p className="text-xs font-semibold text-slate-700">Department</p>
            <div className="mt-2 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              {availableDepartments.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => chooseDepartment(item)}
                  className={`rounded-lg px-3 py-3 text-sm font-semibold ${department === item ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
            Department: {department}
          </div>
        )}

        <label className="block">
          <span className="text-xs font-semibold text-slate-700">Patient *</span>
          <select
            value={patientId}
            onChange={(event) => {
              setPatientId(event.target.value);
              setError("");
            }}
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
          >
            <option value="">Patient select করুন</option>
            {visiblePatients.map((patient) => (
              <option key={patient.patientId} value={patient.patientId}>
                {patient.patientId} — {patient.fullName}
              </option>
            ))}
          </select>
        </label>

        {department === "Physio" ? (
          <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Physio booking শুধু gender-safe hourly capacity check করবে। Bed, machine ও treatment sequence patient arrive করার পর Live Chamber handle করবে।
          </p>
        ) : null}
        {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}
      </div>
    );
  }

  if (selectedPatient.department === "Physio" && !selectedGender) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500">Selected patient</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{selectedPatient.patientId} — {selectedPatient.fullName}</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-950">Gender missing</p>
          <p className="mt-1 text-xs text-amber-800">Physio capacity gender-wise চলে। Gender একবার set করলে booking flow খুলবে।</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={genderBusy}
              onClick={() => void saveGender("Male")}
              className="min-h-12 rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-slate-900 disabled:opacity-50"
            >
              Male
            </button>
            <button
              type="button"
              disabled={genderBusy}
              onClick={() => void saveGender("Female")}
              className="min-h-12 rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-slate-900 disabled:opacity-50"
            >
              Female
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPatientId("")}
          className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600"
        >
          Change patient
        </button>
        {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}
      </div>
    );
  }

  const gatedPatient: Patient = {
    ...selectedPatient,
    gender: selectedGender || selectedPatient.gender,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Booking patient</p>
          <p className="text-sm font-bold text-slate-900">{gatedPatient.patientId} — {gatedPatient.fullName}</p>
          {gatedPatient.department === "Physio" ? (
            <p className="text-xs text-slate-500">Gender: {selectedGender} · 60 ± 5 min · no fixed bed/machine</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setPatientId("")}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
        >
          Change
        </button>
      </div>

      {gatedPatient.department === "Physio" ? (
        <AppointmentCapacityForm patient={gatedPatient} clinicians={clinicians} startDate={startDate} />
      ) : (
        <AppointmentFormGenderBed
          patients={[gatedPatient]}
          clinicians={clinicians}
          modalityOptions={modalityOptions}
          defaultPatientId={gatedPatient.patientId}
          startDate={startDate}
          defaultDepartment="Dental"
        />
      )}
    </div>
  );
}
