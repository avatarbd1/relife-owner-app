import Link from "next/link";
import { StatusBadge } from "@/components/FeedbackUI";
import { formatBDT } from "@/lib/format";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { getDailyRegisterSnapshot } from "@/lib/webos/dailyRegister";

export default async function DentalToolsPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const [tenantContext, params] = await Promise.all([
    requireCurrentTenantAccessContext(),
    searchParams ? searchParams : Promise.resolve({} as { date?: string }),
  ]);
  const { access, tenant } = tenantContext;
  const hasDentalAccess = access.departmentAccess.includes("Dental") || access.departmentAccess.includes("All");
  if (!hasDentalAccess) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Dental access is not available for this account.</div>;
  }

  const register = await getDailyRegisterSnapshot(access, "dental", tenant.clinicId, params.date);
  const canReadPatients = canPerform(access, "patient.read", "Dental");
  const canReadClinical = canPerform(access, "clinical.read", "Dental");
  const canBook = canPerform(access, "appointment.create", "Dental");
  const canTakePayment = canPerform(access, "payment.create", "Dental");
  const canReadFinance = canPerform(access, "report.read_financial", "Dental");

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-emerald-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200">Dental operations</p>
            <h1 className="mt-1 text-2xl font-bold">Dental tools</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Role-aware shortcuts and Dental daily register snapshot.</p>
          </div>
          <Link href="/tools" className="flex min-h-10 items-center rounded-lg bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/15">All tools</Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canReadPatients && <Link href="/patients" className="rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold">Patients</Link>}
          {canBook && <Link href="/appointments/new" className="rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold">New appointment</Link>}
          {canTakePayment && <Link href="/payments" className="rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold">Payment</Link>}
          {canReadClinical && <Link href="/patients" className="rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold">Clinical files</Link>}
          {canReadFinance && <Link href="/reports" className="rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold">Reports</Link>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-slate-900">Dental daily register</h2><p className="mt-0.5 text-xs text-slate-500">{register.date} · payment-backed entries</p></div>
          <StatusBadge tone="success">{register.rows.length}</StatusBadge>
        </div>
        <div className={`mt-3 grid gap-2 ${register.hasMoneyAccess ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-900">{register.totals.entries}</p><p className="text-[10px] text-slate-500">Entries</p></div>
          <div className="rounded-lg bg-emerald-50 p-3"><p className="text-lg font-bold text-emerald-900">{register.totals.sessions}</p><p className="text-[10px] text-emerald-700">Sessions / procedures</p></div>
          {register.hasMoneyAccess && <div className="rounded-lg bg-blue-50 p-3"><p className="text-lg font-bold text-blue-900">{formatBDT(register.totals.amount)}</p><p className="text-[10px] text-blue-700">Collected</p></div>}
        </div>
        <div className="mt-3 space-y-2">
          {register.rows.slice(0, 20).map((row) => (
            <Link key={row.receiptNo} href={`/patients/${encodeURIComponent(row.patientId)}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 hover:bg-slate-100">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.patientName || row.patientId}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.receiptNo}{row.service ? ` · ${row.service}` : ""}</p></div>
              <div className="shrink-0 text-right">{row.moneyVisible && <p className="text-sm font-bold text-emerald-700">{formatBDT(row.amount)}</p>}<p className="mt-0.5 text-[10px] text-slate-500">{row.status}</p></div>
            </Link>
          ))}
          {register.rows.length === 0 && <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">No Dental register entries for this date.</p>}
        </div>
      </section>
    </div>
  );
}
