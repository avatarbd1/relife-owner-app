import Link from "next/link";
import { cookies } from "next/headers";
import { StatusBadge } from "@/components/FeedbackUI";
import { formatBDT } from "@/lib/format";
import type { Scope } from "@/lib/types";
import { getDailyRegisterSnapshot } from "@/lib/webos/dailyRegister";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function statusTone(status: string): "success" | "warning" | "error" | "info" {
  if (status === "Paid") return "success";
  if (status === "Partial") return "warning";
  if (status === "Due") return "error";
  return "info";
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const [context, cookieStore, params] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
    searchParams ? searchParams : Promise.resolve({} as { date?: string }),
  ]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const snapshot = await getDailyRegisterSnapshot(context, scope, params.date);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Operations</p><h1 className="mt-1 text-2xl font-bold">Daily register</h1><p className="mt-1 text-xs leading-5 text-slate-300">{SCOPE_LABEL[scope]} · payment-backed register · {snapshot.date}</p></div>
          <Link href="/more" className="min-h-10 shrink-0 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">More</Link>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <form method="get" className="flex gap-2">
          <input type="date" name="date" defaultValue={snapshot.date} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" />
          <button className="min-h-11 rounded-lg bg-blue-800 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-900">View</button>
        </form>
        <div className={`mt-4 grid gap-2 ${snapshot.hasMoneyAccess ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
          <Metric label="Entries" value={String(snapshot.totals.entries)} tone="default" />
          <Metric label="Sessions" value={String(snapshot.totals.sessions)} tone="info" />
          {snapshot.hasMoneyAccess && <><Metric label="Collected" value={formatBDT(snapshot.totals.amount)} tone="success" /><Metric label="Due snapshot" value={formatBDT(snapshot.totals.due)} tone={snapshot.totals.due > 0 ? "error" : "success"} /></>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold text-slate-950">Register entries</h2><p className="mt-0.5 text-xs text-slate-500">{snapshot.departments.join(" + ") || "No permitted department"}</p></div>
          <StatusBadge tone="neutral">{snapshot.rows.length}</StatusBadge>
        </div>
        <div className="mt-3 space-y-2">
          {snapshot.rows.map((row) => (
            <Link key={`${row.department}-${row.receiptNo}`} href={`/patients/${encodeURIComponent(row.patientId)}`} className="block rounded-lg border border-slate-100 bg-slate-50 p-3 transition hover:bg-slate-100">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.sl ? `${row.sl}. ` : ""}{row.patientName || row.patientId}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.receiptNo} · {row.department}{row.sessions ? ` · ${row.sessions} session${row.sessions === 1 ? "" : "s"}` : ""}{row.service ? ` · ${row.service}` : ""}</p></div>
                <div className="flex shrink-0 flex-col items-end gap-1.5"><StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge><StatusBadge tone={row.department === "Dental" ? "success" : "info"}>{row.department}</StatusBadge></div>
              </div>
              {row.moneyVisible && <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-md bg-emerald-50 p-2"><p className="text-[9px] text-emerald-700">Paid</p><p className="mt-0.5 text-[11px] font-bold tabular-nums text-emerald-900">{formatBDT(row.amount)}</p></div><div className="rounded-md bg-slate-100 p-2"><p className="text-[9px] text-slate-500">Discount</p><p className="mt-0.5 text-[11px] font-bold tabular-nums text-slate-800">{formatBDT(row.discount)}</p></div><div className={`rounded-md p-2 ${row.due > 0 ? "bg-red-50" : "bg-emerald-50"}`}><p className={`text-[9px] ${row.due > 0 ? "text-red-700" : "text-emerald-700"}`}>Due</p><p className={`mt-0.5 text-[11px] font-bold tabular-nums ${row.due > 0 ? "text-red-900" : "text-emerald-900"}`}>{formatBDT(row.due)}</p></div></div>}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">{row.paymentMethod && <span>{row.paymentMethod}</span>}{row.receivedBy && <span>Received by {row.receivedBy}</span>}</div>
            </Link>
          ))}
          {snapshot.rows.length === 0 && <div className="rounded-lg bg-slate-50 px-4 py-8 text-center"><p className="text-sm font-semibold text-slate-700">No register entries</p><p className="mt-1 text-xs text-slate-400">এই তারিখে permitted register entry নেই।</p></div>}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "default" | "info" | "success" | "error" }) {
  const classes = { default: "bg-slate-50 text-slate-950", info: "bg-blue-50 text-blue-950", success: "bg-emerald-50 text-emerald-950", error: "bg-red-50 text-red-950" }[tone];
  return <div className={`rounded-lg p-3 ${classes}`}><p className="text-lg font-bold tabular-nums">{value}</p><p className="mt-0.5 text-[10px] opacity-65">{label}</p></div>;
}
