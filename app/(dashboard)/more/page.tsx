import { PageHeading, Section, ActionRow } from "@/components/WorkspaceUI";
import { actionsForRoles, canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function MorePage() {
  const context = await requireCurrentAccessContext();
  const actions = new Set(actionsForRoles(context.roles));
  const isOwner = context.roles.includes("Owner");

  const canReports =
    actions.has("report.read_operational") || actions.has("report.read_financial");
  const canAudit =
    canPerform(context, "audit.read", "Physio") ||
    canPerform(context, "audit.read", "Dental");
  const canSettings = actions.has("settings.manage") || isOwner;
  const canTools =
    canPerform(context, "clinical.read", "Physio") ||
    canPerform(context, "inventory.read", "Physio") ||
    actions.has("payment.correct_own_today");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="More"
        subtitle="Reports, tools, security and system administration"
      />

      {canReports && (
        <Section title="Insights">
          <ActionRow
            href="/reports"
            icon="reports"
            title="Reports & analysis"
            subtitle="Operational and financial performance"
          />
        </Section>
      )}

      {canTools && (
        <Section title="Clinic tools">
          <ActionRow
            href="/tools"
            icon="clinical"
            title="Clinical tools"
            subtitle="Treatment history, reports, case studies and diagnostics"
          />
          {canPerform(context, "inventory.read", "Physio") && (
            <ActionRow
              href="/inventory"
              icon="approval"
              title="Inventory"
              subtitle="Stock tracking, reorder points and expiry dates"
            />
          )}
        </Section>
      )}

      <Section title="Account & app">
        <ActionRow
          href={isOwner ? "/security" : "/security/passkeys"}
          icon="security"
          title="Security"
          subtitle={
            isOwner
              ? "Access, devices and staff setup"
              : "Fingerprint, Face ID and passkeys"
          }
        />
        <ActionRow
          href="/pwa"
          icon="more"
          title="App & PWA status"
          subtitle="Install, update and connection diagnostics"
        />
      </Section>

      {(canAudit || canSettings) && (
        <Section title="Administration">
          {canAudit && (
            <ActionRow
              href="/audit"
              icon="history"
              title="Audit log"
              subtitle="Security, finance and system evidence"
            />
          )}
          {canSettings && (
            <ActionRow
              href="/settings"
              icon="approval"
              title="Settings"
              subtitle="Access matrix, data and system configuration"
            />
          )}
        </Section>
      )}
    </div>
  );
}
