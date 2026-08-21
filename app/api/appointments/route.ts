import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  bookAppointment,
  getTherapistAvailability,
  rescheduleAppointment,
  cancelAppointment,
  getTodaysAppointments,
  type BookAppointmentInput,
} from "@/lib/domain/operations/appointmentBooking";

export async function POST(request: Request) {
  const context = await requireCurrentAccessContext();

  try {
    const body = await request.json();
    const { action, patientId, therapistId, date, startTime, duration, department, requestId } = body;

    if (!action) {
      return Response.json({ error: "MISSING_ACTION" }, { status: 400 });
    }

    if (!requestId) {
      return Response.json({ error: "MISSING_REQUEST_ID" }, { status: 400 });
    }

    if (action === "book") {
      if (!patientId || !date || !startTime || !duration || !department) {
        return Response.json({ error: "MISSING_REQUIRED_FIELDS" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const input: BookAppointmentInput = {
        patientId,
        therapistId,
        date,
        startTime,
        duration: Number(duration),
        department,
        requestId,
      };

      const result = await bookAppointment(context, input);
      return Response.json(result);
    }

    if (action === "reschedule") {
      const { appointmentId, newDate, newTime } = body;

      if (!appointmentId || !newDate || !newTime) {
        return Response.json({ error: "MISSING_REQUIRED_FIELDS" }, { status: 400 });
      }

      const result = await rescheduleAppointment(context, appointmentId, newDate, newTime);
      return Response.json(result);
    }

    if (action === "cancel") {
      const { appointmentId } = body;

      if (!appointmentId) {
        return Response.json({ error: "MISSING_APPOINTMENT_ID" }, { status: 400 });
      }

      const result = await cancelAppointment(context, appointmentId);
      return Response.json(result);
    }

    return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    const statusMap: Record<string, number> = {
      ACCESS_DENIED: 403,
      THERAPIST_NOT_FOUND: 404,
      APPOINTMENT_NOT_FOUND: 404,
      TIME_SLOT_CONFLICT: 409,
      OUTSIDE_BUSINESS_HOURS: 400,
      INVALID_DATE_FORMAT: 400,
      INVALID_TIME_FORMAT: 400,
      INVALID_DURATION: 400,
      MISSING_PATIENT_ID: 400,
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
    const action = url.searchParams.get("action");
    const department = url.searchParams.get("department");

    if (action === "today") {
      if (!department) {
        return Response.json({ error: "MISSING_DEPARTMENT" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const result = await getTodaysAppointments(context, department as "Physio" | "Dental");
      return Response.json(result);
    }

    if (action === "availability") {
      const therapistId = url.searchParams.get("therapistId");
      const date = url.searchParams.get("date");

      if (!therapistId || !date || !department) {
        return Response.json({ error: "MISSING_REQUIRED_PARAMS" }, { status: 400 });
      }

      if (!["Physio", "Dental"].includes(department)) {
        return Response.json({ error: "INVALID_DEPARTMENT" }, { status: 400 });
      }

      const result = await getTherapistAvailability(context, therapistId, date, department as "Physio" | "Dental");
      return Response.json(result);
    }

    return Response.json({ error: "MISSING_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return Response.json({ error: message }, { status: 500 });
  }
}
