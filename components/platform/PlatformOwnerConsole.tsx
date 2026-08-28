"use client";

import { useMemo, useState } from "react";
import {
  PLATFORM_PLANS,
  type PlatformPlanCode,
  type ClinicType,
} from "@/lib/domain/platform/platformOwnerMvp";
import type {
  PlatformClinicSummary,
  PlatformFeatureCatalogRow,
  PlatformOwnerSnapshot,
} from "@/lib/data/platformOwner";

type ApiResponse = { ok: boolean; error?: string; snapshot?: PlatformOwnerSnapshot };

const CLINIC_TYPES: Array<{ value: ClinicType; label: string }> = [
  { value: "physiotherapy", label: "Physiotherapy" },
  { value: "dental", label: "Dental" },
  { value: "doctor_chamber", label: "Doctor chamber" },
  { value: "other", label: "Other" },
];

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

async function jsonRequest(method: "POST" | "PATCH", body: unknown): Promise<ApiResponse> {
  const response = await fetch("/api/platform/clinics", {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

function StatusPill({ clinic }: { clinic: PlatformClinicSummary }) {
  const label = clinic.readinessStatus === "READY_FOR_VERIFICATION"
    ? "Ready for verification"
    : clinic.readinessStatus === "SETUP_REQUIRED"
      ? "Setup required"
      : clinic.readinessStatus === "SUSPENDED"
        ? "Suspended"
        : "Active";
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">{label}</span>;
}

function FeaturePicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: PlatformFeatureCatalogRow[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {catalog.map((feature) => {
        const core = feature.moduleGroup === "core";
        const checked = core || selectedSet.has(feature.featureKey);
        return (
          <label key={feature.featureKey} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={checked}
              disabled={core}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(feature.featureKey); else next.delete(feature.featureKey);
                onChange([...next]);
              }}
              className="mt-0.5"
            />
            <span><span className="font-semibold">{feature.label}</span><span className="block text-[10px] text-slate-400">{feature.featureKey}</span></span>
          </label>
        );
      })}
    </div>
  );
}

