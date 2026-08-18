import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { canPerform } from "@/lib/webos/access";

export async function POST(request: NextRequest) {
  try {
    const context = await requireCurrentAccessContext();

    // Check permissions
    const canWriteClinical =
      canPerform(context, "clinical.write", "Physio") ||
      canPerform(context, "clinical.write", "Dental");

    if (!canWriteClinical) {
      return NextResponse.json(
        { message: "No permission to upload treatment photos" },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const patientId = formData.get("patientId") as string;
    const sessionId = formData.get("sessionId") as string | null;

    if (!file || !patientId) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { message: "Only image files are supported" },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { message: "File must be smaller than 10 MB" },
        { status: 400 }
      );
    }

    // Generate unique photo ID
    const photoId = `${patientId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Convert file to base64 for storage (simplified for now)
    // In production, use: Supabase Storage, AWS S3, Google Cloud Storage, etc.
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Store metadata in Sheets or database
    // TODO: Add to 20_Treatment_Photos sheet or Supabase table
    // Schema: photo_id, patient_id, session_id, uploaded_at, uploaded_by, file_size, mime_type, base64_data

    return NextResponse.json({
      success: true,
      photo: {
        id: photoId,
        url: `/api/patients/treatment-photo/${photoId}`,
        uploadedAt: new Date().toISOString(),
        size: file.size,
        patientId,
        sessionId: sessionId || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
