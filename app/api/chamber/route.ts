import { NextRequest, NextResponse } from "next/server";
import { findActivePatientConflict } from "@/lib/domain/chamber/patientConcurrency";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import {
  completeChamberRuntimeSession,
  getChamberRuntimeSnapshot,
  receiveChamberRuntimePatient,
  startChamberRuntimeSession,
  updateChamberRuntimeStep,
} from "@/lib/domain/chamber/runtime";
import { assignChamberTherapist } from "@/lib/webos/chamberAssignment";
import { enrichChamberSnapshotWithPatientProfiles } from "@/lib/webos/chamberPatientProfile";
import { setChamberBedPreference } from "@/lib/webos/chamberPreference";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";

function statusFor(message: string): number {
  if (["ACCESS_DENIED", "THERAPIST_NOT_ASSIGNED"].includes(message)) return 403;
  if (["APPOINTMENT_NOT_FOUND", "PATIENT_NOT_FOUND", "CHAMBER_SESSION_NOT_FOUND", "STATION_NOT_FOUND", "RESOURCE_NOT_FOUND", "STAFF_NOT_FOUND"].includes(message)) return 404;
  if (["CHAMBER_SCHEMA_MISSING", "SUPABASE_EDGE_SECRET_MISSING"].includes(message)) return 503;
  if (
    message.startsWith("CHAMBER_CAPACITY:") ||
    message.startsWith("CHAMBER_RUNTIME_CONFLICT:") ||
    message.startsWith("CHAMBER_PATIENT_ALREADY_ACTIVE:") ||
    message.startsWith("RESOURCE_BUSY:") ||
    ["PATIENT_GENDER_REQUIRED", "CHAMBER_SESSION_COMPLETED", "CHAMBER_SESSION_NOT_RUNNING", "CHAMBER_SESSION_NOT_WAITING", "APPOINTMENT_NOT_ACTIVE"].includes(message)
  ) return 409;
  if (["CHAMBER_STEP_REQUIRED", "INVALID_STEP_DURATION", "INVALID_ACTION", "SCHEMA_MISMATCH"].includes(message)) return 400;
  return 500;
}

export async function GET() {
  try {
    const context = await requireCurrentAccessContext();
    const snapshot = await getChamberRuntimeSnapshot(context);
    const enriched = await enrichChamberSnapshotWithPatientProfiles(context, snapshot);
    return NextResponse.json({ ok: true, snapshot: enriched });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHAMBER_READ_FAILED";
    const status = statusFor(message);
    if (status === 500) console.error("Chamber read failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const action = String(body.action || "");
    if (action === "receive") {
      const appointmentId = String(body.appointmentId || "").trim();
      const result = await withMutationLock(`chamber-receive:${appointmentId || "unknown"}`, async () => {
        const snapshot = await getChamberRuntimeSnapshot(context);
        const target = snapshot.queue.find((item) => item.appointmentId === appointmentId);
        if (target) {
          const activity = [
            ...snapshot.stations.flatMap((station) =>
              station.session
                ? [{
                    appointmentId: station.session.appointmentId,
                    patientId: station.session.patientId,
                    status: station.session.status,
                  }]
                : []
            ),
            ...snapshot.queue.flatMap((item) =>
              item.sessionId
                ? [{
                    appointmentId: item.appointmentId,
                    patientId: item.patientId,
                    status: item.sessionStatus,
                  }]
                : []
            ),
          ];
          const conflict = findActivePatientConflict(
            { appointmentId, patientId: target.patientId },
            activity
          );
          if (conflict) {
            throw new Error(`CHAMBER_PATIENT_ALREADY_ACTIVE:${conflict.appointmentId}`);
          }
        }
        return receiveChamberRuntimePatient(context, appointmentId);
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "assign_therapist") {
      const result = await assignChamberTherapist(context, body.appointmentId, body.staffId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "prefer_station") {
      const result = await setChamberBedPreference(context, body.appointmentId, body.stationId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "start") {
      const result = await startChamberRuntimeSession(context, body.sessionId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "step") {
      const result = await updateChamberRuntimeStep(context, {
        sessionId: body.sessionId,
        step: body.step,
        resourceId: body.resourceId,
        stationId: body.stationId,
        durationMin: body.durationMin,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "complete") {
      const result = await completeChamberRuntimeSession(context, body.sessionId);
      return NextResponse.json({ ok: true, ...result });
    }
    throw new Error("INVALID_ACTION");
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHAMBER_ACTION_FAILED";
    const status = statusFor(message);
    if (status === 500) console.error("Chamber action failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
