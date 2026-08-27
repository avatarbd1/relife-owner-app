import { redirect } from "next/navigation";
import OwnerSetupWizard from "@/components/OwnerSetupWizard";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export default async function OwnerSetupPage() {
  const { access, tenant } = await requireCurrentTenantAccessContext();
  if (!access.roles.includes("Owner")) redirect("/home");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="px-1 pt-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Owner setup</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Configure this clinic</h1>
        <p className="mt-1 text-sm leading-5 text-slate-500">
          {tenant.organizationSlug} · {tenant.clinicSlug}. Ordinary clinic differences are saved as tenant configuration, not source-code branches.
        </p>
      </header>
      <OwnerSetupWizard />
    </div>
  );
}
