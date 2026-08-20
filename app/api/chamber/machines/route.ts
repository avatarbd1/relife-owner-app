import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";
import {
  finishMachineUse,
  getMachineOperationSnapshot,
  startMachineUse,
} from "@/lib/webos/machineRuntime";

function statusFor(message: string): number {
  if (message === "ACCESS_DENIED") return 403;
  if (["CHAMBER_SESSION_NOT_FOUND", "RESOURCE_NOT_FOUND"].includes(message)) return 404;
  if (
    message.startsWith("RESOURCE_BUSY:") ||
    message.startsWith("MACHINE_ALREADY_RUNNING:") ||
    ["MACHINE_USE_MISMATCH", "MACHINE_REQUIRES_TREATMENT"].includes(message)
  ) return 409;
  if (message === "CHAMBER_SCHEMA_MISSING") return 503;
  return 500;
}

export async function GET() {
  try {
    const context = await requireCurrentAccessContext();
    const snapshot = await getMachineOperationSnapshot(context);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MACHINE_READ_FAILED";
    const status = statusFor(message);
    if (status === 500) console.error("Machine board read failed", error);
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
    const record = body as Record<string, unknown>;
    const action = String(record.action || "");
    const sessionId = String(record.sessionId || "").trim();
    if (!sessionId) return NextResponse.json({ ok: false, error: "CHAMBER_SESSION_NOT_FOUND" }, { status: 404 });

    if (action === "start") {
      const resourceId = String(record.resourceId || "").trim();
      const result = await withMutationLock(`machine-runtime:${sessionId}`, async () => {
        const snapshot = await getMachineOperationSnapshot(context);
        const session = snapshot.sessions.find((item) => item.sessionId === sessionId);
        const machine = snapshot.machines.find((item) => item.resourceId === resourceId);
        if (!session) throw new Error("CHAMBER_SESSION_NOT_FOUND");
        if (!machine) throw new Error("RESOURCE_NOT_FOUND");
        if (session.status === "Waiting" && !machine.traction) {
          throw new Error("MACHINE_REQUIRES_TREATMENT");
        }
        return startMachineUse(context, {
          sessionId,
          resourceId,
          durationMin: Number(record.durationMin || 0),
        });
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "finish") {
      const result = await withMutationLock(`machine-runtime:${sessionId}`, () =>
        finishMachineUse(context, {
          sessionId,
          resourceId: String(record.resourceId || "").trim(),
        })
      );
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MACHINE_ACTION_FAILED";
    const status = statusFor(message);
    if (status === 500) console.error("Machine action failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
