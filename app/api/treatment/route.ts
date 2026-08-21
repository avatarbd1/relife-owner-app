import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  recordTreatmentEntry,
  getTreatmentTemplates,
  getPatientTreatmentHistory,
  updateTreatmentEntry,
  deleteTreatmentEntry,
  type TreatmentEntryInput,
} from "@/lib/domain/operations/treatmentEntry";

export async function POST(request: Request) {
  const context = await requireCurrentAccessContext();

  try {
    const body = await request.json();
    const { action, patientId, appointmentId, therapistId, notes, templateUsed, photoPaths, duration, department, requestId, entryId, updates } = body;

    if (!action) {
      return Response.json({ error: "MISSING_ACTION" }, { status: 400 });
    }

    if (action === "record") {
      if (!patientId || !appointmentId || !therapistId || !notes || !duration || !department) {
        return Response.json({ error: "MISSING_REQUIRED_FIELDS" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const input: TreatmentEntryInput = {
        patientId,
        appointmentId,
        therapistId,
        notes,
        templateUsed,
        photoPaths,
        duration: Number(duration),
        department,
        requestId,
      };

      const result = await recordTreatmentEntry(context, input);
      return Response.json(result);
    }

    if (action === "update") {
      if (!entryId) {
        return Response.json({ error: "MISSING_ENTRY_ID" }, { status: 400 });
      }

      const result = await updateTreatmentEntry(context, entryId, updates || {});
      return Response.json(result);
    }

    if (action === "delete") {
      if (!entryId) {
        return Response.json({ error: "MISSING_ENTRY_ID" }, { status: 400 });
      }

      const result = await deleteTreatmentEntry(context, entryId);
      return Response.json(result);
    }

    return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    const statusMap: Record<string, number> = {
      ACCESS_DENIED: 403,
      THERAPIST_NOT_FOUND: 404,
      ENTRY_NOT_FOUND: 404,
      MISSING_PATIENT_ID: 400,
      MISSING_THERAPIST_ID: 400,
      MISSING_NOTES: 400,
      INVALID_DURATION: 400,
      INVALID_DEPARTMENT: 400,
    };

    const status = statusMap[message] || 500;
    return Response.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  const context = await requireCurrentAccessContext();

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const department = url.searchParams.get("department");

    if (action === "templates") {
      if (!department) {
        return Response.json({ error: "MISSING_DEPARTMENT" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const result = await getTreatmentTemplates(context, department as "Physio" | "Dental");
      return Response.json(result);
    }

    if (action === "history") {
      const patientId = url.searchParams.get("patientId");

      if (!patientId || !department) {
        return Response.json({ error: "MISSING_REQUIRED_PARAMS" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const result = await getPatientTreatmentHistory(context, patientId, department as "Physio" | "Dental");
      return Response.json(result);
    }

    return Response.json({ error: "MISSING_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return Response.json({ error: message }, { status: 500 });
  }
}
