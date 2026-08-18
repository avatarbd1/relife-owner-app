import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { transcribeVoiceNote } from "@/lib/domain/comms/voiceTranscription";

export async function POST(request: NextRequest) {
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { voiceUrl, clinicId } = body;

    if (!voiceUrl || !clinicId) {
      return NextResponse.json(
        { ok: false, error: "Missing voiceUrl or clinicId" },
        { status: 400 }
      );
    }

    // Transcribe the voice note
    const result = await transcribeVoiceNote(
      voiceUrl,
      clinicId,
      context.staffId
    );

    return NextResponse.json(
      {
        ok: true,
        transcript: result.transcript,
        confidence: result.confidence,
        duration: result.duration,
        status: result.status,
        error: result.error,
      },
      { status: result.status === "success" ? 200 : 202 }
    );
  } catch (error) {
    console.error("Transcribe endpoint error:", error);
    const message = error instanceof Error ? error.message : "Transcription failed";

    return NextResponse.json(
      {
        ok: false,
        error: message,
        status: "failed",
      },
      { status: 500 }
    );
  }
}
