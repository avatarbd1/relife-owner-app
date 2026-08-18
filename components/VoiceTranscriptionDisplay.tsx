"use client";

import { useCallback, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";

interface TranscriptionState {
  status: "idle" | "transcribing" | "success" | "failed";
  transcript: string;
  confidence: number;
  error?: string;
}

interface VoiceTranscriptionDisplayProps {
  voiceUrl: string;
  clinicId: string;
  onTranscriptConfirm?: (transcript: string) => void;
  onTranscriptCancel?: () => void;
  autoTranscribe?: boolean;
}

export default function VoiceTranscriptionDisplay({
  voiceUrl,
  clinicId,
  onTranscriptConfirm,
  onTranscriptCancel,
  autoTranscribe = false,
}: VoiceTranscriptionDisplayProps) {
  const [state, setState] = useState<TranscriptionState>({
    status: "idle",
    transcript: "",
    confidence: 0,
  });
  const [editedText, setEditedText] = useState("");

  const startTranscription = useCallback(async () => {
    setState({ status: "transcribing", transcript: "", confidence: 0 });

    try {
      const response = await fetch("/api/comms/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceUrl, clinicId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setState({
          status: "failed",
          transcript: "",
          confidence: 0,
          error: errorData.error || "Transcription failed",
        });
        return;
      }

      const result = await response.json();

      if (result.status === "success") {
        setState({
          status: "success",
          transcript: result.transcript,
          confidence: result.confidence,
        });
        setEditedText(result.transcript);
      } else {
        setState({
          status: "failed",
          transcript: "",
          confidence: 0,
          error: result.error || "No text could be transcribed",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription request failed";
      setState({
        status: "failed",
        transcript: "",
        confidence: 0,
        error: message,
      });
    }
  }, [voiceUrl, clinicId]);

  const handleConfirm = useCallback(() => {
    onTranscriptConfirm?.(editedText || state.transcript);
  }, [editedText, state.transcript, onTranscriptConfirm]);

  if (state.status === "idle" && !autoTranscribe) {
    return (
      <button
        onClick={startTranscription}
        className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        Transcribe Voice Note
      </button>
    );
  }

  if (state.status === "transcribing") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600 p-3 bg-blue-50 rounded-lg">
        <Spinner size="sm" />
        <span>Transcribing audio...</span>
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg">
          <p className="font-medium mb-1">❌ Transcription Failed</p>
          <p>{state.error}</p>
        </div>
        <button
          onClick={startTranscription}
          className="w-full px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          Retry Transcription
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-green-900">✓ Transcription Complete</p>
          <span className="text-xs text-green-700">
            Confidence: {state.confidence}%
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-900">
          Review & Edit Transcript
        </label>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none"
          rows={4}
          placeholder="Transcribed text will appear here"
        />
        <p className="text-xs text-gray-500">
          {editedText.length} characters
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
        >
          Use Transcript
        </button>
        <button
          onClick={onTranscriptCancel}
          className="flex-1 px-4 py-2 bg-gray-300 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-400 transition-colors"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
