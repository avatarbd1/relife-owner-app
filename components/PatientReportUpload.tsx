"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_BYTES = 12 * 1024 * 1024;

export default function PatientReportUpload({ patientId }: { patientId: string }) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function choose(next: File | undefined) {
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setFile(null);
      setMessage("File 12 MB-এর বেশি। ছোট file দিন।");
      return;
    }
    setFile(next);
    setMessage("");
  }

  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("patientId", patientId);
      form.set("file", file);
      const response = await fetch("/api/tools/report-upload", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `HTTP_${response.status}`);
      }
      setMessage("✓ Report patient file-এ save হয়েছে");
      setFile(null);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Upload failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Patient report upload</h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          Camera দিয়ে report-এর ছবি তুলুন, অথবা gallery/PDF থেকে দিন। Save হলে এই patient file-এই থাকবে।
        </p>
      </div>

      <input
        ref={cameraRef}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        onChange={(event) => choose(event.target.files?.[0])}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
          className="min-h-12 rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
        >
          📷 Camera
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 active:bg-slate-50 disabled:opacity-50"
        >
          🖼️ Photo / PDF
        </button>
      </div>

      {file && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <button
            type="button"
            onClick={upload}
            disabled={busy}
            className="mt-3 min-h-12 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Save report"}
          </button>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`mt-3 text-xs ${message.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
