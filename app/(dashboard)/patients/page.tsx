import Link from "next/link";
import { cookies } from "next/headers";
import { Card, Row } from "@/components/Card";
import PatientsClient from "@/components/PatientsClient";
import { formatBDT } from "@/lib/format";
import type { Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  allowedPatientCreateDepartments,
  getVisiblePatients,
} from "@/lib/webos/reception";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function bdMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

export default async function PatientsPage() {
  const context = await requireCurrentAccessContext();
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const [patients, createDepartments] = await Promise.all([
    getVisiblePatients(context, scope),
    allowedPatientCreateDepartments(context),
  ]);
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {createDepartments.length > 0 && (
          <Link href="/patients/new" className="rounded-xl bg-slate-900 px-3 py-3 text-center text-xs font-semibold text-white">
            + নতুন রোগী
          </Link>
        )}
        {canReadSchedule && (
          <Link href="/appointments" className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-xs font-semibold text-slate-700">
            আজকের শিডিউল
          </Link>
        )}
      </div>

      <Card title="Patients" subtitle={`Scope: ${SCOPE_LABEL[scope]} · Live 02_Patients`}>
        <Row label="Total patients" value={String(patients.length)} emphasis />
        <Row label="Active" value={String(active)} />
        <Row label="New this month" value={String(newThisMonth)} />
        {canSeeAnyMoney && (
          <Row
            label="Patient master due"
            value={formatBDT(totalDue)}
            tone={totalDue > 0 ? "negative" : "neutral"}
          />
        )}
      </Card>

      <PatientsClient patients={patients} showMoney={canSeeAnyMoney} />
    </div>
  );
}
