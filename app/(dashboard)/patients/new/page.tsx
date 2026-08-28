import Link from "next/link";
import { cookies } from "next/headers";
import PatientRegistrationForm from "@/components/PatientRegistrationForm";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import {
  getTenantClinicianOptions,
  getTenantPatientCreateDepartments,
} from "@/lib/webos/tenantClinicRoster";

export default async function NewPatientPage() {
  const { access: context, tenant } = await requireCurrentTenantAccessContext();
  const cookieStore = await cookies();
  const scope = cookieStore.get("relife_scope")?.value;
  const [allowedDepartments, clinicians] = await Promise.all([
    getTenantPatientCreateDepartments(context, tenant),
    getTenantClinicianOptions(context, tenant),
  ]);
  const defaultDepartment =
    scope === "dental" ? "Dental" : scope === "physio" ? "Physio" : undefined;

  return (
    <div className="space-y-4" data-unsaved-changes="true">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">W2 · Reception</p>
          <h2 className="text-lg font-semibold text-slate-900">নতুন রোগী রেজিস্ট্রেশন</h2>
        </div>
        <Link href="/patients" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
          Back
        </Link>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <PatientRegistrationForm
          allowedDepartments={allowedDepartments}
          clinicians={clinicians}
          defaultDepartment={defaultDepartment}
        />
      </section>
    </div>
  );
}
