export interface ChamberPatientActivity {
  appointmentId: string;
  patientId: string;
  status: string;
}

const ACTIVE = new Set(["waiting", "in treatment"]);

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function findActivePatientConflict(
  target: { appointmentId: string; patientId: string },
  activity: ChamberPatientActivity[]
): ChamberPatientActivity | null {
  const patientId = String(target.patientId || "").trim();
  if (!patientId) return null;
  return (
    activity.find(
      (item) =>
        item.patientId === patientId &&
        item.appointmentId !== target.appointmentId &&
        ACTIVE.has(normalized(item.status))
    ) || null
  );
}
