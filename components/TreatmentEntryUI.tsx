"use client";

import { useState, useEffect } from "react";
import { Spinner, InlineNotice } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

interface TreatmentEntryFormProps {
  patientId: string;
  patientName: string;
  appointmentId: string;
  therapistId: string;
  therapistName: string;
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}

interface TreatmentTemplate {
  id: string;
  name: string;
  category: string;
  content: string;
}

export function TreatmentEntryForm({
  patientId,
  patientName,
  appointmentId,
  therapistId,
  therapistName,
  department,
  onSuccess,
}: TreatmentEntryFormProps) {
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("30");
  const [templates, setTemplates] = useState<TreatmentTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await fetch(`/api/treatment?action=templates&department=${department}`);
        if (response.ok) {
          const data = await response.json();
          setTemplates(data || []);
        }
      } catch (err) {
        console.error("Failed to fetch templates:", err);
      }
    };

    fetchTemplates();
  }, [department]);

  const applyTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setNotes(template.content);
      setSelectedTemplate(templateId);
    }
  };

  const handleAddPhoto = (path: string) => {
    if (!photoPaths.includes(path)) {
      setPhotoPaths([...photoPaths, path]);
    }
  };

  const handleRemovePhoto = (path: string) => {
    setPhotoPaths(photoPaths.filter((p) => p !== path));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (!notes.trim()) {
        throw new Error("Treatment notes required");
      }

      const requestId = `treatment-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await fetch("/api/treatment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          patientId,
          appointmentId,
          therapistId,
          notes: notes.trim(),
          templateUsed: selectedTemplate || undefined,
          photoPaths: photoPaths.length > 0 ? photoPaths : undefined,
          duration: Number(duration),
          department,
          requestId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to record treatment");
      }

      haptic("success");
      setSuccess(true);

      setTimeout(() => {
        setSuccess(false);
        setNotes("");
        setDuration("30");
        setPhotoPaths([]);
        setSelectedTemplate("");
        if (onSuccess) {
          onSuccess();
        }
      }, 2000);
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-center">
        <p className="text-sm font-semibold text-green-900">✓ Treatment recorded</p>
        <p className="mt-1 text-xs text-green-700">{patientName}</p>
        <p className="mt-0.5 text-xs text-green-600">{duration} minutes</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Quick Templates</label>
        {templates.length > 0 ? (
          <div className="flex gap-2 mb-3 flex-wrap">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.id)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  selectedTemplate === template.id
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-900 hover:bg-slate-300"
                }`}
              >
                {template.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Treatment Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isLoading}
          placeholder="Describe treatment provided, patient response, any observations..."
          className="w-full h-32 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 resize-none"
        />
        <p className="mt-1 text-xs text-slate-500">{notes.length} / 5000 characters</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Duration (minutes)</label>
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          disabled={isLoading}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        >
          <option value="5">5 minutes</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">1 hour</option>
          <option value="90">1.5 hours</option>
          <option value="120">2 hours</option>
        </select>
      </div>

      {photoPaths.length > 0 && (
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-2">Attached Photos</label>
          <div className="grid grid-cols-3 gap-2">
            {photoPaths.map((path) => (
              <div key={path} className="relative">
                <div className="aspect-square bg-slate-200 rounded-lg flex items-center justify-center">
                  <span className="text-xs text-slate-600">📷</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePhoto(path)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading || !notes.trim()}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? <Spinner /> : "Save Treatment"}
        </button>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </form>
  );
}

interface TreatmentHistoryProps {
  patientId: string;
  department: "Physio" | "Dental";
}

export function TreatmentHistory({ patientId, department }: TreatmentHistoryProps) {
  const [entries, setEntries] = useState<Array<any>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/treatment?action=history&patientId=${patientId}&department=${department}`);
        if (response.ok) {
          const data = await response.json();
          setEntries(data.entries || []);
        }
      } catch (err) {
        setError("Failed to load treatment history");
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [patientId, department]);

  if (isLoading) {
    return <div className="flex items-center justify-center p-4"><Spinner /></div>;
  }

  if (entries.length === 0) {
    return <div className="text-center text-sm text-slate-500 p-4">No treatment entries yet</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.entryId} className="rounded-lg border border-slate-200 p-3">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{entry.therapistName}</p>
              <p className="text-xs text-slate-500">{entry.date}</p>
            </div>
            <p className="text-xs font-semibold text-slate-600">{entry.duration} min</p>
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{entry.notes}</p>
        </div>
      ))}
    </div>
  );
}
