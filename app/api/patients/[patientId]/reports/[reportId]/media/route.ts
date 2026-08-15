import { NextResponse } from "next/server";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getPatientForContext } from "@/lib/webos/reception";
import { getPatientReportForContext } from "@/lib/webos/reports";

const DEFAULT_BRIDGE_URL = "https://relife-clinic-os.onrender.com";

function bridgeConfig(): { baseUrl: string; secret: string } | null {
  const secret = process.env.BOT_MEDIA_BRIDGE_SECRET?.trim();
  if (!secret) return null;
  const baseUrl = (
    process.env.BOT_MEDIA_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL
  ).replace(/\/+$/, "");
  return { baseUrl, secret };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ patientId: string; reportId: string }> }
) {
  try {
    const context = await requireCurrentAccessContext();
    const { patientId, reportId } = await params;
    const patient = await getPatientForContext(
      context,
      decodeURIComponent(patientId)
    );
    if (!patient || patient.department === "All") {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canPerform(context, "clinical.read", patient.department)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const report = await getPatientReportForContext(
      context,
      patient,
      decodeURIComponent(reportId)
    );
    if (!report) return new NextResponse("Not found", { status: 404 });

    const bridge = bridgeConfig();
    if (!bridge) {
      return new NextResponse("Media storage is not configured", { status: 503 });
    }

    const query = new URLSearchParams({
      department: patient.department,
      report_id: report.reportId,
    });
    const upstream = await fetch(
      `${bridge.baseUrl}/internal/media-export/file?${query.toString()}`,
      {
        headers: { "X-Relife-Media-Key": bridge.secret },
        cache: "no-store",
        signal: AbortSignal.timeout(35_000),
      }
    );
    if (!upstream.ok) {
      console.error(
        "Patient media bridge failed",
        report.reportId,
        upstream.status
      );
      return new NextResponse("Media unavailable", { status: 502 });
    }

    const body = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const disposition =
      upstream.headers.get("content-disposition") ||
      `inline; filename="${report.fileName || report.reportId}"`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ACCESS_DENIED")) {
      return new NextResponse("Not found", { status: 404 });
    }
    console.error("Patient media route failed", error);
    return new NextResponse("Media unavailable", { status: 500 });
  }
}
