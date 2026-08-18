import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  try {
    const context = await requireCurrentAccessContext();
    const formData = await request.formData();

    const file = formData.get("file") as File;
    const clinicId = formData.get("clinicId") as string;
    const staffId = formData.get("staffId") as string;
    const duration = parseInt(formData.get("duration") as string, 10) || 0;

    if (!file || !clinicId || !staffId) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: `File exceeds maximum size of 10MB` },
        { status: 413 }
      );
    }

    // Validate MIME type
    const validMimeTypes = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav"];
    if (!validMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { ok: false, error: "Invalid audio format. Supported: WebM, MP4, MP3, WAV" },
        { status: 400 }
      );
    }

    // Verify staff ID matches context
    if (staffId !== context.staffId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized: cannot upload voice notes for another staff" },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { ok: false, error: "Storage service not configured" },
        { status: 503 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const timestamp = Date.now();
    const filename = `${staffId}-${timestamp}.webm`;
    const filePath = `clinic/${clinicId}/voice/${filename}`;

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const { data, error } = await supabase.storage
      .from("voice-notes")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("Storage upload error:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to upload voice note" },
        { status: 500 }
      );
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("voice-notes").getPublicUrl(filePath);

    return NextResponse.json(
      {
        ok: true,
        voiceUrl: publicUrl,
        duration: duration,
        uploadedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Voice upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
