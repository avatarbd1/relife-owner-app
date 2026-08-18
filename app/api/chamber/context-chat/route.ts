import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { getChamberChatWorkspace } from "@/lib/webos/chamberChat";
import { sendChamberMessage } from "@/lib/webos/chamberComms";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { withMutationLock } from "@/lib/webos/mutationLock";

const PRESET_MESSAGES = new Set([
  "Help needed — Jan/Asen counter",
  "Patient arrived",
  "Session starting",
  "Session completed",
  "Room cleanup needed",
  "Assessment done",
  "Can't proceed — Need approval",
  "Staff needed — Call receptionist",
  "Emergency — assistance required",
  "Call required",
]);

const OPERATIONAL_TERMS = [
  "patient",
  "rogi",
  "rogir",
  "room",
  "bed",
  "session",
  "treatment",
  "therapy",
  "equipment",
  "machine",
  "help",
  "need",
  "needed",
  "lagbe",
  "dorkar",
  "delay",
  "deri",
  "minute",
  "approval",
  "clean",
  "cleanup",
  "disinfection",
  "assessment",
  "plan",
  "staff",
  "reception",
  "receptionist",
  "therapist",
  "doctor",
  "emergency",
  "call",
  "arrived",
  "ready",
  "start",
  "starting",
  "complete",
  "completed",
  "counter",
  "wait",
  "waiting",
  "somoy",
  "porishkar",
  "jan",
  "asen",
];

const SHORT_OPERATIONAL_REPLIES = [
  "coming",
  "on my way",
  "noted",
  "done",
  "received",
  "okay",
  "ok",
  "wait",
  "waiting",
  "yes",
  "no",
  "ashchi",
  "aschi",
  "jacchi",
];

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function isOperationalMessage(value: string): boolean {
  const body = value.trim();
  if (PRESET_MESSAGES.has(body)) return true;
  const lower = body.toLowerCase().replace(/\s+/g, " ");
  if (
    lower.length <= 48 &&
    SHORT_OPERATIONAL_REPLIES.some(
      (reply) => lower === reply || lower.startsWith(`${reply} `)
    )
  ) {
    return true;
  }
  return OPERATIONAL_TERMS.some((term) => lower.includes(term));
}

function errorResponse(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : "CHAMBER_CONTEXT_CHAT_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "CHAT_CONTEXT_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "CHAT_CONTEXT_CLOSED") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (
    [
      "INVALID_MESSAGE",
      "NON_OPERATIONAL_MESSAGE",
      "CHAT_CONTEXT_REQUIRED",
    ].includes(message)
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  console.error("Chamber context chat failed:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET() {
  try {
    const context = await requireCurrentAccessContext();
    const workspace = await getChamberChatWorkspace(context);
    return NextResponse.json({ ok: true, ...workspace });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Origin rejected" },
      { status: 403 }
    );
  }

  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid request" },
        { status: 400 }
      );
    }

    const action = normalize((body as Record<string, unknown>).action);
    if (action !== "send_context_message") {
      return NextResponse.json(
        { ok: false, error: "Unknown action" },
        { status: 400 }
      );
    }

    const appointmentId = normalize(
      (body as Record<string, unknown>).appointmentId
    );
    if (!appointmentId) throw new Error("CHAT_CONTEXT_REQUIRED");

    const workspace = await getChamberChatWorkspace(context);
    const chatContext = workspace.contexts.find(
      (item) => item.appointmentId === appointmentId
    );
    if (!chatContext) throw new Error("CHAT_CONTEXT_NOT_FOUND");
    if (!chatContext.active) throw new Error("CHAT_CONTEXT_CLOSED");

    const message = normalize((body as Record<string, unknown>).body);
    if (!message || message.length > 500) throw new Error("INVALID_MESSAGE");
    if (!isOperationalMessage(message)) {
      throw new Error("NON_OPERATIONAL_MESSAGE");
    }

    const requestedPriority = normalize(
      (body as Record<string, unknown>).priority
    );
    const priority = requestedPriority.toLowerCase() === "urgent" ? "Urgent" : "Normal";

    const result = await withMutationLock(
      `chamber-context-chat:${appointmentId}`,
      () =>
        sendChamberMessage(context, {
          body: message,
          priority,
          patientId: chatContext.patientId,
          appointmentId: chatContext.appointmentId,
          bedId: chatContext.bedId,
          roomId: chatContext.roomId,
        })
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
