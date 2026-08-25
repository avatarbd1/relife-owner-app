import { NextRequest, NextResponse } from "next/server";
import { findActivePatientConflict } from "@/lib/domain/chamber/patientConcurrency";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { assertCanPerform } from "@/lib/webos/access";
import {
  completeChamberRuntimeSession,
  getChamberRuntimeSnapshot,
  receiveChamberRuntimePatient,
  startChamberRuntimeSession,
  updateChamberRuntimeStep,
} from "@/lib/domain/chamber/runtime";
import { assignChamberTherapist } from "@/lib/webos/chamberAssignment";
import {
  captureChamberTreatmentForCompletion,
  recordChamberCompletionTreatmentNote,
} from "@/lib/webos/chamberClinicalNote";
import { enrichChamberSnapshotWithPatientProfiles } from "@/lib/webos/chamberPatientProfile";
import { setChamberBedPreference } from "@/lib/webos/chamberPreference";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { startGeneralTreatment } from "@/lib/webos/generalTreatmentRuntime";
import { getMachineOperationSnapshot } from "@/lib/webos/machineRuntime";
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
    message.startsWith("MACHINE_ALREADY_RUNNING:") ||
    ["MACHINE_STILL_RUNNING", "PATIENT_GENDER_REQUIRED", "CHAMBER_SESSION_COMPLETED", "CHAMBER_SESSION_NOT_RUNNING", "CHAMBER_SESSION_NOT_WAITING", "APPOINTMENT_NOT_ACTIVE"].includes(message)
  ) return 409;
  if (["CHAMBER_STEP_REQUIRED", "INVALID_STEP_DURATION", "INVALID_ACTION", "SCHEMA_MISMATCH"].includes(message)) return 400;
  return 500;
}

export async function GET() {
  try {
    // T2-02: Require full tenant-aware context for chamber operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateDepartmentAccess(access, "Physio");
    validateTenantScope(access, tenant, "chamber.read");
    const snapshot = await getChamberRuntimeSnapshot(access);
    const enriched = await enrichChamberSnapshotWithPatientProfiles(access, snapshot);
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
    // T2-02: Require full tenant-aware context for chamber operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateDepartmentAccess(access, "Physio");
    validateTenantScope(access, tenant, "chamber.run");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const action = String(body.action || "");
    if (action === "receive") {
      assertCanPerform(access, "chamber.receive", "Physio");
      const appointmentId = String(body.appointmentId || "").trim();
      const result = await withMutationLock("chamber-receive", async () => {
        const snapshot = await getChamberRuntimeSnapshot(access);
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
          if (conflict) throw new Error(`CHAMBER_PATIENT_ALREADY_ACTIVE:${conflict.appointmentId}`);
        }
        return receiveChamberRuntimePatient(access, appointmentId);
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "assign_therapist") {
      assertCanPerform(access, "chamber.run", "Physio");
      const appointmentId = String(body.appointmentId || "").trim();
      const result = await withMutationLock(`chamber-therapist:${appointmentId}`, () =>
        assignChamberTherapist(access, appointmentId, body.staffId)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "prefer_station") {
      // Legacy compatibility only. New Physio booking does not pre-assign beds.
      assertCanPerform(access, "chamber.run", "Physio");
      const appointmentId = String(body.appointmentId || "").trim();
      const result = await withMutationLock(`chamber-station:${appointmentId}`, () =>
        setChamberBedPreference(access, appointmentId, body.stationId)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "start") {
      assertCanPerform(access, "chamber.run", "Physio");
      const sessionId = String(body.sessionId || "").trim();
      const result = await withMutationLock(`chamber-session:${sessionId}`, () =>
        sessionId.startsWith("CHW")
          ? startGeneralTreatment(access, sessionId)
          : startChamberRuntimeSession(access, sessionId)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "step") {
      // Legacy clinical-step API. Routine machine use now goes through /api/chamber/machines.
      assertCanPerform(access, "chamber.run", "Physio");
      const sessionId = String(body.sessionId || "").trim();
      const result = await withMutationLock(`chamber-session:${sessionId}`, () =>
        updateChamberRuntimeStep(access, {
          sessionId,
          step: body.step,
          resourceId: body.resourceId,
          stationId: body.stationId,
          durationMin: body.durationMin,
        })
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "complete") {
      assertCanPerform(access, "chamber.run", "Physio");
      const sessionId = String(body.sessionId || "").trim();
      if (sessionId.startsWith("CHW")) {
        const machines = await getMachineOperationSnapshot(access);
        const active = machines.sessions.find((item) => item.sessionId === sessionId);
        if (active?.currentResourceId) throw new Error("MACHINE_STILL_RUNNING");
      }
      const capture = await captureChamberTreatmentForCompletion(access, sessionId);
      const result = await withMutationLock(`chamber-session:${sessionId}`, () =>
        completeChamberRuntimeSession(access, sessionId)
      );
      try {
        const treatmentNote = await recordChamberCompletionTreatmentNote(access, capture);
        return NextResponse.json({
          ok: true,
          ...result,
          noteSaved: true,
          treatmentNote,
        });
      } catch (noteError) {
        console.error("Chamber completed but automatic treatment note save failed", noteError);
        return NextResponse.json({
          ok: true,
          ...result,
          noteSaved: false,
          noteError: noteError instanceof Error ? noteError.message : "TREATMENT_NOTE_SAVE_FAILED",
        });
      }
    }
    throw new Error("INVALID_ACTION");
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHAMBER_ACTION_FAILED";
    const status = statusFor(message);
    if (status === 500) console.error("Chamber action failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
