import { cookies } from "next/headers";
import { Card, Row } from "@/components/Card";
import PatientsClient from "@/components/PatientsClient";
import { formatBDT } from "@/lib/format";
import { getPatients, patientsInScope } from "@/lib/patients";
import type { Scope } from "@/lib/types";

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
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const allPatients = await getPatients();
  const patients = patientsInScope(allPatients, scope);
  const monthKey = bdMonthKey(new Date());

  const active = patients.filter((patient) => patient.status.toLowerCase() === "active").length;
  const newThisMonth = patients.filter((patient) => patient.registrationDate.startsWith(monthKey)).length;
  const totalDue = patients.reduce((sum, patient) => sum + patient.due, 0);

  return (
    <div>
      <Card title="Patients" subtitle={`Scope: ${SCOPE_LABEL[scope]} · Live 02_Patients`}>
        <Row label="Total patients" value={String(patients.length)} emphasis />
        <Row label="Active" value={String(active)} />
        <Row label="New this month" value={String(newThisMonth)} />
        <Row
          label="Patient master due"
          value={formatBDT(totalDue)}
          tone={totalDue > 0 ? "negative" : "neutral"}
        />
      </Card>

      <PatientsClient patients={patients} />
    </div>
  );
}
