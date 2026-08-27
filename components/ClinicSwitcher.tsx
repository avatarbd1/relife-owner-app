"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ClinicOption = {
  organizationId: string;
  organizationName: string;
  clinicId: string;
  clinicName: string;
};

export default function ClinicSwitcher({ current }: { current: ClinicOption }) {
  const router = useRouter();
  const [available, setAvailable] = useState<ClinicOption[]>([current]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (loaded || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tenant/selection", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "TENANT_LIST_FAILED"));
      setAvailable(Array.isArray(payload.available) ? payload.available : [current]);
      setLoaded(true);
    } catch {
      setError("Authorized clinics could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function select(value: string) {
    const next = available.find((option) => `${option.organizationId}:${option.clinicId}` === value);
    if (!next || next.clinicId === current.clinicId && next.organizationId === current.organizationId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tenant/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: next.organizationId, clinicId: next.clinicId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "TENANT_SELECTION_FAILED"));
      router.refresh();
    } catch {
      setError("Clinic switch was rejected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <label className="sr-only" htmlFor="active-clinic">Active clinic</label>
      <select
        id="active-clinic"
        aria-label="Active clinic"
        value={`${current.organizationId}:${current.clinicId}`}
        onFocus={load}
        onChange={(event) => select(event.target.value)}
        disabled={busy}
        className="h-8 max-w-[12rem] rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] font-semibold text-slate-100 outline-none focus:border-blue-400 disabled:opacity-60"
      >
        {available.map((option) => (
          <option key={`${option.organizationId}:${option.clinicId}`} value={`${option.organizationId}:${option.clinicId}`}>
            {option.organizationName} — {option.clinicName}
          </option>
        ))}
      </select>
      {error ? <p className="sr-only" role="alert">{error}</p> : null}
    </div>
  );
}
