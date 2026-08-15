"use client";

import Link from "next/link";
import { useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Gender = "Male" | "Female" | "";

type ChamberPatientItem = {
  patientId: string;
  patientName: string;
  gender: Gender;
  chamberGender: Gender;
  state: "Waiting" | "In Treatment";
  station: string;
  warning: string;
};

function genderTone(gender: Gender): "info" | "success" | "warning" {
  if (gender === "Male") return "info";
  if (gender === "Female") return "success";
  return "warning";
}

export default function ChamberPatientEditPanel({
  initialItems,
  canEdit,
}: {
  initialItems: ChamberPatientItem[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState<{ good: boolean; text: string } | null>(null);

  async function setGender(patientId: string, gender: "Male" | "Female") {
    if (!canEdit || busyId) return;
    setBusyId(patientId);
    setMessage(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Gender update failed");
      }
      setItems((current) =>
        current.map((item) => item.patientId === patientId ? { ...item, gender, chamberGender: gender } : item)
      );
      const synced = payload?.chamberSynced !== false;
      setMessage({
        good: synced,
        text: synced
          ? `${patientId} gender updated to ${gender}. Live Chamber will use the corrected gender.`
          : `${patientId} profile updated, but the active chamber session did not sync. Refresh before starting treatment.`,
      });
      haptic(synced ? "success" : "error");
    } catch (error) {
      setMessage({ good: false, text: error instanceof Error ? error.message : "Gender update failed" });
      haptic("error");
    } finally {
      setBusyId("");
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Patient correction</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            Gender drives room/bed safety. Correct the patient master here before Receive/Start if needed.
          </p>
        </div>
        <StatusBadge tone={canEdit ? "info" : "neutral"}>{canEdit ? "Editable" : "View only"}</StatusBadge>
      </div>

      {message && (
        <div className={`mt-3 ${message.good ? "relife-success-flash" : "relife-error-shake"}`}>
          <InlineNotice tone={message.good ? "success" : "warning"}>{message.text}</InlineNotice>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {items.map((item) => {
          const mismatch = Boolean(item.gender && item.chamberGender && item.gender !== item.chamberGender);
          return (
            <article key={`${item.state}-${item.patientId}`} className={`rounded-xl border p-3 ${mismatch || !item.gender ? "border-amber-200 bg-amber-50/60" : "border-slate-100 bg-slate-50"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.patientName || item.patientId}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {item.patientId} · {item.state}{item.station ? ` · ${item.station}` : ""}
                  </p>
                </div>
                <StatusBadge tone={genderTone(item.gender)}>{item.gender || "Gender needed"}</StatusBadge>
              </div>

              {item.warning && <p className="mt-2 text-[11px] font-medium text-amber-800">{item.warning}</p>}
              {mismatch && <p className="mt-2 text-[11px] font-semibold text-red-700">Chamber session gender mismatch detected.</p>}

              <div className="mt-3 grid grid-cols-3 gap-2">
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busyId) || item.gender === "Male"}
                      onClick={() => setGender(item.patientId, "Male")}
                      className={`flex min-h-11 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold ${item.gender === "Male" ? "border-blue-700 bg-blue-800 text-white" : "border-blue-200 bg-white text-blue-800 hover:bg-blue-50"}`}
                    >
                      {busyId === item.patientId && <Spinner size="sm" label="Updating gender" />}
                      Male
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyId) || item.gender === "Female"}
                      onClick={() => setGender(item.patientId, "Female")}
                      className={`flex min-h-11 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold ${item.gender === "Female" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"}`}
                    >
                      {busyId === item.patientId && <Spinner size="sm" label="Updating gender" />}
                      Female
                    </button>
                    <Link
                      href={`/patients/${encodeURIComponent(item.patientId)}?edit=1#patient-edit`}
                      className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Edit file
                    </Link>
                  </>
                ) : (
                  <Link
                    href={`/patients/${encodeURIComponent(item.patientId)}`}
                    className="col-span-3 flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    View patient file
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
