import { NextResponse } from "next/server";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { getPatientForContext } from "@/lib/webos/reception";
import { getPatientReportForContext } from "@/lib/webos/reports";
import { downloadReportFromDrive } from "@/lib/webos/reportDrive";
import {
  downloadPrivatePatientReport,
  reportStoragePathFromLink,
} from "@/lib/webos/reportStorage";

const DEFAULT_BRIDGE_URL = "https://relife-clinic-os.onrender.com";

function bridgeConfig(): { baseUrl: string; secret: string } | null {
  const secret = process.env.BOT_MEDIA_BRIDGE_SECRET?.trim();
  if (!secret) return null;
  const baseUrl = (
    process.env.BOT_MEDIA_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL
  ).replace(/\/+$/, "");
  return { baseUrl, secret };
}

function safeFilename(value: string, fallback: string): string {
  return (value || fallback).replace(/[\r\n"]/g, "_").slice(0, 180) || fallback;
}

function mediaContentType(
  upstreamType: string,
  reportType: string,
  fileName: string
): string {
  const upstream = upstreamType.trim();
  const upstreamBase = upstream.split(";", 1)[0]?.trim().toLowerCase() || "";
  if (upstreamBase.startsWith("image/") || upstreamBase === "application/pdf") {
    return upstream;
  }

  const declared = reportType.trim().toLowerCase();
  if (declared.startsWith("image/") || declared === "application/pdf") {
    return declared;
  }

  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  };
  const extensionType = byExtension[extension];
  if (extensionType) return extensionType;

  // Legacy report rows used File_Type=Photo without a MIME type or filename
  // extension. Keep this compatibility bounded to values that explicitly
  // declare an image; generic/unknown payloads remain octet-stream.
  if (declared === "photo" || declared === "image") return "image/jpeg";

  return upstream || "application/octet-stream";
}

function mediaResponse(
  body: ArrayBuffer,
  contentType: string,
  fileName: string
): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ patientId: string; reportId: string }> }
) {
  try {
    // T2-02: Require full tenant-aware context for patient operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateTenantScope(access, tenant, "patient.report.read");
    const { patientId, reportId } = await params;
    const patient = await getPatientForContext(
      access,
      decodeURIComponent(patientId)
    );
    if (!patient || patient.department === "All") {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canPerform(access, "patient.report.read", patient.department)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const report = await getPatientReportForContext(
      access,
      patient,
      decodeURIComponent(reportId),
      tenant.organizationId,
      tenant.clinicId,
    );
    if (!report) return new NextResponse("Not found", { status: 404 });
    const fileName = safeFilename(report.fileName, report.reportId);

    if (reportStoragePathFromLink(report.driveLink)) {
      try {
        const stored = await downloadPrivatePatientReport(report.driveLink);
        return mediaResponse(
          stored.body,
          mediaContentType(stored.contentType, report.fileType, fileName),
          fileName
        );
      } catch (error) {
        console.error("Private report storage fetch failed", report.reportId, error);
        return new NextResponse("Media unavailable", { status: 502 });
      }
    }

    if (report.driveLink) {
      try {
        const drive = await downloadReportFromDrive(report.driveLink);
        return mediaResponse(
          drive.body,
          mediaContentType(drive.contentType, report.fileType, fileName),
          fileName
        );
      } catch (error) {
        console.error("Drive report fetch failed; trying legacy bridge", report.reportId, error);
      }
    }

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
    const contentType = mediaContentType(
      upstream.headers.get("content-type") || "",
      report.fileType,
      fileName
    );
    const disposition =
      upstream.headers.get("content-disposition") ||
      `inline; filename="${fileName}"`;

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
