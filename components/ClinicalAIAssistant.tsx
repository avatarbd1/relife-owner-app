"use client";

import { useState, useEffect } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { generateAIAssessment } from "@/app/(dashboard)/treatment/actions";

interface AssessmentSuggestion {
  id: string;
  category: string;
  suggestion: string;
  reasoning: string;
}

export default function ClinicalAIAssistant({
  appointmentType,
  templateType,
  patientHistory,
  department,
  onSuggestionsLoad,
}: {
  appointmentType: string;
  templateType: string;
  patientHistory?: string;
  department: "Physio" | "Dental";
  onSuggestionsLoad: (suggestions: AssessmentSuggestion[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AssessmentSuggestion[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!appointmentType || !templateType) return;

    async function fetchSuggestions() {
      setLoading(true);
      setError("");
      try {
        const result = await generateAIAssessment({
          appointmentType,
          templateType,
          patientHistory: patientHistory || "",
          department,
        });

        if (result.success && result.suggestions) {
          setSuggestions(result.suggestions);
          onSuggestionsLoad(result.suggestions);
          haptic("success");
        } else {
          setError(result.error || "Failed to generate suggestions");
        }
      } catch (err) {
        setError("Error generating AI suggestions");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchSuggestions();
  }, [appointmentType, templateType, patientHistory, department, onSuggestionsLoad]);

  if (loading) {
    return (
      <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center gap-2">
          <Spinner size="sm" className="border-blue-300 border-t-blue-600" />
          <p className="text-sm font-semibold text-blue-900">🤖 Analyzing clinical context...</p>
        </div>
        <p className="text-xs text-blue-700">Generating assessment suggestions based on appointment type and history</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">⚠️ Could not load AI suggestions</p>
        <p className="text-xs text-amber-700">{error}</p>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div>
        <p className="text-sm font-semibold text-blue-900">🤖 AI Assessment Suggestions</p>
        <p className="text-xs text-blue-700">Review and incorporate these suggestions into your notes</p>
      </div>

      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <details
            key={suggestion.id}
            className="group cursor-pointer rounded border border-blue-200 bg-white p-3"
          >
            <summary className="flex items-start justify-between text-sm font-medium text-slate-900">
              <span>{suggestion.category}</span>
              <span className="text-blue-600">▾</span>
            </summary>
            <div className="mt-2 space-y-2 text-xs text-slate-700">
              <p className="leading-relaxed">{suggestion.suggestion}</p>
              <p className="italic text-slate-500">Reasoning: {suggestion.reasoning}</p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(suggestion.suggestion);
                  haptic("success");
                }}
                className="inline-block rounded bg-blue-100 px-2 py-1 text-blue-700 hover:bg-blue-200"
              >
                Copy to clipboard
              </button>
            </div>
          </details>
        ))}
      </div>

      <p className="text-[11px] text-blue-600">
        💡 Tips: Review all suggestions, accept helpful ones, modify as needed for clinical accuracy
      </p>
    </div>
  );
}
