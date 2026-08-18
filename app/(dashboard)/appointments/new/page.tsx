import Link from "next/link";
import { cookies } from "next/headers";
import AppointmentFormMultiDate from "@/components/AppointmentFormMultiDate";
import type { Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { getBookingModalityOptions } from "@/lib/webos/appointmentScheduling";
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

function department(value: string | undefined): "Physio" | "Dental" | undefined {
  if (value === "Physio" || value === "Dental") return value;
  return undefined;
}

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; department?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const { patientId, department: departmentParam } = await searchParams;
  const defaultDepartment = department(departmentParam);
  const [visiblePatients, clinicians, modalityOptions] = await Promise.all([
    getVisiblePatients(context, scope),
    getClinicianOptions(context),
    canPerform(context, "appointment.create", "Physio")
      ? getBookingModalityOptions(context)
      : Promise.resolve([]),
  ]);

  let patients = visiblePatients;
  if (patientId && !visiblePatients.some((patient) => patient.patientId === patientId)) {
    const direct = await getPatientForContext(context, patientId).catch(() => null);
    if (direct && direct.department !== "All") patients = [direct, ...visiblePatients];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">Appointments</p>
          <h1 className="mt-0.5 text-xl font-bold text-slate-950">New appointment</h1>
          <p className="mt-1 text-xs text-slate-500">Patient → clinician → multiple dates/times → safe bed & machine validation</p>
        </div>
        <Link href="/appointments" className="relife-interactive rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600">
          Back
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <AppointmentFormMultiDate
          patients={patients}
          clinicians={clinicians}
          modalityOptions={modalityOptions}
          defaultPatientId={patientId}
          startDate={todayDhaka()}
          defaultDepartment={defaultDepartment}
        />
      </section>
    </div>
  );
}