function ClinicCard({
  clinic,
  catalog,
  mutate,
}: {
  clinic: PlatformClinicSummary;
  catalog: PlatformFeatureCatalogRow[];
  mutate: (body: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState(clinic.ownerStaffIds[0] || "");
  const [planCode, setPlanCode] = useState<PlatformPlanCode>((clinic.planCode as PlatformPlanCode) || "starter");
  const [trialDays, setTrialDays] = useState(30);
  const [features, setFeatures] = useState<string[]>(clinic.enabledFeatures);
  const [releaseSha, setReleaseSha] = useState(clinic.verifiedReleaseSha || "");
  const [clinicName, setClinicName] = useState(clinic.clinicName);
  const [clinicType, setClinicType] = useState<ClinicType>(clinic.clinicType || "other");
  const [timezone, setTimezone] = useState(clinic.timezone || "Asia/Dhaka");

  async function run(body: unknown) {
    setBusy(true); setError("");
    try { await mutate(body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed"); }
    finally { setBusy(false); }
  }

  const scope = { organizationId: clinic.organizationId, clinicId: clinic.clinicId };
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{clinic.organizationName}</p>
          <h3 className="mt-1 text-base font-bold text-slate-950">{clinic.clinicName}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{clinic.organizationSlug} / {clinic.clinicSlug}</p>
        </div>
        <StatusPill clinic={clinic} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-400">Owner</p><p className="mt-1 font-semibold text-slate-800">{clinic.ownerStaffIds.join(", ") || "Not assigned"}</p></div>
        <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-400">Plan</p><p className="mt-1 font-semibold text-slate-800">{clinic.planCode || "—"}</p></div>
        <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-400">Features</p><p className="mt-1 font-semibold text-slate-800">{clinic.enabledFeatures.length}</p></div>
        <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-400">Trial ends</p><p className="mt-1 font-semibold text-slate-800">{clinic.trialEndsAt ? new Date(clinic.trialEndsAt).toLocaleDateString() : "—"}</p></div>
      </div>

      {clinic.missingReadiness.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <span className="font-semibold">Readiness missing:</span> {clinic.missingReadiness.join(", ")}
        </div>
      )}
      {clinic.verifiedReleaseSha && <p className="mt-2 break-all text-[10px] text-emerald-700">Verified release: {clinic.verifiedReleaseSha}</p>}
      {error && <p className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs font-medium text-red-700">{error}</p>}

      <details className="mt-4 rounded-xl border border-slate-200">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-slate-800">Configure clinic</summary>
        <div className="space-y-4 border-t border-slate-100 p-3">
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Profile</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Clinic name" />
              <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={clinicType} onChange={(e) => setClinicType(e.target.value as ClinicType)}>{CLINIC_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
              <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Dhaka" />
            </div>
            <button disabled={busy} onClick={() => run({ action: "profile", ...scope, profile: { clinicName, clinicType, branchName: clinicName, address: "", phone: "", email: "", currency: "BDT", locale: "en", timezone } })} className="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save profile</button>
          </section>

          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Owner assignment</p>
            <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" value={ownerStaffId} onChange={(e) => setOwnerStaffId(e.target.value)} placeholder="Owner Staff ID" /><button disabled={busy} onClick={() => run({ action: "owner", ...scope, ownerStaffId })} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Assign</button></div>
          </section>

          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Trial, plan & features</p>
            <div className="mb-2 grid gap-2 sm:grid-cols-2">
              <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={planCode} onChange={(e) => { const plan = e.target.value as PlatformPlanCode; setPlanCode(plan); setFeatures([...PLATFORM_PLANS[plan].defaultFeatureKeys]); }}>{Object.values(PLATFORM_PLANS).map((plan) => <option key={plan.code} value={plan.code}>{plan.label} — ৳{plan.priceBdt}/mo</option>)}</select>
              <input type="number" min={1} max={90} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} />
            </div>
            <FeaturePicker catalog={catalog} selected={features} onChange={setFeatures} />
            <button disabled={busy} onClick={() => run({ action: "commercial", ...scope, planCode, trialDays, featureKeys: features })} className="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Apply trial & features</button>
          </section>

          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Lifecycle</p>
            {clinic.clinicStatus === "active" ? (
              <button disabled={busy} onClick={() => run({ action: "suspend", ...scope })} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Suspend clinic</button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row"><input className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs" value={releaseSha} onChange={(e) => setReleaseSha(e.target.value)} placeholder="Verified 40-char release SHA" /><button disabled={busy} onClick={() => run({ action: "activate", ...scope, releaseSha })} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Activate</button></div>
            )}
            <p className="mt-2 text-[10px] text-slate-400">Activation remains fail-closed unless verified readiness evidence exists for the exact release SHA.</p>
          </section>
        </div>
      </details>
    </article>
  );
}

export default function PlatformOwnerConsole({ initialSnapshot }: { initialSnapshot: PlatformOwnerSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [clinicSlug, setClinicSlug] = useState("");
  const [clinicType, setClinicType] = useState<ClinicType>("physiotherapy");
  const [ownerStaffId, setOwnerStaffId] = useState("");
  const [planCode, setPlanCode] = useState<PlatformPlanCode>("starter");
  const [trialDays, setTrialDays] = useState(30);
  const [features, setFeatures] = useState<string[]>([...PLATFORM_PLANS.starter.defaultFeatureKeys]);
  const [opensAt, setOpensAt] = useState("09:00");
  const [closesAt, setClosesAt] = useState("18:00");
  const [firstServiceName, setFirstServiceName] = useState("Consultation");
  const [firstServicePrice, setFirstServicePrice] = useState(0);

  async function mutate(body: unknown) {
    const payload = await jsonRequest("PATCH", body);
    if (payload.snapshot) setSnapshot(payload.snapshot);
  }

  async function createClinic() {
    setBusy(true); setError("");
    try {
      const payload = await jsonRequest("POST", {
        organizationName,
        organizationSlug: organizationSlug || slugify(organizationName),
        clinicName,
        clinicSlug: clinicSlug || slugify(clinicName),
        clinicType,
        timezone: "Asia/Dhaka",
        branchName: clinicName,
        address: "",
        phone: "",
        email: "",
        currency: "BDT",
        locale: "en",
        ownerStaffId,
        planCode,
        trialDays,
        featureKeys: features,
        openDays: [1, 2, 3, 4, 5, 6],
        opensAt,
        closesAt,
        firstServiceName,
        firstServicePrice,
        firstServiceDurationMin: 30,
      });
      if (payload.snapshot) setSnapshot(payload.snapshot);
      setOrganizationName(""); setOrganizationSlug(""); setClinicName(""); setClinicSlug(""); setOwnerStaffId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Clinic creation failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Clinics</p><p className="mt-1 text-2xl font-bold text-slate-950">{snapshot.clinics.length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Active</p><p className="mt-1 text-2xl font-bold text-slate-950">{snapshot.clinics.filter((c) => c.readinessStatus === "ACTIVE").length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Setup</p><p className="mt-1 text-2xl font-bold text-slate-950">{snapshot.clinics.filter((c) => c.readinessStatus === "SETUP_REQUIRED").length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Suspended</p><p className="mt-1 text-2xl font-bold text-slate-950">{snapshot.clinics.filter((c) => c.readinessStatus === "SUSPENDED").length}</p></div>
      </div>

      <details open className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-900">+ Add new clinic</summary>
        <div className="space-y-3 border-t border-slate-100 p-4">
          {error && <p className="rounded-xl bg-red-50 p-2.5 text-xs font-medium text-red-700">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={organizationName} onChange={(e) => { setOrganizationName(e.target.value); if (!organizationSlug) setOrganizationSlug(slugify(e.target.value)); }} placeholder="Business / organization name" />
            <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={organizationSlug} onChange={(e) => setOrganizationSlug(slugify(e.target.value))} placeholder="organization-slug" />
            <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={clinicName} onChange={(e) => { setClinicName(e.target.value); if (!clinicSlug) setClinicSlug(slugify(e.target.value)); }} placeholder="Clinic name" />
            <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={clinicSlug} onChange={(e) => setClinicSlug(slugify(e.target.value))} placeholder="clinic-slug" />
            <select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={clinicType} onChange={(e) => setClinicType(e.target.value as ClinicType)}>{CLINIC_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
            <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={ownerStaffId} onChange={(e) => setOwnerStaffId(e.target.value)} placeholder="Owner Staff ID" />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={planCode} onChange={(e) => { const plan = e.target.value as PlatformPlanCode; setPlanCode(plan); setFeatures([...PLATFORM_PLANS[plan].defaultFeatureKeys]); }}>{Object.values(PLATFORM_PLANS).map((plan) => <option key={plan.code} value={plan.code}>{plan.label} — ৳{plan.priceBdt}/mo</option>)}</select>
            <input type="number" min={1} max={90} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} aria-label="Trial days" />
            <div className="flex gap-2"><input type="time" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2 py-2 text-sm" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /><input type="time" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2 py-2 text-sm" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2"><input className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={firstServiceName} onChange={(e) => setFirstServiceName(e.target.value)} placeholder="First service" /><input type="number" min={0} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" value={firstServicePrice} onChange={(e) => setFirstServicePrice(Number(e.target.value))} placeholder="Price" /></div>
          <FeaturePicker catalog={snapshot.featureCatalog} selected={features} onChange={setFeatures} />
          <button type="button" disabled={busy} onClick={createClinic} className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Creating…" : "Create setup clinic"}</button>
          <p className="text-[10px] text-slate-400">Creates tenant/config/trial metadata only. It does not import or delete patient, clinical, finance, or historical operational data.</p>
        </div>
      </details>

      <div className="space-y-3">
        {snapshot.clinics.map((clinic) => <ClinicCard key={clinic.clinicId} clinic={clinic} catalog={snapshot.featureCatalog} mutate={mutate} />)}
        {snapshot.clinics.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No clinics provisioned yet.</div>}
      </div>
    </div>
  );
}
