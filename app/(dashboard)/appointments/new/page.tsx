import Link from "next/link";
import { cookies } from "next/headers";
import AppointmentForm from "@/components/AppointmentForm";
import type { Scope } from "@/lib/types";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  getClinicianOptions,
  getPatientForContext,
  getVisiblePatients,
  todayDhaka,
} from "@/lib/webos/reception";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const { patientId } = await searchParams;
  const [visiblePatients, clinicians] = await Promise.all([
    getVisiblePatients(context, scope),
    getClinicianOptions(context),
  ]);

  let patients = visiblePatients;
  if (patientId && !visiblePatients.some((patient) => patient.patientId === patientId)) {
    const direct = await getPatientForContext(context, patientId).catch(() => null);
    if (direct && direct.department !== "All") patients = [direct, ...visiblePatients];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">W2 · Reception</p>
          <h2 className="text-lg font-semibold text-slate-900">নতুন Appointment</h2>
        </div>
        <Link href="/appointments" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
          Back
        </Link>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <AppointmentForm
          patients={patients}
          clinicians={clinicians}
          defaultPatientId={patientId}
          defaultDate={todayDhaka()}
        />
      </section>
    </div>
  );
}
