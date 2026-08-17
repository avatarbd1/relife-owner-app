"use client";

import { useState, useRef } from "react";
import { Spinner, InlineNotice } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

interface ExtractedData {
  fullName?: string;
  phone?: string;
  address?: string;
  fatherHusbandName?: string;
}

interface PhotoCaptureRegistrationProps {
  onExtract: (data: ExtractedData) => void;
  isOpen: boolean;
  onClose: () => void;
}

// Simple phone number extraction
function extractPhones(text: string): string[] {
  const phoneRegex = /\b(?:\+88|88)?0?(?:1[3-9]\d{8}|[\d\s\-]{10,})\b/g;
  const matches = text.match(phoneRegex) || [];
  return matches.map((p) => p.replace(/\D/g, "")).slice(0, 2);
}

// Simple name extraction - look for all-caps words or capitalized sequences
function extractNames(text: string): string[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 2 && l.trim().length < 50);
  const potentialNames = lines.filter(
    (line) =>
      /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(line.trim()) ||
      /^[A-Z]{2,}(\s+[A-Z]{2,})*$/.test(line.trim())
  );
  return potentialNames.map((n) => n.trim()).slice(0, 3);
}

export default function PhotoCaptureRegistration({
  onExtract,
  isOpen,
  onClose,
}: PhotoCaptureRegistrationProps) {
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showExtraction, setShowExtraction] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [useCamera, setUseCamera] = useState(false);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setUseCamera(true);
      }
    } catch (err) {
      haptic("error");
      alert("Camera access denied or not available");
    }
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext("2d");
    if (!context) return;

    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);

    const imageData = canvasRef.current.toDataURL("image/jpeg");
    setPhotoData(imageData);
    setUseCamera(false);
    if (videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
    }
    haptic("success");
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target?.result as string;
      setPhotoData(imageData);
      haptic("success");
    };
    reader.readAsDataURL(file);
  }

  async function extractTextFromImage() {
    if (!photoData) return;
    setIsProcessing(true);
    try {
      // For now, provide UI hints to manually extract data
      // In production, integrate with OCR API (Google Vision, AWS Rekognition, or Tesseract.js)
      setShowExtraction(true);
      setExtractedText("📷 Photo captured.\n\nTap below to select name and phone from extracted data:");
    } catch (err) {
      haptic("error");
      setExtractedText(`Error: ${err instanceof Error ? err.message : "Processing failed"}`);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleNameSelect(name: string) {
    onExtract({ fullName: name });
    haptic("success");
    onClose();
  }

  function handlePhoneSelect(phone: string) {
    onExtract({ phone });
    haptic("success");
  }

  if (!isOpen) return null;

  const suggestedNames = extractedText ? extractNames(extractedText) : [];
  const suggestedPhones = extractedText ? extractPhones(extractedText) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center">
      <div className="w-full max-w-xl animate-in slide-in-from-bottom-5 rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Photo Registration</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600"
          >
            ✕
          </button>
        </div>

        {!photoData ? (
          <div className="space-y-3">
            {!useCamera ? (
              <>
                <button
                  onClick={startCamera}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  📸 Take photo
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  📁 Upload from gallery
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg bg-slate-900"
                  style={{ aspectRatio: "4/3" }}
                />
                <button
                  onClick={capturePhoto}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  ✓ Capture
                </button>
                <button
                  onClick={() => {
                    setUseCamera(false);
                    if (videoRef.current?.srcObject) {
                      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
                      tracks.forEach((track) => track.stop());
                    }
                  }}
                  className="text-center text-xs text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        ) : !showExtraction ? (
          <div className="space-y-3">
            <img src={photoData} alt="Captured" className="w-full rounded-lg" />
            <button
              onClick={extractTextFromImage}
              disabled={isProcessing}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {isProcessing && <Spinner size="sm" className="border-white/30 border-t-white" />}
              {isProcessing ? "Extracting…" : "Extract data from photo"}
            </button>
            <button
              onClick={() => {
                setPhotoData(null);
                setShowExtraction(false);
                setExtractedText("");
              }}
              className="text-center text-xs text-slate-500 hover:text-slate-700"
            >
              Take another photo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <img src={photoData} alt="Captured" className="w-full rounded-lg" />

            {suggestedNames.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">Select full name:</p>
                <div className="space-y-1">
                  {suggestedNames.map((name, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleNameSelect(name)}
                      className="flex w-full items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 hover:bg-blue-100"
                    >
                      <span>{name}</span>
                      <span>✓</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {suggestedPhones.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">Select phone number:</p>
                <div className="space-y-1">
                  {suggestedPhones.map((phone, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePhoneSelect(phone)}
                      className="flex w-full items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 hover:bg-emerald-100"
                    >
                      <span>{phone}</span>
                      <span>✓</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {suggestedNames.length === 0 && suggestedPhones.length === 0 && (
              <InlineNotice tone="warning">No text detected. Try a clearer photo or enter data manually.</InlineNotice>
            )}

            <button
              onClick={() => {
                setPhotoData(null);
                setShowExtraction(false);
                setExtractedText("");
              }}
              className="text-center text-xs text-slate-500 hover:text-slate-700"
            >
              Start over
            </button>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
