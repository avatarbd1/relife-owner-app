"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import TapChoice from "@/components/TapChoice";
import {
  searchPatients,
  type PatientSearchDepartment,
  type PatientSearchSort,
  type PatientSearchStatus,
} from "@/lib/domain/patients/search";

type PatientDepartment = "Physio" | "Dental" | "All";

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

const PAGE_SIZE = 30;

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
  const [department, setDepartment] = useState<PatientSearchDepartment>("All");
  const [status, setStatus] = useState<PatientSearchStatus>("All");
  const [sort, setSort] = useState<PatientSearchSort>("recent");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const hasQuery = Boolean(query.trim());

  const matches = useMemo(
    () => searchPatients(patients, { query, department, status, sort }),
    [patients, query, department, status, sort]
  );

  const counts = useMemo(
    () => ({
      all: patients.length,
      physio: patients.filter((patient) => patient.department === "Physio").length,
      dental: patients.filter((patient) => patient.department === "Dental").length,
    }),
    [patients]
  );

  const departmentPatients = useMemo(
    () => patients.filter((patient) => department === "All" || patient.department === department),
    [patients, department]
  );

  const statusCounts = useMemo(() => {
    const active = departmentPatients.filter(
      (patient) => String(patient.status || "Active").trim().toLowerCase() === "active"
    ).length;
    return {
      all: departmentPatients.length,
      active,
      inactive: departmentPatients.length - active,
    };
  }, [departmentPatients]);

  const departmentFilters: Array<{ id: PatientSearchDepartment; label: string; count: number }> = [
    { id: "All", label: "All", count: counts.all },
    { id: "Physio", label: "Physio", count: counts.physio },
    { id: "Dental", label: "Dental", count: counts.dental },
  ];

  const statusFilters: Array<{ id: PatientSearchStatus; label: string; count: number }> = [
    { id: "All", label: "Any status", count: statusCounts.all },
    { id: "Active", label: "Active", count: statusCounts.active },
    { id: "Inactive", label: "Inactive", count: statusCounts.inactive },
  ];

  const sortOptions: Array<{ value: PatientSearchSort; label: string }> = [
    { value: "recent", label: "Newest" },
    { value: "name", label: "Name A–Z" },
    ...(showMoney ? [{ value: "due" as const, label: "Highest due" }] : []),
  ];

  const visibleMatches = matches.slice(0, visibleCount);

  function changeQuery(value: string) {
    setQuery(value);
    setVisibleCount(PAGE_SIZE);
  }

  function changeDepartment(value: PatientSearchDepartment) {
    setDepartment(value);
    setVisibleCount(PAGE_SIZE);
  }

  function changeStatus(value: PatientSearchStatus) {
    setStatus(value);
    setVisibleCount(PAGE_SIZE);
  }

  function changeSort(value: PatientSearchSort) {
    setSort(value);
    setVisibleCount(PAGE_SIZE);
  }

  function resetSearch() {
    setQuery("");
    setDepartment("All");
    setStatus("All");
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <label htmlFor="patient-search" className="text-xs font-semibold text-slate-800">
              Find patient fast
            </label>
            <p className="mt-0.5 text-[10px] text-slate-400">
              ID, name or phone first · বাংলা/English digits both work
            </p>
          </div>
          {hasQuery ? (
            <button
              type="button"
              onClick={() => changeQuery("")}
              className="min-h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600"
            >
              Clear
            </button>
          ) : null}
        </div>

        <input
          id="patient-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="e.g. PT-103, ১০৩, Rahim, 01712…"
          className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Department</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1" data-horizontal-scroll>
            {departmentFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => changeDepartment(item.id)}
                className={`min-h-10 shrink-0 rounded-full px-3 text-xs font-semibold ring-1 transition ${
                  department === item.id
                    ? "bg-blue-800 text-white ring-blue-800"
                    : "bg-white text-slate-600 ring-slate-200"
                }`}
              >
                {item.label} · {item.count}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1" data-horizontal-scroll>
            {statusFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => changeStatus(item.id)}
                className={`min-h-10 shrink-0 rounded-full px-3 text-xs font-semibold ring-1 transition ${
                  status === item.id
                    ? "bg-slate-900 text-white ring-slate-900"
                    : "bg-white text-slate-600 ring-slate-200"
                }`}
              >
                {item.label} · {item.count}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-700">
                {matches.length} result{matches.length === 1 ? "" : "s"}
              </span>
              {hasQuery ? <span className="ml-2 text-[10px] text-blue-700">best first</span> : null}
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Sort</span>
          </div>
          <TapChoice
            value={sort}
            options={sortOptions}
            columns={sortOptions.length === 3 ? 3 : 2}
            compact
            onChange={(value) => value && changeSort(value)}
          />
        </div>
      </div>

      <div className="border-t border-slate-100">
        {visibleMatches.map((match, index) => {
          const patient = match.patient;
          const canPay = patient.department !== "All" && paymentDepartments.includes(patient.department);
          const canBook = patient.department !== "All" && appointmentDepartments.includes(patient.department);
          const bestMatch = hasQuery && index === 0 && match.score >= 800;
          return (
            <article
              key={`${patient.department}-${patient.patientId}`}
              className={`border-b border-slate-100 p-4 last:border-b-0 ${bestMatch ? "bg-blue-50/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-950">{patient.fullName}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${departmentBadge(patient.department)}`}>
                      {patient.department}
                    </span>
                    {hasQuery && match.matchedBy ? (
                      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-100">
                        {bestMatch ? "Best · " : ""}{match.matchedBy}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-slate-600">
                    ID {patient.patientId}{patient.age ? ` · ${patient.age}y` : ""}{patient.gender ? ` · ${patient.gender}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  patient.status.toLowerCase() === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                }`}>
                  {patient.status || "Active"}
                </span>
              </div>

              {patient.diagnosis ? (
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{patient.diagnosis}</p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {patient.phone ? <span>{patient.phone}</span> : null}
                {patient.therapist ? <span>{patient.therapist}</span> : null}
                {patient.address ? <span className="line-clamp-1">{patient.address}</span> : null}
                <span>Registered {patient.registrationDate || "—"}</span>
              </div>

              {showMoney ? (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${
                  patient.due > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                }`}>
                  {patient.due > 0 ? `Pending due ${bdt(patient.due)}` : "Paid up"}
                </div>
              ) : null}

              <div className="mt-3 space-y-2">
                <Link
                  href={`/patients/${encodeURIComponent(patient.patientId)}`}
                  className="flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-800 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.99]"
                >
                  View patient file
                </Link>
                {canPay || canBook ? (
                  <div className={`grid gap-2 ${canPay && canBook ? "grid-cols-2" : "grid-cols-1"}`}>
                    {canPay ? (
                      <Link
                        href={`/payments?patientId=${encodeURIComponent(patient.patientId)}`}
                        className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700"
                      >
                        Payment
                      </Link>
                    ) : null}
                    {canBook ? (
                      <Link
                        href={`/appointments/new?patientId=${encodeURIComponent(patient.patientId)}`}
                        className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700"
                      >
                        Appointment
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}

        {matches.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-slate-700">No patient found</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              ID/name/phone check করুন বা department/status filter reset করুন।
            </p>
            {hasQuery || department !== "All" || status !== "All" ? (
              <button
                type="button"
                onClick={resetSearch}
                className="mt-3 min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600"
              >
                Reset search
              </button>
            ) : null}
          </div>
        ) : null}

        {visibleCount < matches.length ? (
          <div className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-700"
            >
              Load more · {matches.length - visibleCount} remaining
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
