"use client";

import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { createCaseStudy } from "@/app/(dashboard)/treatment/actions";

interface TreatmentRecord {
  id: string;
  date: string;
  patientName: string;
  templateType: string;
  notes: string;
  duration: number;
  outcome: string;
  photos?: string[];
}

export default function TreatmentCaseStudy({
  treatment,
  department,
  onSuccess,
}: {
  treatment: TreatmentRecord;
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: `${treatment.templateType} Case Study`,
    learnings: "",
    anonymize: true,
    shareableLink: false,
  });

  async function handlePublish() {
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }

    if (!form.learnings.trim()) {
      setError("Please describe learnings from this case");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await createCaseStudy({
        treatmentId: treatment.id,
        title: form.title,
        learnings: form.learnings,
        anonymize: form.anonymize,
        department,
      });

      if (result.success) {
        haptic("success");
        setForm({
          title: "",
          learnings: "",
          anonymize: true,
          shareableLink: false,
        });
        onSuccess?.();
      } else {
        setError(result.error || "Failed to create case study");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating case study");
    } finally {
      setLoading(false);
    }
  }

  function exportMarkdown() {
    const content = `# ${form.title}

**Template:** ${treatment.templateType}
**Department:** ${department}
**Date:** ${new Date(treatment.date).toLocaleDateString("en-BD")}

## Treatment Notes

${treatment.notes}

## Clinical Outcome

${treatment.outcome}

## Duration

${treatment.duration} minutes

## Key Learnings

${form.learnings}

---
*Case Study exported from Relife Clinic OS*
`;

    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `case-study-${Date.now()}.md`;
    a.click();
    haptic("success");
  }

  return (
    <div className="space-y-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div>
        <h3 className="text-sm font-bold text-purple-900">📚 Create Case Study</h3>
        <p className="text-xs text-purple-700">
          Convert this treatment into an educational case study for your team or learning
        </p>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-purple-900">Case Study Title</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="E.g., 'Successful Knee Rehabilitation After Surgery'"
          className="mt-1 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-300"
        />
      </div>

      {/* Learnings */}
      <div>
        <label className="block text-xs font-medium text-purple-900">
          Key Learnings & Insights *
        </label>
        <textarea
          value={form.learnings}
          onChange={(e) => setForm({ ...form, learnings: e.target.value })}
          placeholder="What did you learn from this case? What techniques were effective? What would you do differently?"
          rows={4}
          className="mt-1 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-300"
        />
      </div>

      {/* Options */}
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.anonymize}
            onChange={(e) => setForm({ ...form, anonymize: e.target.checked })}
            className="rounded border-slate-300"
          />
          <span className="text-xs text-purple-900">
            Anonymize patient name in published version
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.shareableLink}
            onChange={(e) => setForm({ ...form, shareableLink: e.target.checked })}
            className="rounded border-slate-300"
          />
          <span className="text-xs text-purple-900">
            Generate shareable link (visible to team)
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={exportMarkdown}
          disabled={loading}
          className="flex-1 rounded-lg border border-purple-300 bg-white px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-50"
        >
          📄 Export Markdown
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
        >
          {loading && <Spinner size="sm" className="border-white/30 border-t-white" />}
          {loading ? "Publishing..." : "✨ Publish Case Study"}
        </button>
      </div>
    </div>
  );
}
