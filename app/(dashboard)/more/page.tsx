import OwnerControlsClient from "@/components/OwnerControlsClient";
import {
  PageHeading,
  Section,
  ActionRow,
} from "@/components/WorkspaceUI";
import { getOwnerControlSnapshot } from "@/lib/controls";
import { actionsForRoles } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function MorePage() {
  const context = await requireCurrentAccessContext();
  const actionSet = new Set(actionsForRoles(context.roles));
  const isOwner = context.roles.includes("Owner");
  const canClinical = actionSet.has("clinical.read") || actionSet.has("clinical.write");
  const canInventory = canClinical || actionSet.has("audit.read");
  const canCorrect = actionSet.has("payment.void");
  const canAcceptCash = actionSet.has("cash.accept");
  const canChamber = actionSet.has("chamber.read");
  const canReadRegister =
    actionSet.has("patient.read") ||
    actionSet.has("appointment.read") ||
    actionSet.has("report.read_operational");

  const snapshot = isOwner ? await getOwnerControlSnapshot() : null;
  const pendingTotal = snapshot
    ? snapshot.pendingExpenses.length + snapshot.pendingCashMovements.length
    : 0;

  return (
    <div>
      <PageHeading
        title="More"
        subtitle="Operations, clinical tools and administration"
      />

      <Section title="Operations">
        {canChamber && (
          <ActionRow
            href="/chamber"
            icon="clinical"
            title="Live chamber"
            subtitle="4 beds, traction, machine availability and timers"
          />
        )}
        <ActionRow
          href="/daily"
          icon="attendance"
          title="Attendance"
          subtitle="Check in, break and check out"
        />
        {canReadRegister && (
          <ActionRow
            href="/register"
            icon="register"
            title="Daily register"
            subtitle="Department-safe operational register"
          />
        )}
        {canAcceptCash && !isOwner && (
          <ActionRow
            href="/finance/cash-receive"
            icon="cash"
            title="Receive cash handover"
            subtitle="Confirm actual amount received"
          />
        )}
        {canInventory && (
          <ActionRow
            href="/tools"
            icon="inventory"
            title="Inventory"
            subtitle="Authorized stock and inventory log"
          />
        )}
      </Section>

      {(canClinical || actionSet.has("audit.read")) && (
        <Section title="Clinical & learning">
          {canClinical && (
            <ActionRow
              href="/tools"
              icon="clinical"
              title="Clinical tools"
              subtitle="Clinical AI, Staff AI and case study"
            />
          )}
          {canCorrect && (
            <ActionRow
              href="/corrections"
              icon="correction"
              title="Same-day correction"
              subtitle="Own eligible entries with audit trail"
            />
          )}
        </Section>
      )}

      <Section title="Account & access">
        <ActionRow
          href="/security/passkeys"
          icon="security"
          title="Security"
          subtitle="Fingerprint, Face ID and device passkeys"
        />
        {isOwner && (
          <ActionRow
            href="/security/staff-access"
            icon="staff"
            title="Staff web access"
            subtitle="Secure first-time setup links"
          />
        )}
      </Section>

      {isOwner && snapshot && (
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Approvals</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Protected owner actions only</p>
            </div>
            {pendingTotal > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                {pendingTotal} pending
              </span>
            )}
          </div>
          <OwnerControlsClient snapshot={snapshot} />
        </section>
      )}
    </div>
  );
}
