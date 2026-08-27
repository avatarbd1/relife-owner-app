import { redirect } from "next/navigation";
import OwnerSetupWizard from "@/components/OwnerSetupWizard";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export default async function OwnerSetupPage() {
  const { access, tenant } = await requireCurrentTenantAccessContext();
  if (!access.roles.includes("Owner")) redirect("/home");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="px-1 pt-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Clinic Owner setup</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Configure this clinic</h1>
        <p className="mt-1 text-sm leading-5 text-slate-500">
          {tenant.organizationSlug} · {tenant.clinicSlug}. Ordinary clinic differences are saved as tenant configuration, not source-code branches.
        </p>
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-xs leading-5 text-sky-900">
          <strong>Role boundary:</strong> this page uses the selected clinic&apos;s tenant <strong>Clinic Owner</strong> permission. The Relife <strong>Platform Operator</strong> is a separate out-of-band release authority, not a browser role and not the <strong>System Admin</strong> role. Clinic Owner setup cannot assign commercial entitlements, record privileged release evidence, or activate a clinic.
        </div>
      </header>
      <OwnerSetupWizard />
    </div>
  );
}
