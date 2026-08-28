"use client";

import { useState } from "react";
import type { PlatformOwnerSnapshot, PlatformClinicSummary } from "@/lib/data/platformOwner";

type OwnerSetup = {
  ownerStaffId: string;
  setupPath: string;
  expiresInSeconds: number;
  clinicStatus: string;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  snapshot?: PlatformOwnerSnapshot;
  ownerSetup?: OwnerSetup;
};

function setupStatusText(clinic: PlatformClinicSummary): string {
  if (clinic.clinicStatus === "active") return "Active · owner can use the workspace after device setup.";
  if (clinic.clinicStatus === "suspended") return "Suspended · owner setup links are disabled.";
  return "Setup · device can be enrolled now; daily clinic login stays blocked until activation.";
}

export default function ClinicOwnerAccessPanel({
  initialSnapshot,
}: {
  initialSnapshot: PlatformOwnerSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busyClinicId, setBusyClinicId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [links, setLinks] = useState<Record<string, { url: string; ownerStaffId: string; expiresInSeconds: number }>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/platform/clinics", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Refresh failed");
      setSnapshot(payload.snapshot);
    } catch (error) {
      setMessages((current) => ({
        ...current,
        __panel: error instanceof Error ? error.message : "Refresh failed",
      }));
    } finally {
      setRefreshing(false);
    }
  }

  async function generate(clinic: PlatformClinicSummary) {
    setBusyClinicId(clinic.clinicId);
    setMessages((current) => ({ ...current, [clinic.clinicId]: "" }));
    try {
      const response = await fetch("/api/platform/clinics", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "owner_setup_link",
          organizationId: clinic.organizationId,
          clinicId: clinic.clinicId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      const ownerSetup = payload.ownerSetup;
      if (!response.ok || !ownerSetup) {
        throw new Error(payload.error || "Owner setup link could not be generated");
      }
      if (payload.snapshot) setSnapshot(payload.snapshot);
      const url = `${window.location.origin}${ownerSetup.setupPath}`;
      setLinks((current) => ({
        ...current,
        [clinic.clinicId]: {
          url,
          ownerStaffId: ownerSetup.ownerStaffId,
          expiresInSeconds: ownerSetup.expiresInSeconds,
        },
      }));
      setMessages((current) => ({
        ...current,
        [clinic.clinicId]: ownerSetup.clinicStatus === "active"
          ? "Ready to send to the clinic owner."
          : "Device setup is allowed now; clinic workspace remains locked until activation.",
      }));
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [clinic.clinicId]: error instanceof Error ? error.message : "Owner setup link failed",
      }));
    } finally {
      setBusyClinicId(null);
    }
  }

  async function copyLink(clinicId: string) {
    const url = links[clinicId]?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessages((current) => ({ ...current, [clinicId]: "Setup link copied." }));
    } catch {
      setMessages((current) => ({ ...current, [clinicId]: "Copy failed. Select the link and copy it manually." }));
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Owner handoff</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Clinic owner access</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">
            Generate a short-lived first-device setup link. Send only this link to the clinic owner. Never send the Platform Owner PIN, Supabase credentials, GitHub access, or Render access.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="min-h-9 shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {messages.__panel ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{messages.__panel}</p>
      ) : null}

      <div className="mt-4 grid gap-3">
        {snapshot.clinics.map((clinic) => {
          const link = links[clinic.clinicId];
          const ownerStaffId = clinic.ownerStaffIds.length === 1 ? clinic.ownerStaffIds[0] : null;
          const disabled = clinic.clinicStatus === "suspended" || !ownerStaffId || clinic.ownerStaffIds.length !== 1;
          return (
            <article key={clinic.clinicId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-950">{clinic.clinicName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Owner: {ownerStaffId || "assignment required"}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{setupStatusText(clinic)}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled || busyClinicId === clinic.clinicId}
                  onClick={() => generate(clinic)}
                  className="min-h-9 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyClinicId === clinic.clinicId ? "Generating…" : link ? "Generate new link" : "Generate setup link"}
                </button>
              </div>

              {link ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
                  <p className="text-[11px] font-semibold text-emerald-800">
                    {link.ownerStaffId} · expires in {Math.round(link.expiresInSeconds / 60)} minutes
                  </p>
                  <p className="mt-2 break-all rounded-lg bg-slate-100 px-2 py-2 font-mono text-[10px] leading-4 text-slate-700">{link.url}</p>
                  <button
                    type="button"
                    onClick={() => copyLink(clinic.clinicId)}
                    className="mt-2 min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    Copy link
                  </button>
                </div>
              ) : null}

              {messages[clinic.clinicId] ? (
                <p className="mt-2 text-[11px] leading-4 text-slate-600">{messages[clinic.clinicId]}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
