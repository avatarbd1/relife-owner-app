import { NextRequest, NextResponse } from "next/server";
import { adjustPhysioInventory } from "@/lib/webos/inventory";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await adjustPhysioInventory(context, {
      itemName: body.itemName,
      change: Number(body.change),
      reason: body.reason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INVENTORY_UPDATE_FAILED";
    const status = message === "ACCESS_DENIED" ? 403 : message.includes("SCHEMA") ? 503 : 400;
    if (status >= 500) console.error("Inventory update failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
