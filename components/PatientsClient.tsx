"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PatientDepartment = "Physio" | "Dental" | "All";
type FilterDepartment = "All" | "Physio" | "Dental";
type SortMode = "recent" | "name" | "due";

type PatientView = {
  patientId: string;
  registrationDate: string;
  fullName: string;
  phone: string;
  age: string;
  gender: string;
  address: string;
  department: PatientDepartment;
  diagnosis: string;
  therapist: string;
  due: number;
  status: string;
};

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

function departmentBadge(department: PatientDepartment) {
  if (department === "Dental") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (department === "Physio") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

export default function PatientsClient({
  patients,
  showMoney = true,
  paymentDepartments = [],
  appointmentDepartments = [],
}: {
  patients: PatientView[];
  showMoney?: boolean;
  paymentDepartments?: Array<"Physio" | "Dental">;
  appointmentDepartments?: Array<"Physio" | "Dental">;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<FilterDepartment>("All");
  const [sort, setSort] = useState<SortMode>("recent");
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const result = patients.filter((patient) => {
      if (department !== "All" && patient.department !== department) return false;
      if (!normalized) return true;
      return [patient.patientId, patient.fullName, patient.phone, patient.diagnosis, patient.address, patient.therapist]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
    });
    return [...result].sort((a, b) => {
      if (sort === "name") return a.fullName.localeCompare(b.fullName);
      if (sort === "due") return b.due - a.due || a.fullName.localeCompare(b.fullName);
      return b.registrationDate.localeCompare(a.registrationDate) || a.fullName.localeCompare(b.fullName);
    });
  }, [patients, normalized, department, sort]);

  const counts = useMemo(() => ({
    all: patients.length,
    physio: patients.filter((patient) => patient.department === "Physio").length,
    dental: patients.filter((patient) => patient.department === "Dental").length,
  }), [patients]);

  const filters: Array<{ id: FilterDepartment; label: string; count: number }> = [
    { id: "All", label: "All", count: counts.all },
    { id: "Physio", label: "Physio", count: counts.physio },
    { id: "Dental", label: "Dental", count: counts.dental },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <label htmlFor="patient-search" className="text-xs font-semibold text-slate-700">Find patient</label>
        <input id="patient-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ID, phone, diagnosis or address" className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-blue-700 focus:bg-white focus:ring-2 focus:ring-blue-100" />

        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1" data-horizontal-scroll>
          {filters.map((item) => (
            <button key={item.id} type="button" onClick={() => setDepartment(item.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ring-1 transition ${department === item.id ? "bg-blue-800 text-white ring-blue-800" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}>
              {item.label} · {item.count}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="Sort patients" className="min-h-10 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 outline-none focus:border-blue-700">
            <option value="recent">Newest registered</option>
            <option value="name">Name A–Z</option>
            {showMoney && <option value="due">Highest due</option>}
          </select>
        </div>
      </div>

      <div className="border-t border-slate-100">
        {filtered.slice(0, 60).map((patient) => {
          const canPay = patient.department !== "All" && paymentDepartments.includes(patient.department);
          const canBook = patient.department !== "All" && appointmentDepartments.includes(patient.department);
          return (
            <article key={`${patient.department}-${patient.patientId}`} className="border-b border-slate-100 p-4 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-950">{patient.fullName}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${departmentBadge(patient.department)}`}>{patient.department}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">ID {patient.patientId}{patient.age ? ` · ${patient.age}y` : ""}{patient.gender ? ` · ${patient.gender}` : ""}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${patient.status.toLowerCase() === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{patient.status || "Active"}</span>
              </div>

              {patient.diagnosis && <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{patient.diagnosis}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {patient.phone && <span>{patient.phone}</span>}
                {patient.therapist && <span>{patient.therapist}</span>}
                <span>Registered {patient.registrationDate || "—"}</span>
              </div>

              {showMoney && <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${patient.due > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{patient.due > 0 ? `Pending due ${bdt(patient.due)}` : "Paid up"}</div>}

              <div className={`mt-3 grid gap-2 ${canPay || canBook ? "grid-cols-3" : "grid-cols-1"}`}>
                <Link href={`/patients/${encodeURIComponent(patient.patientId)}`} className="flex min-h-11 items-center justify-center rounded-lg bg-blue-800 px-3 py-2 text-center text-xs font-semibold text-white">View file</Link>
                {canPay && <Link href={`/payments?patientId=${encodeURIComponent(patient.patientId)}`} className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200">Payment</Link>}
                {canBook && <Link href={`/appointments/new?patientId=${encodeURIComponent(patient.patientId)}`} className="flex min-h-11 items-center justify-center rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200">Appointment</Link>}
              </div>
            </article>
          );
        })}

        {filtered.length === 0 && <div className="px-4 py-10 text-center"><p className="text-sm font-semibold text-slate-700">No patient found</p><p className="mt-1 text-xs text-slate-400">Search term বা department filter পরিবর্তন করুন।</p></div>}
        {filtered.length > 60 && <p className="border-t border-slate-100 px-4 py-3 text-center text-[11px] text-slate-400">First 60 results shown · refine search to narrow the list</p>}
      </div>
    </section>
  );
}
