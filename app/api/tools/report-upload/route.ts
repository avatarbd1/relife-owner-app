import { NextRequest, NextResponse } from "next/server";
import { uploadPhysioReport } from "@/lib/webos/reportDrive";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentAccessContext();
    const form = await request.formData();
    const patientId = String(form.get("patientId") || "").trim();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "REPORT_FILE_REQUIRED" }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadPhysioReport(context, {
      patientId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPORT_UPLOAD_FAILED";
    const status = message === "ACCESS_DENIED" ? 403 : message.includes("PATIENT") ? 404 : message.includes("DRIVE") || message.includes("SCHEMA") ? 503 : 400;
    if (status >= 500) console.error("Report upload failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
