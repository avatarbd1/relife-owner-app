"use server";

import { receiveChamberPatient } from "@/lib/webos/chamber";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export async function markAppointmentArrived(appointmentId: string): Promise<{ sessionId: string }> {
  const context = await requireCurrentAccessContext();
  return receiveChamberPatient(context, appointmentId);
}
