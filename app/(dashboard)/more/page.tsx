import { PageHeading, Section, ActionRow } from "@/components/WorkspaceUI";
import { actionsForRoles, canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function MorePage() {
  const context = await requireCurrentAccessContext();
  const actions = new Set(actionsForRoles(context.roles));
  const isOwner = context.roles.includes("Owner");

  const canReports =
    actions.has("report.read_operational") || actions.has("report.read_financial");
  const canPerformance = actions.has("performance.read_self");
  const canWeeklyFinalization = actions.has("performance.weekly.finalize");
  const canAudit =
    canPerform(context, "audit.read", "Physio") ||
    canPerform(context, "audit.read", "Dental");
  const canInventory = canPerform(context, "inventory.read", "Physio");
  const canTools =
    canPerform(context, "clinical.read", "Physio") ||
    canInventory ||
    actions.has("payment.correct_own_today");
  const canDentalTools =
    canPerform(context, "patient.read", "Dental") ||
    canPerform(context, "register.read", "Dental") ||
    canPerform(context, "clinical.read", "Dental");
  const canBulkImport =
    canPerform(context, "patient.create", "Physio") ||
    canPerform(context, "patient.create", "Dental");
  const canExpenseRequest =
    canPerform(context, "expense.request", "Physio") ||
    canPerform(context, "expense.request", "Dental");
  const canCashRequest =
    canPerform(context, "cash.request", "Physio") ||
    canPerform(context, "cash.request", "Dental");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="More"
        subtitle="Reports, tools, security and account settings"
      />

      {(canReports || canPerformance || canWeeklyFinalization) && (
        <Section title="Insights">
          {canPerformance && (
            <ActionRow
              href="/performance"
              icon="reports"
              title="Performance & rewards"
              subtitle="নিজের Points, Milestones, Weekly Leaderboard ও Reward দেখুন"
            />
          )}
          {canWeeklyFinalization && (
            <ActionRow
              href="/performance/weekly"
              icon="approval"
              title="Weekly Gamification finalizer"
              subtitle="Owner recovery, score coverage, config versions and RC earning status"
            />
          )}
          {canReports && (
            <>
              <ActionRow
                href="/reports"
                icon="reports"
                title="Reports & analysis"
                subtitle="Operational and financial performance"
              />
              <ActionRow
                href="/reports/export"
                icon="reports"
                title="CSV export"
                subtitle="Permission-scoped patients, appointments, clinical and finance export"
              />
            </>
          )}
        </Section>
      )}

      {(canBulkImport || canExpenseRequest || canCashRequest) && (
        <Section title="Fast operations">
          {canBulkImport && (
            <ActionRow
              href="/patients/bulk-import"
              icon="register"
              title="Bulk patient import"
              subtitle="Validated CSV import through the canonical patient writer"
            />
          )}
          {canExpenseRequest && (
            <ActionRow
              href="/finance/expense-request"
              icon="approval"
              title="Request expense"
              subtitle="Create a pending clinic expense for Owner review"
            />
          )}
          {canCashRequest && (
            <ActionRow
              href="/finance/cash-movement"
              icon="approval"
              title="Request cash movement"
              subtitle="Reception custody transfer to Home Treasury or Bank"
            />
          )}
        </Section>
      )}

      {(canTools || canDentalTools) && (
        <Section title="Clinic tools">
          {canTools && (
            <ActionRow
              href="/tools"
              icon="clinical"
              title="Clinical tools"
              subtitle="Treatment history, reports, case studies and diagnostics"
            />
          )}
          {canDentalTools && (
            <ActionRow
              href="/tools/dental"
              icon="clinical"
              title="Dental tools"
              subtitle="Dental register snapshot and role-aware shortcuts"
            />
          )}
          {canInventory && (
            <ActionRow
              href="/inventory"
              icon="approval"
              title="Inventory"
              subtitle="Stock, low-stock alerts, movements and audited adjustments"
            />
          )}
        </Section>
      )}

      <Section title="Account & app">
        <ActionRow
          href="/settings"
          icon="staff"
          title="Settings"
          subtitle={isOwner ? "Profile, clinic staff and current clinic rules" : "Profile and sign-in security"}
        />
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

      {canAudit && (
        <Section title="Administration">
          <ActionRow
            href="/audit"
            icon="history"
            title="Audit log"
            subtitle="Security, finance and system evidence"
          />
        </Section>
      )}
    </div>
  );
}
