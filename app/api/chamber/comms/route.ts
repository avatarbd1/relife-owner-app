import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";
import {
  createEquipmentRequest,
  getChamberCommsSnapshot,
  sendChamberMessage,
  updateEquipmentRequestStatus,
} from "@/lib/webos/chamberComms";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "CHAMBER_COMMS_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "EQUIPMENT_REQUEST_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "INVALID_EQUIPMENT_TRANSITION") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (["INVALID_MESSAGE", "INVALID_RESOURCE", "INVALID_LOCATION"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Chamber comms failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET() {
  try {
    const context = await requireCurrentAccessContext();
    const snapshot = await getChamberCommsSnapshot(context);
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error) {
    return errorResponse(error);
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
    if (action === "send_message") {
      const result = await withMutationLock("chamber-chat-write", () =>
        sendChamberMessage(context, body)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "request_equipment") {
      const result = await withMutationLock("chamber-equipment-request", () =>
        createEquipmentRequest(context, body)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "equipment_status") {
      const requestId = String(body.requestId || "");
      const result = await withMutationLock(`chamber-equipment:${requestId}`, () =>
        updateEquipmentRequestStatus(context, requestId, body.status)
      );
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
