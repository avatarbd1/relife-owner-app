import Link from "next/link";
import { cookies } from "next/headers";
import AppointmentFormMultiDateGate from "@/components/AppointmentBookingGate";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { clinicRuntimeDepartments, resolveClinicRuntimeScope, clinicRuntimeScopes } from "@/lib/domain/tenancy/clinicRuntime";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { getTenantClinicianOptions } from "@/lib/webos/tenantClinicians";
import {
  getPatientForContext,
  getVisiblePatients,
  todayDhaka,
} from "@/lib/webos/reception";

function department(value: string | undefined): "Physio" | "Dental" | undefined {
  if (value === "Physio" || value === "Dental") return value;
  return undefined;
}

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; department?: string }>;
}) {
  const { access: context, tenant } = await requireCurrentTenantAccessContext();
  const [cookieStore, configuration, params] = await Promise.all([
    cookies(),
    readClinicConfiguration(tenant),
    searchParams,
  ]);
  const availableDepartments = clinicRuntimeDepartments(configuration.profile?.clinicType);
  const allowedScopes = clinicRuntimeScopes(context, availableDepartments);
  const scope = resolveClinicRuntimeScope(allowedScopes, cookieStore.get("relife_scope")?.value);
  const { patientId, department: departmentParam } = params;
  const requestedDepartment = department(departmentParam);
  const defaultDepartment = requestedDepartment && availableDepartments.includes(requestedDepartment)
    ? requestedDepartment
    : availableDepartments[0];
  const [visiblePatients, clinicians] = await Promise.all([
    getVisiblePatients(context, scope, tenant.organizationId, tenant.clinicId),
    getTenantClinicianOptions(context, tenant),
  ]);

  let patients = visiblePatients;
  if (patientId && !visiblePatients.some((patient) => patient.patientId === patientId)) {
    const direct = await getPatientForContext(context, patientId, tenant.organizationId, tenant.clinicId).catch(() => null);
    if (direct && direct.department !== "All") patients = [direct, ...visiblePatients];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">Appointments</p>
          <h1 className="mt-0.5 text-xl font-bold text-slate-950">New appointment</h1>
          <p className="mt-1 text-xs text-slate-500">Booking uses only the configured department, patients and staff for this clinic.</p>
        </div>
        <Link href="/appointments" className="relife-interactive rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600">
          Back
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <AppointmentFormMultiDateGate
          patients={patients}
          clinicians={clinicians}
          modalityOptions={[]}
          availableDepartments={availableDepartments}
          defaultPatientId={patientId}
          startDate={todayDhaka()}
          defaultDepartment={defaultDepartment}
        />
      </section>
    </div>
  );
}
