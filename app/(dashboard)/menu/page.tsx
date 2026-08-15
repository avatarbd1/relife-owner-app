import { ActionRow, PageHeading, Section } from "@/components/WorkspaceUI";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function MenuPage() {
  const context = await requireCurrentAccessContext();
  const canPatients = ["Physio", "Dental"].some((department) =>
    canPerform(context, "patient.read", department as "Physio" | "Dental")
  );
  const canAppointments = ["Physio", "Dental"].some((department) =>
    canPerform(context, "appointment.read", department as "Physio" | "Dental")
  );
  const canRegister = ["Physio", "Dental"].some((department) =>
    canPerform(context, "register.read", department as "Physio" | "Dental")
  );
  const canFinance = ["Physio", "Dental"].some((department) =>
    canPerform(context, "payment.create", department as "Physio" | "Dental") ||
    canPerform(context, "expense.request", department as "Physio" | "Dental") ||
    canPerform(context, "cash.request", department as "Physio" | "Dental") ||
    canPerform(context, "salary.pay", department as "Physio" | "Dental")
  );
  const canReports = ["Physio", "Dental"].some((department) =>
    canPerform(context, "report.read_operational", department as "Physio" | "Dental") ||
    canPerform(context, "report.read_financial", department as "Physio" | "Dental")
  );
  const canChamber = canPerform(context, "chamber.read", "Physio");
  const canClinical =
    canPerform(context, "clinical.read", "Physio") ||
    canPerform(context, "clinical.read", "Dental");
  const isOwner = context.roles.includes("Owner");

  return (
    <div>
      <PageHeading
        title="Menu"
        subtitle={`${context.roles.join(" + ")} · role and department scoped`}
      />

      <Section title="Daily operations">
        <ActionRow
          href="/daily"
          icon="attendance"
          title="Attendance & today"
          subtitle="Check in, break, check out and today schedule"
        />
        {canPatients && (
          <ActionRow
            href="/patients"
            icon="patients"
            title="Patients"
            subtitle="Search and open permitted patient files"
          />
        )}
        {canAppointments && (
          <ActionRow
            href="/appointments"
            icon="calendar"
            title="Appointments"
            subtitle="Today schedule and appointment status"
          />
        )}
        {canRegister && (
          <ActionRow
            href="/register"
            icon="register"
            title="Daily register"
            subtitle="Department-safe patient and session register"
          />
        )}
        {canChamber && (
          <ActionRow
            href="/chamber"
            icon="clinical"
            title="Live chamber"
            subtitle="Beds, traction, machines and treatment timing"
          />
        )}
      </Section>

      {(canFinance || isOwner) && (
        <Section title="Finance">
          {canFinance && (
            <ActionRow
              href="/operations"
              icon="payment"
              title="Finance operations"
              subtitle="Payment, expense, handover and salary actions"
            />
          )}
          {isOwner && (
            <ActionRow
              href="/finance"
              icon="cash"
              title="Owner finance"
              subtitle="Cash position and monthly business view"
            />
          )}
        </Section>
      )}

      {(canClinical || canReports) && (
        <Section title="Clinical & reports">
          {canClinical && (
            <ActionRow
              href="/patients"
              icon="clinical"
              title="Clinical files"
              subtitle="Open a patient to access authorized clinical records"
            />
          )}
          {canReports && (
            <ActionRow
              href="/reports"
              icon="history"
              title="Reports"
              subtitle="Operational and financial reports by permission"
            />
          )}
        </Section>
      )}

      <Section title="Account & tools">
        <ActionRow
          href="/more"
          icon="settings"
          title="More"
          subtitle="Tools, corrections, security and administration"
        />
      </Section>
    </div>
  );
}
