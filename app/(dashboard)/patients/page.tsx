import Link from "next/link";
import { cookies } from "next/headers";
import PatientsClient from "@/components/PatientsClient";
import { formatBDT } from "@/lib/format";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import {
  allowedPatientCreateDepartments,
  getAppointmentsForContext,
  getVisiblePatients,
  todayDhaka,
} from "@/lib/webos/reception";
import {
  PageHeading,
  MetricGrid,
  Section,
  ActionRow,
} from "@/components/WorkspaceUI";

function bdMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function identityMatches(value: string, staffId: string, fullName: string): boolean {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return Boolean(
    normalized &&
      (normalized === staffId.trim().toLowerCase() ||
        normalized === fullName.trim().toLowerCase().replace(/\s+/g, " "))
  );
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const cookieStore = await cookies();
  const params = searchParams ? await searchParams : {};
  const scope = context.roles.includes("Owner")
    ? "combined"
    : resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const clinician = context.roles.includes("Therapist") || context.roles.includes("Dentist");
  const todayView = clinician && params.view === "today";

  const [allPatients, createDepartments, identity] = await Promise.all([
    getVisiblePatients(context, scope),
    allowedPatientCreateDepartments(context),
    clinician ? getActiveWebStaffById(context.staffId) : Promise.resolve(null),
  ]);

  let patients = allPatients;
  let todayPatientCount = 0;
  if (clinician && identity) {
    const appointments = await getAppointmentsForContext(context, scope, todayDhaka());
    const myTodayIds = new Set(
      appointments
        .filter((appointment) =>
          identityMatches(appointment.therapist, identity.staffId, identity.fullName)
        )
        .map((appointment) => appointment.patientId)
    );
    todayPatientCount = myTodayIds.size;
    if (todayView) {
      patients = allPatients.filter((patient) => myTodayIds.has(patient.patientId));
    }
  }

  const monthKey = bdMonthKey(new Date());
  const active = patients.filter((patient) => patient.status.toLowerCase() === "active").length;
  const newThisMonth = patients.filter((patient) => patient.registrationDate.startsWith(monthKey)).length;
  const canSeeAnyMoney = ["Physio", "Dental"].some((department) =>
    canPerform(context, "payment.read_amount", department as "Physio" | "Dental")
  );
  const totalDue = patients.reduce((sum, patient) => sum + patient.due, 0);
  const canReadSchedule = ["Physio", "Dental"].some((department) =>
    canPerform(context, "appointment.read", department as "Physio" | "Dental")
  );

  return (
    <div>
      <PageHeading
        title={todayView ? "My patients today" : "Patients"}
        subtitle={
          context.roles.includes("Owner")
            ? "Combined patient workspace"
            : "Only patients allowed by your role and department"
        }
        action={
          createDepartments.length > 0 ? (
            <Link
              href="/patients/new"
              className="shrink-0 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white active:scale-[0.98]"
            >
              + Patient
            </Link>
          ) : undefined
        }
      />

      {clinician && (
        <div className="mb-4 inline-flex w-full rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
          <Link
            href="/patients?view=today"
            className={`min-h-10 flex-1 rounded-lg px-3 py-2.5 text-center text-xs font-semibold ${
              todayView ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500"
            }`}
          >
            My Today ({todayPatientCount})
          </Link>
          <Link
            href="/patients"
            className={`min-h-10 flex-1 rounded-lg px-3 py-2.5 text-center text-xs font-semibold ${
              !todayView ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500"
            }`}
          >
            All permitted
          </Link>
        </div>
      )}

      <Section title="Patient snapshot">
        <div className="px-4 pb-4">
          <MetricGrid
            items={[
              { label: "Patients", value: String(patients.length) },
              { label: "Active", value: String(active), tone: "positive" },
              { label: "New this month", value: String(newThisMonth) },
            ]}
          />
          {canSeeAnyMoney && totalDue > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">Patient master due</span>
              <span className="text-sm font-semibold tabular-nums text-red-600">{formatBDT(totalDue)}</span>
            </div>
          )}
        </div>
      </Section>

      {(canReadSchedule || createDepartments.length > 0) && (
        <Section title="Patient workflows">
          {canReadSchedule && (
            <ActionRow
              href="/appointments"
              icon="calendar"
              title="Today’s schedule"
              subtitle="Appointments, status and patient flow"
            />
          )}
          <ActionRow
            href="/register"
            icon="register"
            title="Daily register"
            subtitle="Department-safe daily patient register"
          />
        </Section>
      )}

      <section className="mb-4">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-slate-900">Patient list</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Search, open file and continue clinical workflow</p>
        </div>
        <PatientsClient patients={patients} showMoney={canSeeAnyMoney} />
      </section>
    </div>
  );
}
