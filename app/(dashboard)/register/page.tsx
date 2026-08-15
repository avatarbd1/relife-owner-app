import Link from "next/link";
import { cookies } from "next/headers";
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

function statusClass(status: string): string {
  if (status === "Paid") return "bg-emerald-50 text-emerald-700";
  if (status === "Partial") return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
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
  const scope = resolveAuthorizedScope(
    context,
    cookieStore.get("relife_scope")?.value
  );
  const snapshot = await getDailyRegisterSnapshot(context, scope, params.date);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Telegram → Web parity</p>
            <h1 className="mt-1 text-lg font-semibold">📋 Daily Register</h1>
            <p className="mt-1 text-xs text-slate-300">{SCOPE_LABEL[scope]} · Live 06_Payments · {snapshot.date}</p>
          </div>
          <Link href="/menu" className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white">Menu</Link>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <form method="get" className="flex gap-2">
          <input
            type="date"
            name="date"
            defaultValue={snapshot.date}
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
          />
          <button className="min-h-12 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white">দেখুন</button>
        </form>
        <div className={`mt-3 grid gap-2 ${snapshot.hasMoneyAccess ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-lg font-bold text-slate-900">{snapshot.totals.entries}</p>
            <p className="text-[10px] text-slate-500">Entries</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-lg font-bold text-slate-900">{snapshot.totals.sessions}</p>
            <p className="text-[10px] text-slate-500">Sessions</p>
          </div>
          {snapshot.hasMoneyAccess && (
            <>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-lg font-bold text-slate-900">{formatBDT(snapshot.totals.amount)}</p>
                <p className="text-[10px] text-slate-500">Collected</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-lg font-bold text-slate-900">{formatBDT(snapshot.totals.due)}</p>
                <p className="text-[10px] text-slate-500">Due snapshot</p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Register entries</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">{snapshot.departments.join(" + ") || "No permitted department"}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{snapshot.rows.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {snapshot.rows.map((row) => (
            <Link
              key={`${row.department}-${row.receiptNo}`}
              href={`/patients/${encodeURIComponent(row.patientId)}`}
              className="block rounded-xl border border-slate-100 bg-slate-50 p-3 active:bg-slate-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {row.sl ? `${row.sl}. ` : ""}{row.patientName || row.patientId}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {row.receiptNo} · {row.department}{row.sessions ? ` · ${row.sessions} session${row.sessions === 1 ? "" : "s"}` : ""}{row.service ? ` · ${row.service}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(row.status)}`}>{row.status}</span>
              </div>
              {row.moneyVisible && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <span>Paid {formatBDT(row.amount)}</span>
                  <span>Discount {formatBDT(row.discount)}</span>
                  <span>Due {formatBDT(row.due)}</span>
                  {row.paymentMethod && <span>{row.paymentMethod}</span>}
                </div>
              )}
              {row.receivedBy && <p className="mt-1 text-[10px] text-slate-400">Received by {row.receivedBy}</p>}
            </Link>
          ))}
          {snapshot.rows.length === 0 && (
            <p className="py-7 text-center text-sm text-slate-400">এই তারিখে permitted register entry নেই।</p>
          )}
        </div>
      </section>
    </div>
  );
}
