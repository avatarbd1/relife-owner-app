import { cookies } from "next/headers";
import AuditLogClient from "@/components/AuditLogClient";
import ScopeSelector from "@/components/ScopeSelector";
import { StatusBadge } from "@/components/FeedbackUI";
import { getAuditOverview } from "@/lib/webos/adminOverview";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { allowedScopesForContext, resolveAuthorizedScope } from "@/lib/webos/scope";

export default async function AuditPage() {
  const [context, cookieStore] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
  ]);
  const canRead =
    canPerform(context, "audit.read", "Physio") ||
    canPerform(context, "audit.read", "Dental");

  if (!canRead) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        এই account-এর জন্য audit access দেওয়া নেই।
      </div>
    );
  }

  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const allowedScopes = allowedScopesForContext(context);
  const overview = await getAuditOverview(context, scope);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Administration</p>
            <h1 className="mt-1 text-2xl font-bold">Audit log</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Security events, financial actions and system changes from live audit sheets.</p>
          </div>
          <StatusBadge tone={overview.critical.length ? "error" : "success"} className="border-white/10">
            {overview.critical.length ? `${overview.critical.length} critical` : "No critical loaded"}
          </StatusBadge>
        </div>
      </section>

      {allowedScopes.length > 1 && <ScopeSelector current={scope} allowed={allowedScopes} />}

      <AuditLogClient events={overview.events} critical={overview.critical} />
    </div>
  );
}
