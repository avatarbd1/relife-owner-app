import "server-only";

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  duration: number;
  status: "success" | "failed";
  error?: string;
}

export async function transcribeVoiceNote(
  voiceUrl: string,
  clinicId: string,
  staffId: string
): Promise<TranscriptionResult> {
  try {
    const apiKey = process.env.GOOGLE_SPEECH_TO_TEXT_API_KEY;
    if (!apiKey) {
      console.error("GOOGLE_SPEECH_TO_TEXT_API_KEY not configured");
      return {
        transcript: "",
        confidence: 0,
        duration: 0,
        status: "failed",
        error: "Transcription service not available",
      };
    }

    // Extract audio format from voice URL
    const audioFormat = voiceUrl.includes("webm") ? "WEBM_CODEC" : "MP3";
    const encoding =
      audioFormat === "WEBM_CODEC" ? "WEBM_CODEC" : "LINEAR16";

    // Fetch audio file from storage URL
    const audioResponse = await fetch(voiceUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    // Call Google Cloud Speech-to-Text API
    const transcribeResponse = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: encoding,
            sampleRateHertz: 16000,
            languageCode: "en-US",
            alternativeLanguageCodes: ["bn-BD"],
            model: "latest_long",
          },
          audio: {
            content: audioBase64,
          },
        }),
      }
    );

    if (!transcribeResponse.ok) {
      const errorData = await transcribeResponse.json().catch(() => ({}));
      throw new Error(
        `Transcription API error: ${JSON.stringify(errorData)}`
      );
    }

    const result = await transcribeResponse.json();

    if (!result.results || result.results.length === 0) {
      return {
        transcript: "",
        confidence: 0,
        duration: 0,
        status: "failed",
        error: "No speech detected in audio",
      };
    }

    const transcript = result.results
      .map((r: { alternatives?: { transcript: string; confidence?: number }[] }) => {
        if (!r.alternatives || r.alternatives.length === 0) return "";
        return r.alternatives[0].transcript || "";
      })
      .join(" ");

    const confidence = result.results[0]?.alternatives?.[0]?.confidence || 0;

    // Estimate duration (rough calculation based on file size)
    const durationSeconds = Math.round(audioBuffer.byteLength / 32000);

    return {
      transcript: transcript.trim(),
      confidence: Math.round(confidence * 100),
      duration: durationSeconds,
      status: transcript.trim() ? "success" : "failed",
      error: transcript.trim() ? undefined : "No text could be transcribed",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    console.error("Voice transcription failed:", error);

    return {
      transcript: "",
      confidence: 0,
      duration: 0,
      status: "failed",
      error: `Transcription failed: ${error}`,
    };
  }
}
