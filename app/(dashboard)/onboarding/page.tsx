import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

const steps = [
  ["1", "Business / Organization", "/settings", "Confirm organization ownership and selected clinic."],
  ["2", "Clinic Profile", "/onboarding/setup", "Clinic identity, timezone, currency and operating hours."],
  ["3", "Facility / Resources", "/onboarding/setup", "Rooms, beds, chairs, machines and booking resources."],
  ["4", "Services / Prices", "/onboarding/setup", "Tenant-owned service catalog and pricing."],
  ["5", "Staff / Roles", "/security/staff-access", "Membership, roles and department access."],
  ["6", "Booking Rules", "/onboarding/setup", "Simple, capacity or resource booking configuration."],
  ["7", "Finance", "/finance", "Use the clinic's entitled finance workflows."],
  ["8", "Feature Selection", "/onboarding/setup", "Enable only modules already included in the clinic plan."],
  ["9", "Existing Data Import", "/onboarding/setup", "Map and validate CSV data before any mutation."],
  ["10", "Readiness Validation", "/onboarding/setup", "Run fail-closed tenant, schema and provisioning checks."],
  ["11", "Activation Gate", "/onboarding/setup", "Activation stays privileged and is eligible only after readiness passes."],
] as const;

export default async function OnboardingPage() {
  const { access, tenant } = await requireCurrentTenantAccessContext();
  if (!access.roles.includes("Owner")) redirect("/home");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="px-1 pt-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Owner onboarding</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Clinic activation checklist</h1>
        <p className="mt-1 text-sm leading-5 text-slate-500">
          {tenant.organizationSlug} · {tenant.clinicSlug}. Normal clinic differences are configured as tenant data; no clinic-specific code branch is required.
        </p>
      </header>

      <Link href="/onboarding/setup" className="block rounded-2xl bg-slate-950 px-5 py-4 text-white shadow-sm">
        <span className="block text-base font-bold">Open self-service setup</span>
        <span className="mt-1 block text-sm text-slate-300">Profile, hours, facility, booking, services, features, import validation and readiness in one place →</span>
      </Link>

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

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-950">
        Existing-data import remains validation-only until a separately reviewed canonical mutation executor exists. The browser also never receives service-role credentials or plan-entitlement authority.
      </section>
    </div>
  );
}
