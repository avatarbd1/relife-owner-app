import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { staffCheckIn, staffCheckOut, logPatientArrival, getTodayRegisterStatus, type StaffCheckInInput, type StaffCheckOutInput, type PatientArrivalInput } from "@/lib/domain/operations/staffCheckIn";

export async function POST(request: Request) {
  const context = await requireCurrentAccessContext();

  try {
    const body = await request.json();
    const { action, staffId, patientId, department, requestId } = body;

    if (!action) {
      return Response.json({ error: "MISSING_ACTION" }, { status: 400 });
    }

    if (!requestId) {
      return Response.json({ error: "MISSING_REQUEST_ID" }, { status: 400 });
    }

    if (action === "checkin") {
      if (!staffId) {
        return Response.json({ error: "MISSING_STAFF_ID" }, { status: 400 });
      }

      const input: StaffCheckInInput = { staffId, requestId };
      const result = await staffCheckIn(context, input);
      return Response.json(result);
    }

    if (action === "checkout") {
      if (!staffId) {
        return Response.json({ error: "MISSING_STAFF_ID" }, { status: 400 });
      }

      const input: StaffCheckOutInput = { staffId, requestId };
      const result = await staffCheckOut(context, input);
      return Response.json(result);
    }

    if (action === "patient-arrival") {
      if (!patientId || !department) {
        return Response.json({ error: "MISSING_PATIENT_ID_OR_DEPARTMENT" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const input: PatientArrivalInput = { patientId, department, requestId };
      const result = await logPatientArrival(context, input);
      return Response.json(result);
    }

    return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    const statusMap: Record<string, number> = {
      ACCESS_DENIED: 403,
      STAFF_NOT_FOUND: 404,
      PATIENT_NOT_FOUND: 404,
      ALREADY_CHECKED_IN: 409,
      NOT_CHECKED_IN: 409,
      INVALID_DEPARTMENT: 400,
      DUPLICATE_REQUEST: 409,
    };

    const status = statusMap[message] || 500;
    return Response.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  const context = await requireCurrentAccessContext();

  try {
    const url = new URL(request.url);
    const department = url.searchParams.get("department");

    if (!department) {
      return Response.json({ error: "MISSING_DEPARTMENT" }, { status: 400 });
    }

    if (!["Physio", "Dental"].includes(department)) {
      return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
    }

    const result = await getTodayRegisterStatus(context, department as "Physio" | "Dental");
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return Response.json({ error: message }, { status: 500 });
  }
}
