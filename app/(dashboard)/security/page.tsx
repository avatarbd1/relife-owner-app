import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/FeedbackUI";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getWebStaffDirectory, toAccessContext } from "@/lib/webos/staffDirectory";
import { listPasskeysForStaff } from "@/lib/webauthn";

export default async function SecurityPage() {
  const context = await requireCurrentAccessContext();
  if (!context.roles.includes("Owner")) redirect("/security/passkeys");

  const [directory, ownerPasskeys] = await Promise.all([
    getWebStaffDirectory(),
    listPasskeysForStaff(context.staffId).catch(() => []),
  ]);
  const active = directory.filter((item) => item.status === "Active");
  const ready = active.filter((item) => Boolean(toAccessContext(item)));
  const blocked = active.filter((item) => !toAccessContext(item));

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Owner security</p>
            <h1 className="mt-1 text-2xl font-bold">Access & devices</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Staff mapping, passkey enrollment and audit oversight.</p>
          </div>
          <StatusBadge tone={blocked.length ? "warning" : "success"} className="border-white/10">
            {blocked.length ? `${blocked.length} blocked` : "Access mapped"}
          </StatusBadge>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white/10 p-2"><p className="text-[10px] text-slate-300">Active staff</p><p className="mt-1 text-lg font-bold">{active.length}</p></div>
          <div className="rounded-lg bg-emerald-400/10 p-2"><p className="text-[10px] text-emerald-200">Ready</p><p className="mt-1 text-lg font-bold text-emerald-100">{ready.length}</p></div>
          <div className="rounded-lg bg-blue-400/10 p-2"><p className="text-[10px] text-blue-200">My passkeys</p><p className="mt-1 text-lg font-bold text-blue-100">{ownerPasskeys.length}</p></div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Security actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href="/security/passkeys" className="min-h-20 rounded-xl bg-blue-50 p-3 text-blue-900 ring-1 ring-blue-100"><p className="text-sm font-semibold">My devices</p><p className="mt-1 text-[11px] leading-4 text-blue-700">Passkey list, register and revoke</p></Link>
          <Link href="/security/staff-access" className="min-h-20 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-100"><p className="text-sm font-semibold">Staff setup</p><p className="mt-1 text-[11px] leading-4 text-emerald-700">Create one-time enrollment links</p></Link>
          <Link href="/audit" className="min-h-20 rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-100"><p className="text-sm font-semibold">Audit log</p><p className="mt-1 text-[11px] leading-4 text-amber-700">Review access and system events</p></Link>
          <Link href="/settings" className="min-h-20 rounded-xl bg-slate-50 p-3 text-slate-900 ring-1 ring-slate-200"><p className="text-sm font-semibold">Access matrix</p><p className="mt-1 text-[11px] leading-4 text-slate-600">Roles, mappings and admin status</p></Link>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-slate-900">Staff access posture</h2><p className="mt-0.5 text-xs text-slate-500">Live Staff_Department_Access + role mapping</p></div>
          <StatusBadge tone={blocked.length ? "warning" : "success"}>{ready.length}/{active.length} ready</StatusBadge>
        </div>
        <div className="mt-3 space-y-2">
          {active.map((item) => {
            const isReady = Boolean(toAccessContext(item));
            return (
              <article key={item.staffId} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900">{item.fullName}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.staffId} · {item.roles.join(" · ") || "No role"}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.departmentAccess.join(" · ") || "No department mapping"}</p></div>
                <StatusBadge tone={isReady ? "success" : "error"}>{isReady ? "Ready" : "Blocked"}</StatusBadge>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
