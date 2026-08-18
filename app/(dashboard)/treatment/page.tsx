import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { StatusBadge } from "@/components/FeedbackUI";
import { getAppointmentsForToday } from "@/lib/data";
import type { Department } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import {
  getTodaysTreatments,
  getRecentTreatments,
  getCaseStudies,
} from "@/app/(dashboard)/treatment/actions";

function inScope(scope: string, department: Department): department is "Physio" | "Dental" {
  if (department !== "Physio" && department !== "Dental") return false;
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

async function TodaysSessions({ departments }: { departments: ("Physio" | "Dental")[] }) {
  const appointments = await getAppointmentsForToday();
  const todayAppointments = appointments.filter(
    (a) =>
      departments.includes(a.department as "Physio" | "Dental") &&
      a.status !== "Cancelled"
  );

  if (todayAppointments.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
        No appointments scheduled for today
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {todayAppointments.slice(0, 10).map((appt) => (
        <Link
          key={appt.id}
          href={`/treatment/record?appointmentId=${appt.id}`}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-blue-400 hover:bg-blue-50"
        >
          <div>
            <p className="text-sm font-medium text-slate-900">{appt.patientName}</p>
            <p className="text-xs text-slate-500">
              {appt.appointmentType} • {new Date(appt.appointmentTime).toLocaleTimeString("en-BD", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <span className="text-blue-600">→</span>
        </Link>
      ))}
    </div>
  );
}

async function RecentTreatments({ departments }: { departments: ("Physio" | "Dental")[] }) {
  const treatments = await getRecentTreatments(
    departments.includes("Physio") ? "Physio" : "Dental",
    10
  );

  if (!treatments || treatments.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
        No treatments recorded yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {treatments.map((treatment: any) => (
        <div key={treatment.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <p className="text-sm font-medium text-slate-900">{treatment.patientName}</p>
            <p className="text-xs text-slate-500">
              {treatment.templateType} • {treatment.duration}m
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded ${
            treatment.outcome === "Improved"
              ? "bg-emerald-100 text-emerald-700"
              : treatment.outcome === "Stable"
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700"
          }`}>
            {treatment.outcome}
          </span>
        </div>
      ))}
    </div>
  );
}

async function CaseStudiesThisMonth({ departments }: { departments: ("Physio" | "Dental")[] }) {
  const caseStudies = await getCaseStudies(
    departments.includes("Physio") ? "Physio" : "Dental",
    5
  );

  if (!caseStudies || caseStudies.length === 0) {
    return (
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-center text-sm text-purple-600">
        No case studies published this month
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {caseStudies.map((cs: any) => (
        <div key={cs.id} className="rounded-lg border border-purple-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-900">{cs.title}</p>
          <p className="text-xs text-slate-500">{cs.templateType}</p>
        </div>
      ))}
    </div>
  );
}

export default async function TreatmentPage() {
  const [context, cookieStore] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
  ]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const readableDepartments = (["Physio", "Dental"] as const).filter(
    (department) =>
      inScope(scope, department) && canPerform(context, "treatment.read", department)
  );
  const canRecord = (["Physio", "Dental"] as const).some(
    (department) =>
      inScope(scope, department) && canPerform(context, "treatment.record", department)
  );

  if (readableDepartments.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        এই account-এর জন্য treatment ledger access দেওয়া নেই।
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-blue-950 to-indigo-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Clinical</p>
            <h1 className="mt-1 text-2xl font-bold">Treatment Entry</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              Record treatment details, upload photos, generate case studies, and leverage AI suggestions for clinical assessments.
            </p>
          </div>
          <StatusBadge tone={canRecord ? "success" : "neutral"} className="border-white/10">
            {canRecord ? "Can record" : "Read only"}
          </StatusBadge>
        </div>

        {canRecord && (
          <div className="mt-4">
            <Link
              href="/treatment/record"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-400 px-4 py-2.5 text-sm font-semibold text-blue-950 hover:bg-blue-300"
            >
              ✍️ Start New Treatment
            </Link>
          </div>
        )}
      </section>

      {/* Today's Sessions */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Today's Appointments</h2>
          <p className="text-xs text-slate-600">Click to record treatment for each patient</p>
        </div>
        <Suspense
          fallback={
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
              Loading appointments...
            </div>
          }
        >
          <TodaysSessions departments={readableDepartments} />
        </Suspense>
      </section>

      {/* Recent Treatments & Case Studies */}
      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Recent Treatments</h2>
            <p className="text-xs text-slate-600">Last 10 recorded treatments</p>
          </div>
          <Suspense
            fallback={
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
                Loading treatments...
              </div>
            }
          >
            <RecentTreatments departments={readableDepartments} />
          </Suspense>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Case Studies</h2>
            <p className="text-xs text-slate-600">Published this month</p>
          </div>
          <Suspense
            fallback={
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-center text-sm text-purple-600">
                Loading case studies...
              </div>
            }
          >
            <CaseStudiesThisMonth departments={readableDepartments} />
          </Suspense>
        </section>
      </div>

      {/* Quick Links */}
      <section className="grid gap-3 md:grid-cols-3">
        <Link
          href="/patients"
          className="rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-slate-900">👥 Patient Registry</p>
          <p className="text-xs text-slate-500">View patient history</p>
        </Link>
        <Link
          href="/appointments"
          className="rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-slate-900">📅 Appointments</p>
          <p className="text-xs text-slate-500">Manage appointments</p>
        </Link>
        <Link
          href="/inventory"
          className="rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-slate-900">📦 Inventory</p>
          <p className="text-xs text-slate-500">Check equipment stock</p>
        </Link>
      </section>
    </div>
  );
}
