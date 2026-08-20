"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 10;

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function PatientReportUpload({ patientId }: { patientId: string }) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [message, setMessage] = useState("");

  function choose(nextFiles: FileList | null) {
    if (!nextFiles?.length || busy) return;

    const incoming = Array.from(nextFiles);
    const tooLarge = incoming.filter((file) => file.size > MAX_BYTES);
    const valid = incoming.filter((file) => file.size > 0 && file.size <= MAX_BYTES);

    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      const unique = valid.filter((file) => {
        const key = fileKey(file);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...unique].slice(0, MAX_FILES_PER_BATCH);
    });

    const duplicateCount = valid.length - new Set(valid.map(fileKey)).size;
    const overBatch = Math.max(0, files.length + valid.length - MAX_FILES_PER_BATCH);
    const notes: string[] = [];
    if (tooLarge.length) notes.push(`${tooLarge.length}টি file 12 MB-এর বেশি`);
    if (duplicateCount) notes.push(`${duplicateCount}টি duplicate বাদ গেছে`);
    if (overBatch) notes.push(`এক batch-এ সর্বোচ্চ ${MAX_FILES_PER_BATCH}টি file রাখা যায়`);
    setMessage(notes.length ? `⚠ ${notes.join(" • ")}` : "");

    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeFile(index: number) {
    if (busy) return;
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setMessage("");
  }

  async function upload() {
    if (!files.length || busy) return;

    const queued = [...files];
    const failed: File[] = [];
    const failedNames: string[] = [];
    let successCount = 0;

    setBusy(true);
    setUploadedCount(0);
    setMessage("");

    for (const file of queued) {
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
        successCount += 1;
      } catch (error) {
        failed.push(file);
        failedNames.push(
          `${file.name}: ${error instanceof Error ? error.message : "Upload failed"}`
        );
      } finally {
        setUploadedCount((count) => count + 1);
      }
    }

    setFiles(failed);
    setBusy(false);
    setUploadedCount(0);

    if (successCount === queued.length) {
      setMessage(`✓ ${successCount}টি report patient file-এ save হয়েছে`);
    } else if (successCount > 0) {
      setMessage(
        `⚠ ${successCount}/${queued.length}টি save হয়েছে। ${failed.length}টি failed—আবার Save reports চাপলে retry হবে।${failedNames.length ? ` (${failedNames.join("; ")})` : ""}`
      );
    } else {
      setMessage(`✕ Upload failed. ${failedNames.join("; ")}`);
    }

    if (successCount > 0) router.refresh();
  }

  const selectedBytes = files.reduce((total, file) => total + file.size, 0);
  const statusClass = message.startsWith("✓")
    ? "text-emerald-700"
    : message.startsWith("⚠")
      ? "text-amber-700"
      : "text-red-600";

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Patient report upload</h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          Camera দিয়ে ছবি তুলুন, অথবা gallery/PDF থেকে একসাথে সর্বোচ্চ {MAX_FILES_PER_BATCH}টি select করুন। প্রতি file সর্বোচ্চ 12 MB।
        </p>
      </div>

      <input
        ref={cameraRef}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => choose(event.target.files)}
      />
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        onChange={(event) => choose(event.target.files)}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy || files.length >= MAX_FILES_PER_BATCH}
          className="min-h-12 rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
        >
          📷 Camera
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || files.length >= MAX_FILES_PER_BATCH}
          className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 active:bg-slate-50 disabled:opacity-50"
        >
          🖼️ Photo / PDF
        </button>
      </div>

      {files.length > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-800">
              {files.length}/{MAX_FILES_PER_BATCH} selected
            </p>
            <p className="text-[11px] text-slate-500">
              {(selectedBytes / 1024 / 1024).toFixed(1)} MB total
            </p>
          </div>

          <div className="mt-2 space-y-2">
            {files.map((file, index) => (
              <div
                key={fileKey(file)}
                className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800">{file.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={busy}
                  aria-label={`Remove ${file.name}`}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 active:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={upload}
            disabled={busy}
            className="mt-3 min-h-12 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {busy
              ? `Uploading ${uploadedCount + 1}/${files.length}…`
              : files.length === 1
                ? "Save report"
                : `Save ${files.length} reports`}
          </button>
        </div>
      )}

      {message && (
        <p role="status" className={`mt-3 text-xs leading-5 ${statusClass}`}>
          {message}
        </p>
      )}
    </section>
  );
}
