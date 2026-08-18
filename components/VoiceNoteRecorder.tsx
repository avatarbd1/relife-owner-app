"use client";

import { useCallback, useRef, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";

interface VoiceNoteRecorderProps {
  clinicId: string;
  staffId: string;
  onRecordingComplete?: (result: {
    voiceUrl: string;
    duration: number;
    uploadedAt: string;
  }) => void;
  onError?: (error: string) => void;
}

export default function VoiceNoteRecorder({
  clinicId,
  staffId,
  onRecordingComplete,
  onError,
}: VoiceNoteRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const uploadRecording = useCallback(async () => {
    try {
      setIsUploading(true);
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });

      if (blob.size > 10 * 1024 * 1024) {
        const errorMsg = "Voice note exceeds 10MB limit";
        setError(errorMsg);
        onError?.(errorMsg);
        return;
      }

      const formData = new FormData();
      formData.append("file", blob, `voice-${Date.now()}.webm`);
      formData.append("clinicId", clinicId);
      formData.append("staffId", staffId);
      formData.append("duration", duration.toString());

      const response = await fetch("/api/comms/voice/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Upload failed: ${response.status}`);
      }

      const result = await response.json();
      onRecordingComplete?.({
        voiceUrl: result.voiceUrl,
        duration: result.duration || duration,
        uploadedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload voice note";
      setError(message);
      onError?.(message);
    } finally {
      setIsUploading(false);
    }
  }, [clinicId, staffId, duration, onRecordingComplete, onError]);

  const startRecording = useCallback(async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        chunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        await uploadRecording();
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setDuration(0);

      durationIntervalRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to access microphone";
      setError(message);
      onError?.(message);
    }
  }, [uploadRecording, onError]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    }
  }, [isRecording]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isUploading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Spinner size="sm" />
        <span>Uploading voice note...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      <div className="flex items-center gap-2">
        {isRecording ? (
          <>
            <div className="flex items-center gap-2 flex-1 bg-red-50 px-3 py-2 rounded-lg">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-red-600">Recording...</span>
              <span className="text-sm text-red-600 ml-auto">{formatDuration(duration)}</span>
            </div>
            <button
              onClick={stopRecording}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
              disabled={isUploading}
            >
              Stop
            </button>
          </>
        ) : (
          <button
            onClick={startRecording}
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            disabled={isUploading}
          >
            <span>🎤</span>
            Record Voice Note
          </button>
        )}
      </div>

      <div className="text-xs text-gray-500">
        Max duration: 10 minutes | Max size: 10MB
      </div>
    </div>
  );
}
