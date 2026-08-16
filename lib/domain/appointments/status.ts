import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  updateSupabaseChamberAppointmentStatus,
} from "@/lib/data/supabaseChamber";
import type { AccessContext } from "@/lib/webos/access";
import {
  APPOINTMENT_STATUSES,
  updateAppointmentStatus,
  type AppointmentStatus,
} from "@/lib/webos/appointmentStatus";

type ClinicDepartment = "Physio" | "Dental";

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Transitional status command. Legacy Sheets appointments keep their existing
 * writer. A Physio appointment that is not present in Sheets can be updated in
 * Supabase only when the explicit Chamber cutover mode is enabled.
 */
export async function updateUnifiedAppointmentStatus(
  context: AccessContext,
  input: {
    appointmentId: string;
    department: ClinicDepartment | string;
    status: AppointmentStatus | string;
  }
): Promise<{ appointmentId: string; status: AppointmentStatus }> {
  const appointmentId = normalize(input.appointmentId);
  const department = normalize(input.department) as ClinicDepartment;
  const status = normalize(input.status) as AppointmentStatus;

  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!(["Physio", "Dental"] as string[]).includes(department)) {
    throw new Error("INVALID_DEPARTMENT");
  }
  if (!APPOINTMENT_STATUSES.includes(status)) {
    throw new Error("INVALID_APPOINTMENT_STATUS");
  }

  try {
    return await updateAppointmentStatus(context, {
      appointmentId,
      department,
      status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APPOINTMENT_STATUS_FAILED";
    if (
      message !== "APPOINTMENT_NOT_FOUND" ||
      department !== "Physio" ||
      chamberDbMode() !== "supabase"
    ) {
      throw error;
    }
    if (!chamberSupabaseConfigured()) {
      throw new Error("SUPABASE_EDGE_SECRET_MISSING");
    }
  }

  const result = await updateSupabaseChamberAppointmentStatus({
    appointmentId,
    status,
    actorId: context.staffId,
  });
  return { appointmentId: result.appointmentId, status: result.status as AppointmentStatus };
}
