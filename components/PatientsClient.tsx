"use client";

import { useMemo, useState } from "react";

type PatientView = {
  patientId: string;
  registrationDate: string;
  fullName: string;
  phone: string;
  age: string;
  gender: string;
  address: string;
  department: "Physio" | "Dental" | "All";
  diagnosis: string;
  therapist: string;
  due: number;
  status: string;
};

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

export default function PatientsClient({ patients }: { patients: PatientView[] }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalized) return patients;
    return patients.filter((patient) =>
      [
        patient.patientId,
        patient.fullName,
        patient.phone,
        patient.diagnosis,
        patient.address,
        patient.therapist,
      ].some((value) => String(value || "").toLowerCase().includes(normalized))
    );
  }, [patients, normalized]);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">Patient search</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          নাম, Patient ID, ফোন, diagnosis বা address দিয়ে খুঁজুন
        </p>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search patients..."
        className="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
      />

      <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
        <span>{filtered.length} result</span>
        {filtered.length > 60 && <span>Latest 60 shown</span>}
      </div>

      <div className="space-y-2">
        {filtered.slice(0, 60).map((patient) => (
          <article
            key={`${patient.department}-${patient.patientId}`}
            className="rounded-xl border border-slate-100 bg-slate-50 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {patient.fullName}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {patient.patientId} · {patient.department}
                  {patient.age ? ` · ${patient.age}y` : ""}
                  {patient.gender ? ` · ${patient.gender}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
                  patient.status.toLowerCase() === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {patient.status || "Active"}
              </span>
            </div>

            {patient.diagnosis && (
              <p className="mt-2 text-xs text-slate-600">{patient.diagnosis}</p>
            )}
            {(patient.phone || patient.address) && (
              <p className="mt-1 text-xs text-slate-400">
                {[patient.phone, patient.address].filter(Boolean).join(" · ")}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
              <span className="text-slate-400">
                Reg: {patient.registrationDate || "-"}
              </span>
              <span className={patient.due > 0 ? "font-semibold text-red-600" : "text-slate-500"}>
                Due {bdt(patient.due)}
              </span>
            </div>
          </article>
        ))}

        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">কোনো রোগী পাওয়া যায়নি।</p>
        )}
      </div>
    </section>
  );
}
