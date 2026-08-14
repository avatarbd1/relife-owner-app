import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  checkOwnerPin,
  verifySessionToken,
} from "@/lib/auth";
import { decideCashMovement } from "@/lib/controls";
import type { Workbook } from "@/lib/data/googleSheets";

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function statusForError(message: string): number {
  if (message === "CONTROL_NOT_FOUND") return 404;
  if (message === "CONTROL_ALREADY_DECIDED") return 409;
  if (message.startsWith("CONTROL_CONFIG_")) return 503;
  if (message === "CONTROL_SCHEMA_MISMATCH") return 500;
  return 500;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(session)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const workbook = body?.workbook as Workbook | undefined;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const decision = body?.decision;
  const pin = typeof body?.pin === "string" ? body.pin : "";
  const receivedAmount =
    typeof body?.receivedAmount === "number" ? body.receivedAmount : undefined;

  if (!pin || !checkOwnerPin(pin)) {
    return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
  }
  if (!(["physio", "dental"] as const).includes(workbook as Workbook)) {
    return NextResponse.json({ ok: false, error: "Invalid workbook" }, { status: 400 });
  }
  if (!id || !["accept", "reject"].includes(decision)) {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }
  if (
    receivedAmount !== undefined &&
    (!Number.isFinite(receivedAmount) || receivedAmount < 0)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid received amount" }, { status: 400 });
  }

  try {
    await decideCashMovement(
      workbook as Workbook,
      id,
      decision,
      receivedAmount
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CONTROL_FAILED";
    console.error("Owner cash movement control failed:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: statusForError(message) }
    );
  }
}
