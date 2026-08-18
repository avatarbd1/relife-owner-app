"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/FeedbackUI";
import TreatmentPhotoUpload from "@/components/TreatmentPhotoUpload";
import ClinicalAIAssistant from "@/components/ClinicalAIAssistant";
import { haptic } from "@/lib/interactions";
import { recordTreatment } from "@/app/(dashboard)/treatment/actions";

const TEMPLATES = {
  Physio: [
    "Initial Assessment",
    "Follow-up Session",
    "Strength Training",
    "Mobility Restoration",
    "Pain Management",
  ],
  Dental: [
    "Consultation",
    "Cleaning",
    "Restoration",
    "Extraction",
    "Root Canal Treatment",
  ],
};

interface TreatmentPhoto {
  id: string;
  file: File;
  preview: string;
  altText: string;
}

export default function TreatmentEntryForm({
  appointmentId,
  patientId,
  patientName,
  department,
  appointmentType,
  patientHistory,
  onSuccess,
}: {
  appointmentId: string;
  patientId: string;
  patientName: string;
  department: "Physio" | "Dental";
  appointmentType: string;
  patientHistory?: string;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [photos, setPhotos] = useState<TreatmentPhoto[]>([]);

  const [form, setForm] = useState({
    templateType: "",
    duration: "30",
    notes: "",
    followUpDate: "",
    clinicalOutcome: "Improved",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.templateType) {
      setError("Please select a treatment template");
      return;
    }

    if (!form.notes.trim()) {
      setError("Please enter treatment notes");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const duration = parseInt(form.duration) || 30;
      if (duration < 5 || duration > 480) {
        setError("Duration must be between 5 and 480 minutes");
        setLoading(false);
        return;
      }

      const result = await recordTreatment({
        appointmentId,
        patientId,
        department,
        templateType: form.templateType,
        duration,
        notes: form.notes,
        photos: photos.map((p) => ({
          altText: p.altText,
          file: p.file,
        })),
        followUpDate: form.followUpDate || undefined,
        clinicalOutcome: form.clinicalOutcome,
      });

      if (result.success) {
        haptic("success");
        setSuccess(`Treatment recorded for ${patientName}`);
        setForm({
          templateType: "",
          duration: "30",
          notes: "",
          followUpDate: "",
          clinicalOutcome: "Improved",
        });
        setPhotos([]);

        setTimeout(() => {
          onSuccess?.();
          router.refresh();
        }, 1500);
      } else {
        setError(result.error || "Failed to record treatment");
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Error recording treatment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{patientName}</p>
            <p className="text-xs text-slate-500">{patientId} • {department}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-600">Appointment Type</p>
            <p className="font-medium text-slate-900">{appointmentType}</p>
          </div>
        </div>
      </div>

      {/* Template Selection */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-900">
          Treatment Template *
        </label>
        <select
          value={form.templateType}
          onChange={(e) => setForm({ ...form, templateType: e.target.value })}
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Select a template...</option>
          {TEMPLATES[department].map((template) => (
            <option key={template} value={template}>
              {template}
            </option>
          ))}
        </select>
      </div>

      {/* AI Suggestions */}
      {form.templateType && (
        <ClinicalAIAssistant
          appointmentType={appointmentType}
          templateType={form.templateType}
          patientHistory={patientHistory}
          department={department}
          onSuggestionsLoad={() => {}}
        />
      )}

      {/* Duration & Outcome */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Duration (minutes) *
          </label>
          <input
            type="number"
            value={form.duration}
            onChange={(e) => setForm({ ...form, duration: e.target.value })}
            min="5"
            max="480"
            step="5"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Clinical Outcome
          </label>
          <select
            value={form.clinicalOutcome}
            onChange={(e) => setForm({ ...form, clinicalOutcome: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="Improved">Improved</option>
            <option value="Stable">Stable</option>
            <option value="Needs Review">Needs Review</option>
          </select>
        </div>
      </div>

      {/* Treatment Notes */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-900">
          Treatment Notes *
        </label>
        <p className="text-xs text-slate-500">Use markdown for formatting: **bold**, _italic_, - bullet</p>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Document observations, techniques used, patient response, recommendations..."
          rows={6}
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-100"
        />
        <p className="mt-1 text-xs text-slate-500">{form.notes.length} characters</p>
      </div>

      {/* Photos */}
      <TreatmentPhotoUpload
        onPhotosChange={setPhotos}
        maxPhotos={5}
      />

      {/* Follow-up Date */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-xs font-medium text-slate-600">
          Follow-up Appointment Date (optional)
        </label>
        <input
          type="date"
          value={form.followUpDate}
          onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* Error / Success */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          {success}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {loading && <Spinner size="sm" className="border-white/30 border-t-white" />}
        {loading ? "Recording treatment..." : "Record Treatment"}
      </button>
    </form>
  );
}
