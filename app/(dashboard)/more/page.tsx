import OwnerControlsClient from "@/components/OwnerControlsClient";
import { StatusBadge } from "@/components/FeedbackUI";
import { PageHeading, Section, ActionRow } from "@/components/WorkspaceUI";
import { getOwnerControlSnapshot } from "@/lib/controls";
import { actionsForRoles, canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function MorePage() {
  const context = await requireCurrentAccessContext();
  const actionSet = new Set(actionsForRoles(context.roles));
  const isOwner = context.roles.includes("Owner");
  const canPhysioClinicalTools = canPerform(context, "clinical.read", "Physio");
  const canPhysioInventory = canPerform(context, "inventory.read", "Physio");
  const canAudit = canPerform(context, "audit.read", "Physio") || canPerform(context, "audit.read", "Dental");
  const canSettings = actionSet.has("settings.manage") || isOwner;
  const canCorrect = actionSet.has("payment.void") || actionSet.has("payment.correct_own_today");
  const canAcceptCash = actionSet.has("cash.accept");
  const canChamber = canPerform(context, "chamber.read", "Physio");
  const canReadRegister = canPerform(context, "register.read", "Physio") || canPerform(context, "register.read", "Dental");
  const canFinance = [
    "payment.read_amount",
    "payment.create",
    "report.read_financial",
    "expense.read",
    "expense.request",
    "expense.approve",
    "cash.read",
    "cash.request",
    "cash.accept",
    "salary.read",
  ].some((action) => actionSet.has(action as never));
  const canReports = actionSet.has("report.read_operational") || actionSet.has("report.read_financial");
  const snapshot = isOwner ? await getOwnerControlSnapshot() : null;
  const pendingTotal = snapshot ? snapshot.pendingExpenses.length + snapshot.pendingCashMovements.length : 0;

  return (
    <div>
      <PageHeading title="More" subtitle="Operations, finance, reports and administration" />

      <Section title="Operations">
        {canChamber && <ActionRow href="/chamber" icon="chamber" title="Live chamber" subtitle="Beds, waiting, machines, chat and conflicts" />}
        <ActionRow href="/daily" icon="attendance" title="Attendance" subtitle="Check in, break and check out" />
        {canReadRegister && <ActionRow href="/register" icon="register" title="Daily register" subtitle="Department-safe operational register" />}
        {canAcceptCash && !isOwner && <ActionRow href="/finance/cash-receive" icon="cash" title="Receive cash handover" subtitle="Confirm actual amount received" />}
        {canPhysioInventory && <ActionRow href="/tools" icon="inventory" title="Inventory" subtitle="Authorized Physio stock and inventory log" />}
      </Section>

      {(canFinance || canReports) && (
        <Section title="Finance & reports">
          {canFinance && <ActionRow href="/finance" icon="finance" title="Finance" subtitle="Payments, expenses, cash, salary and balances" />}
          {canReports && <ActionRow href="/reports" icon="reports" title="Reports & analysis" subtitle="Operational and financial reports within your access" />}
        </Section>
      )}

      {(canPhysioClinicalTools || canCorrect) && (
        <Section title="Clinical & learning">
          {canPhysioClinicalTools && <ActionRow href="/tools" icon="clinical" title="Clinical tools" subtitle="Clinical AI, Staff AI and case study" />}
          {canCorrect && <ActionRow href="/corrections" icon="correction" title="Same-day correction" subtitle="Eligible same-day entries with audit trail" />}
        </Section>
      )}

      <Section title="Account & security">
        <ActionRow href={isOwner ? "/security" : "/security/passkeys"} icon="security" title="Security" subtitle={isOwner ? "Access posture, devices and staff setup" : "Fingerprint, Face ID and device passkeys"} />
        <ActionRow href="/pwa" icon="more" title="PWA & mobile status" subtitle="Install, offline policy, cache, storage and update diagnostics" />
        {isOwner && <ActionRow href="/security/staff-access" icon="staff" title="Staff web access" subtitle="Secure first-time setup links" />}
      </Section>

      {(canAudit || canSettings) && (
        <Section title="Administration">
          {canAudit && <ActionRow href="/audit" icon="history" title="Audit log" subtitle="Security, patient, finance and access timeline" />}
          {canSettings && <ActionRow href="/settings" icon="approval" title="Settings & administration" subtitle="Access matrix, data tools and system capability status" />}
        </Section>
      )}

      {isOwner && snapshot && (
        <section id="approvals" className="mb-4 scroll-mt-24">
          <div className="mb-2 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Approvals</h2><p className="mt-0.5 text-[11px] text-slate-500">Protected owner actions only</p></div>{pendingTotal > 0 && <StatusBadge tone="warning">{pendingTotal} pending</StatusBadge>}</div>
          <OwnerControlsClient snapshot={snapshot} />
        </section>
      )}
    </div>
  );
}
