import { cookies } from "next/headers";
import AppointmentsWorkspaceClient from "@/components/AppointmentsWorkspaceClient";
import { getUnifiedAppointmentsForContext } from "@/lib/domain/appointments/read";
import type { Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";
import { todayDhaka } from "@/lib/webos/reception";

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

type AppointmentsTab = "schedule" | "calendar" | "clinicians";

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function validTab(value: string | undefined): AppointmentsTab {
  if (value === "calendar" || value === "clinicians") return value;
  return "schedule";
}

function isExceptionStatus(value: string): boolean {
  return ["no-show", "cancelled", "canceled"].includes(value.trim().toLowerCase());
}

function daysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    date?: string;
    scope?: string;
    focus?: string;
    tab?: string;
  }>;
}) {
  const context = await requireCurrentAccessContext();
  const cookieStore = await cookies();
  const params = searchParams ? await searchParams : {};
  const requestedScope = params.scope ?? cookieStore.get("relife_scope")?.value;
  const scope = resolveAuthorizedScope(context, requestedScope);
  const today = todayDhaka();
  const selectedDate = validDate(params.date) ? params.date : today;
  const initialTab = validTab(params.tab);
  const focusExceptions = params.focus === "exceptions";
  const monthKey = selectedDate.slice(0, 7);
  const monthDays = daysInMonth(monthKey);
  const allAppointments = await getUnifiedAppointmentsForContext(
    context,
    scope,
    `${monthKey}-01`,
    `${monthKey}-${String(monthDays).padStart(2, "0")}`
  );
  const selectedDateAppointments = allAppointments.filter(
    (row) => row.date === selectedDate
  );
  const appointments = focusExceptions
    ? selectedDateAppointments.filter((row) => isExceptionStatus(row.status))
    : selectedDateAppointments;

  const monthCounts = new Map<
    string,
    { total: number; physio: number; dental: number }
  >();
  for (const row of allAppointments) {
    const current = monthCounts.get(row.date) || {
      total: 0,
      physio: 0,
      dental: 0,
    };
    current.total += 1;
    if (row.department === "Physio") current.physio += 1;
    if (row.department === "Dental") current.dental += 1;
    monthCounts.set(row.date, current);
  }

  const calendarDays = Array.from({ length: monthDays }, (_, index) => {
    const date = `${monthKey}-${String(index + 1).padStart(2, "0")}`;
    const count = monthCounts.get(date) || {
      total: 0,
      physio: 0,
      dental: 0,
    };
    return { date, ...count };
  });

  return (
    <AppointmentsWorkspaceClient
      appointments={appointments.map((appointment) => ({
        ...appointment,
        canUpdate: canPerform(
          context,
          "appointment.update",
          appointment.department
        ),
      }))}
      calendarDays={calendarDays}
      selectedDate={selectedDate}
      today={today}
      scope={scope}
      scopeLabel={SCOPE_LABEL[scope]}
      initialTab={initialTab}
      focusExceptions={focusExceptions}
      canCreatePhysio={canPerform(context, "appointment.create", "Physio")}
      canCreateDental={canPerform(context, "appointment.create", "Dental")}
    />
  );
}
