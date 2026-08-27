import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

const steps = [
  ["1", "Business / Organization", "/settings", "Confirm organization ownership and selected clinic."],
  ["2", "Clinic Profile", "/settings", "Clinic identity, timezone, currency and operating hours."],
  ["3", "Facility / Resources", "/settings", "Rooms, beds, chairs, machines and booking resources."],
  ["4", "Services / Prices", "/settings", "Tenant-owned service catalog and pricing."],
  ["5", "Staff / Roles", "/security/staff-access", "Membership, roles and department access."],
  ["6", "Booking Rules", "/settings", "Simple, capacity or resource booking configuration."],
  ["7", "Finance", "/finance", "Basic finance entitlement and configured workflows."],
  ["8", "Feature Selection", "/settings", "Enable only purchased/configured modules."],
  ["9", "Existing Data Import", "/onboarding#import", "Validate CSV mappings before any mutation."],
  ["10", "Readiness Validation", "/onboarding#readiness", "Fail-closed activation evidence across tenant, schema and provisioning checks."],
  ["11", "Activate Clinic", "/onboarding#activation", "Activation remains blocked until every required readiness check is PASS."],
] as const;

export default async function OnboardingPage() {
  const { access, tenant } = await requireCurrentTenantAccessContext();
  if (!access.roles.includes("Owner")) redirect("/home");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="px-1 pt-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Phase F · Onboarding</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Clinic activation checklist</h1>
        <p className="mt-1 text-sm leading-5 text-slate-500">
          {tenant.organizationSlug} · {tenant.clinicSlug}. Configuration stays tenant-scoped; activation fails closed until readiness evidence is complete.
        </p>
      </header>

      <ol className="space-y-3">
        {steps.map(([number, title, href, description]) => (
          <li key={number} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">{number}</span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-950">{title}</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
                <Link href={href} className="mt-2 inline-block text-sm font-semibold text-slate-900 underline underline-offset-4">Open step</Link>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section id="import" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Import preview is validation-only. It validates every row and performs no mutation. A canonical mutation executor must be separately reviewed before imported records can be committed.
      </section>
      <section id="readiness" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Readiness endpoint: <code>POST /api/setup/clinic-validation</code>. Missing runtime or database evidence remains UNVERIFIED, never PASS.
      </section>
      <section id="activation" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Provisioning dry-run: <code>GET /api/onboarding/provisioning-dry-run</code>. Phase F does not activate a real Clinic #2; that proof belongs to Phase G.
      </section>
    </div>
  );
}
