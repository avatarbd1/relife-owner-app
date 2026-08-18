"use client";

import { useEffect, useRef, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

export type RegistrationExtractedDraft = {
  fullName: string;
  fatherHusbandName: string;
  phone: string;
  alternativePhone: string;
  age: string;
  gender: "Male" | "Female" | "";
  address: string;
  diagnosis: string;
  referral: string;
  remarks: string;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("IMAGE_PROCESSING_FAILED"));
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error("IMAGE_PROCESSING_FAILED"));
    image.src = dataUrl;
  });
}

function friendlyError(code: string): string {
  if (code === "AI_NOT_CONFIGURED") return "Photo extraction এখন configured নয়। Manual entry ব্যবহার করুন।";
  if (code === "INVALID_REGISTRATION_IMAGE") return "ছবিটি supported নয় বা অনেক বড়। JPG/PNG/WebP ব্যবহার করুন।";
  if (code === "ACCESS_DENIED") return "এই Department-এ patient create permission নেই।";
  if (code === "AI_PROVIDER_TIMEOUT") return "AI extraction timeout হয়েছে। আবার চেষ্টা করুন বা manual entry করুন।";
  return "ছবি থেকে draft extract করা যায়নি। Manual entry ব্যবহার করতে পারবেন।";
}

export default function PhotoCaptureRegistration({
  department,
  isOpen,
  onClose,
  onExtract,
}: {
  department: Department;
  isOpen: boolean;
  onClose: () => void;
  onExtract: (draft: RegistrationExtractedDraft) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [draft, setDraft] = useState<RegistrationExtractedDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  function reset() {
    stopCamera();
    setImageDataUrl("");
    setDraft(null);
    setBusy(false);
    setError("");
  }

  function close() {
    reset();
    onClose();
  }

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!isOpen) stopCamera();
  }, [isOpen]);

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOpen(true);
    } catch {
      setError("Camera access পাওয়া যায়নি। Gallery upload ব্যবহার করুন।");
      haptic("error");
    }
  }

  async function captureCamera() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) return;
    const canvas = document.createElement("canvas");
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setImageDataUrl(canvas.toDataURL("image/jpeg", 0.82));
    setDraft(null);
    stopCamera();
    haptic("success");
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("শুধু image file ব্যবহার করুন।");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const raw = await readFileAsDataUrl(file);
      const resized = await resizeImageDataUrl(raw);
      setImageDataUrl(resized);
      setDraft(null);
      haptic("success");
    } catch (fileError) {
      setError(fileError instanceof Error ? friendlyError(fileError.message) : "Image load failed");
      haptic("error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function extract() {
    if (!imageDataUrl || busy) return;
    setBusy(true);
    setDraft(null);
    setError("");
    try {
      const response = await fetch("/api/patients/extract-registration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ department, imageDataUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.draft) {
        throw new Error(String(payload.error || "AI_EXTRACTION_FAILED"));
      }
      setDraft(payload.draft as RegistrationExtractedDraft);
      haptic("success");
    } catch (extractError) {
      const code = extractError instanceof Error ? extractError.message : "AI_EXTRACTION_FAILED";
      setError(friendlyError(code));
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  const fields: Array<[string, string]> = draft
    ? [
        ["Name", draft.fullName],
        ["Father/Husband", draft.fatherHusbandName],
        ["Phone", draft.phone],
        ["Alternative", draft.alternativePhone],
        ["Age", draft.age],
        ["Gender", draft.gender],
        ["Address", draft.address],
        ["Diagnosis/complaint", draft.diagnosis],
        ["Referral", draft.referral],
        ["Remarks", draft.remarks],
      ].filter(([, value]) => Boolean(value))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/55 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Photo assisted registration">
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:max-w-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">AI-assisted draft</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Scan prescription / report</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{department} · AI only fills a draft. Review the registration form before saving.</p>
          </div>
          <button type="button" onClick={close} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100">Close</button>
        </div>

        {error && <div className="mt-4"><InlineNotice tone="warning">{error}</InlineNotice></div>}

        {!imageDataUrl && !cameraOpen && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={startCamera} className="min-h-12 rounded-xl bg-blue-800 px-3 text-sm font-semibold text-white">📷 Camera</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">Upload image</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void selectFile(event.currentTarget.files?.[0])} className="hidden" />
          </div>
        )}

        {cameraOpen && (
          <div className="mt-4 space-y-3">
            <video ref={videoRef} autoPlay playsInline className="aspect-[4/3] w-full rounded-xl bg-slate-950 object-cover" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void captureCamera()} className="min-h-12 rounded-xl bg-emerald-600 text-sm font-semibold text-white">Capture</button>
              <button type="button" onClick={stopCamera} className="min-h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">Cancel</button>
            </div>
          </div>
        )}

        {imageDataUrl && (
          <div className="mt-4 space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageDataUrl} alt="Registration source preview" className="max-h-72 w-full rounded-xl bg-slate-100 object-contain" />
            {!draft && (
              <button type="button" disabled={busy} onClick={() => void extract()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-3 text-sm font-semibold text-white disabled:opacity-50">
                {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Extracting registration draft" />}
                {busy ? "Extracting…" : "Extract draft from image"}
              </button>
            )}
            <button type="button" disabled={busy} onClick={reset} className="w-full text-xs font-semibold text-slate-500 underline">Use another image</button>
          </div>
        )}

        {draft && (
          <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold text-blue-950">Extracted draft</p><p className="mt-0.5 text-[10px] text-blue-700">Empty/uncertain fields are intentionally left blank.</p></div>
              <StatusBadge tone="warning">Review required</StatusBadge>
            </div>
            <div className="mt-3 space-y-2">
              {fields.map(([label, value]) => (
                <div key={label} className="rounded-lg bg-white/80 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">{label}</p><p className="mt-0.5 text-xs leading-5 text-slate-800">{value}</p></div>
              ))}
              {fields.length === 0 && <InlineNotice tone="neutral">নির্ভরযোগ্য field পাওয়া যায়নি। Manual entry করুন।</InlineNotice>}
            </div>
            <button
              type="button"
              onClick={() => { onExtract(draft); close(); haptic("success"); }}
              className="mt-3 min-h-12 w-full rounded-xl bg-blue-800 px-3 text-sm font-semibold text-white"
            >
              Use this draft in form
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
