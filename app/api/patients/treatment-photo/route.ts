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

    // TODO: Implement actual file storage
    // This could be:
    // 1. Upload to cloud storage (Google Cloud Storage, AWS S3, etc.)
    // 2. Store in Supabase Storage
    // 3. Store in local file system (for development)
    // For now, we'll generate a mock response

    const photoId = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const photoUrl = `/api/photos/${photoId}`;

    return NextResponse.json({
      success: true,
      photo: {
        id: photoId,
        url: photoUrl,
        uploadedAt: new Date().toISOString(),
        size: file.size,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
