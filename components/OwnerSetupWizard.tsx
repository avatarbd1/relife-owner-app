"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Profile = {
  clinicName: string;
  clinicType: string;
  branchName: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
  timezone: string;
  currency: string;
  locale: string;
  lifecycle: string;
};

type Hour = { dayOfWeek: number; isOpen: boolean; opensAt: string | null; closesAt: string | null };
type Service = {
  serviceCode: string;
  displayName: string;
  department: "Physio" | "Dental" | "All";
  price: number;
  durationMin: number;
  requiresBooking: boolean;
  requiresProvider: boolean;
  requiresResource: boolean;
  discountApplicable: boolean;
  taxApplicable: boolean;
  packageEligible: boolean;
  isActive: boolean;
};
type Feature = { featureKey: string; enabled: boolean; entitled: boolean };
type BookingMode = "simple" | "capacity" | "specific_resource";
type ImportEntity = "patients" | "appointments" | "services" | "staff";

type ClinicConfiguration = {
  profile: Profile | null;
  operatingHours: Hour[];
  services: Service[];
};

type FacilityConfiguration = {
  rooms: Array<{ roomCode: string; displayName: string }>;
  resources: Array<{ resourceCode: string; displayName: string; resourceType: string }>;
  booking: null | {
    bookingMode: BookingMode;
    defaultDurationMin: number;
    slotIntervalMin: number;
    maxSimultaneous: number | null;
    providerRequired: boolean;
    resourceRequired: boolean;
    blockDuplicatePatientOverlap: boolean;
    allowWalkIn: boolean;
    cancellationNoticeMin: number;
    lateArrivalGraceMin: number;
    capacityRules: Record<string, unknown>;
  };
};

const importTargets: Record<ImportEntity, string[]> = {
  patients: ["name", "phone", "email", "gender", "age", "address", "department"],
  appointments: ["patientId", "date", "time", "therapist", "remarks", "department"],
  services: ["name", "price", "serviceCode", "department", "durationMin"],
  staff: ["name", "role", "staffId", "email", "department"],
};

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-bold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ErrorText({ value }: { value: string }) {
  return value ? <p className="mt-2 text-xs font-semibold text-red-600">{value}</p> : null;
}

export default function OwnerSetupWizard() {
  const [clinic, setClinic] = useState<ClinicConfiguration | null>(null);
  const [facility, setFacility] = useState<FacilityConfiguration | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [useFacility, setUseFacility] = useState(false);
  const [roomCount, setRoomCount] = useState(1);
  const [resourcesPerRoom, setResourcesPerRoom] = useState(1);
  const [resourceType, setResourceType] = useState("BED");
  const [bookingMode, setBookingMode] = useState<BookingMode>("simple");
  const [duration, setDuration] = useState(30);
  const [slotInterval, setSlotInterval] = useState(30);
  const [maxSimultaneous, setMaxSimultaneous] = useState(1);
  const [providerRequired, setProviderRequired] = useState(true);
  const [allowWalkIn, setAllowWalkIn] = useState(true);

  const [serviceDraft, setServiceDraft] = useState<Service>({
    serviceCode: "",
    displayName: "",
    department: "All",
    price: 0,
    durationMin: 30,
    requiresBooking: true,
    requiresProvider: true,
    requiresResource: false,
    discountApplicable: true,
    taxApplicable: false,
    packageEligible: false,
    isActive: true,
  });

  const [importEntity, setImportEntity] = useState<ImportEntity>("patients");
  const [csvContent, setCsvContent] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/settings/clinic", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/settings/facility", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/settings/features", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([clinicPayload, facilityPayload, featurePayload]) => {
      if (!active) return;
      if (!clinicPayload.ok) throw new Error(String(clinicPayload.error || "Clinic configuration unavailable"));
      if (!facilityPayload.ok) throw new Error(String(facilityPayload.error || "Facility configuration unavailable"));
      if (!featurePayload.ok) throw new Error(String(featurePayload.error || "Feature configuration unavailable"));
      setClinic(clinicPayload.configuration);
      setFacility(facilityPayload.facility);
      setFeatures(featurePayload.features || []);
      const currentFacility = facilityPayload.facility as FacilityConfiguration;
      setUseFacility((currentFacility.rooms?.length || 0) > 0 || (currentFacility.resources?.length || 0) > 0);
      if (currentFacility.booking) {
        setBookingMode(currentFacility.booking.bookingMode);
        setDuration(currentFacility.booking.defaultDurationMin);
        setSlotInterval(currentFacility.booking.slotIntervalMin);
        setMaxSimultaneous(currentFacility.booking.maxSimultaneous || 1);
        setProviderRequired(currentFacility.booking.providerRequired);
        setAllowWalkIn(currentFacility.booking.allowWalkIn);
      }
    }).catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : "Setup data could not be loaded"));
    return () => { active = false; };
  }, []);

  const headers = useMemo(() => {
    const first = csvContent.replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim());
    if (!first) return [];
    return first.split(",").map((value) => value.trim().replace(/^"|"$/g, "")).filter(Boolean);
  }, [csvContent]);

  useEffect(() => {
    setMapping((current) => {
      const next: Record<string, string> = {};
      for (const header of headers) next[header] = current[header] || (importTargets[importEntity].includes(header) ? header : "");
      return next;
    });
  }, [headers, importEntity]);

  function resetNotice() {
    setError("");
    setMessage("");
  }

  async function saveClinic() {
    if (!clinic?.profile) return;
    resetNotice(); setBusy("clinic");
    try {
      const response = await fetch("/api/settings/clinic", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: clinic.profile, operatingHours: clinic.operatingHours }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "Clinic configuration save failed"));
      setClinic(payload.configuration);
      setMessage("Clinic profile and working hours saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Clinic configuration save failed");
    } finally { setBusy(""); }
  }

  async function saveFacility() {
    resetNotice(); setBusy("facility");
    try {
      const resourceRequired = bookingMode === "specific_resource";
      const booking = {
        bookingMode,
        defaultDurationMin: duration,
        slotIntervalMin: slotInterval,
        maxSimultaneous: bookingMode === "capacity" ? maxSimultaneous : null,
        providerRequired,
        resourceRequired,
        blockDuplicatePatientOverlap: true,
        allowWalkIn,
        cancellationNoticeMin: 0,
        lateArrivalGraceMin: 0,
        capacityRules: {},
      };
      const body = useFacility
        ? {
            bulk: {
              roomCount,
              resourcesPerRoom,
              resourceType,
              resourceCapacity: 1,
              isBookable: bookingMode === "specific_resource",
              isRuntimeOnly: bookingMode !== "specific_resource",
            },
            booking,
          }
        : { rooms: [], resources: [], booking: { ...booking, bookingMode: "simple", resourceRequired: false, maxSimultaneous: null } };
      const response = await fetch("/api/settings/facility", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "Facility configuration save failed"));
      setFacility(payload.facility);
      setMessage("Facility and booking rules saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Facility configuration save failed");
    } finally { setBusy(""); }
  }

  async function saveService() {
    resetNotice(); setBusy("service");
    try {
      const response = await fetch("/api/settings/services", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serviceDraft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "Service save failed"));
      setClinic((current) => current ? { ...current, services: payload.services || current.services } : current);
      setServiceDraft((current) => ({ ...current, serviceCode: "", displayName: "", price: 0 }));
      setMessage("Service saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Service save failed");
    } finally { setBusy(""); }
  }

  async function toggleFeature(feature: Feature) {
    resetNotice(); setBusy(`feature:${feature.featureKey}`);
    try {
      const response = await fetch("/api/settings/features", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ featureKey: feature.featureKey, enabled: !feature.enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "Feature update failed"));
      setFeatures(payload.features || []);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Feature update failed");
    } finally { setBusy(""); }
  }

  async function validateImport() {
    resetNotice(); setBusy("import"); setImportResult(null);
    try {
      const mappings = headers.map((header, sourceIndex) => ({ sourceIndex, sourceHeader: header, targetField: mapping[header] })).filter((row) => row.targetField);
      const response = await fetch("/api/onboarding/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: importEntity, csvContent, mappings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "Import validation failed"));
      setImportResult(payload);
      setMessage("Import validation finished. No data was mutated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Import validation failed");
    } finally { setBusy(""); }
  }

  async function runReadiness() {
    resetNotice(); setBusy("readiness"); setReadiness(null);
    try {
      const response = await fetch("/api/setup/clinic-validation", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "Readiness validation failed"));
      setReadiness(payload);
      setMessage(payload.isReady ? "Clinic is ready for the privileged activation gate." : "Clinic is not ready yet. Review the failed or unverified checks below.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Readiness validation failed");
    } finally { setBusy(""); }
  }

  const readinessChecks = readiness && typeof readiness.report === "object" && readiness.report
    ? Object.entries((readiness.report as { checks?: Record<string, { status?: string; evidence?: string[] }> }).checks || {})
    : [];

  if (!clinic && !error) return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading clinic setup…</div>;

  return (
    <div className="space-y-4 pb-10">
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}
      <ErrorText value={error} />

      <Panel title="1. Clinic profile & hours" description="Clinic identity, contact, timezone, currency and seven-day opening schedule.">
        {clinic?.profile ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["clinicName", "Clinic name"], ["branchName", "Branch"], ["address", "Address"], ["phone", "Phone"],
                ["email", "Email"], ["timezone", "Timezone"], ["currency", "Currency"], ["locale", "Locale"],
              ] as const).map(([field, label]) => (
                <label key={field} className={field === "address" ? "sm:col-span-2" : ""}>
                  <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
                  <input value={clinic.profile?.[field] || ""} onChange={(event) => setClinic((current) => current?.profile ? { ...current, profile: { ...current.profile, [field]: event.target.value } } : current)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
              ))}
              <label>
                <span className="mb-1 block text-xs font-semibold text-slate-600">Clinic type</span>
                <select value={clinic.profile.clinicType} onChange={(event) => setClinic((current) => current?.profile ? { ...current, profile: { ...current.profile, clinicType: event.target.value } } : current)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                  <option value="physiotherapy">Physiotherapy</option><option value="dental">Dental</option><option value="doctor_chamber">Doctor chamber</option><option value="other">Other</option>
                </select>
              </label>
            </div>
            <div className="space-y-2">
              {clinic.operatingHours.map((day, index) => (
                <div key={day.dayOfWeek} className="grid grid-cols-[3.2rem_3rem_1fr_1fr] items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-600">{dayNames[index] || `D${day.dayOfWeek}`}</span>
                  <input type="checkbox" checked={day.isOpen} onChange={(event) => setClinic((current) => current ? { ...current, operatingHours: current.operatingHours.map((row) => row.dayOfWeek === day.dayOfWeek ? { ...row, isOpen: event.target.checked, opensAt: event.target.checked ? row.opensAt || "09:00" : null, closesAt: event.target.checked ? row.closesAt || "17:00" : null } : row) } : current)} />
                  <input type="time" disabled={!day.isOpen} value={day.opensAt?.slice(0, 5) || ""} onChange={(event) => setClinic((current) => current ? { ...current, operatingHours: current.operatingHours.map((row) => row.dayOfWeek === day.dayOfWeek ? { ...row, opensAt: event.target.value } : row) } : current)} className="h-9 rounded-lg border border-slate-200 px-2 disabled:bg-slate-50" />
                  <input type="time" disabled={!day.isOpen} value={day.closesAt?.slice(0, 5) || ""} onChange={(event) => setClinic((current) => current ? { ...current, operatingHours: current.operatingHours.map((row) => row.dayOfWeek === day.dayOfWeek ? { ...row, closesAt: event.target.value } : row) } : current)} className="h-9 rounded-lg border border-slate-200 px-2 disabled:bg-slate-50" />
                </div>
              ))}
            </div>
            <button type="button" onClick={saveClinic} disabled={busy === "clinic"} className="h-11 w-full rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50">{busy === "clinic" ? "Saving…" : "Save clinic & hours"}</button>
          </div>
        ) : <p className="text-sm text-red-600">Clinic profile is not provisioned yet. Platform provisioning must create the canonical tenant before Owner setup can continue.</p>}
      </Panel>

      <Panel title="2. Facility & booking" description="Choose no rooms, capacity booking, or specific-resource booking without changing code.">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={useFacility} onChange={(event) => setUseFacility(event.target.checked)} /> This clinic uses rooms/resources</label>
          {useFacility ? <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1 block text-xs font-semibold">Rooms</span><input type="number" min={1} max={100} value={roomCount} onChange={(event) => setRoomCount(Number(event.target.value))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Resources / room</span><input type="number" min={1} max={100} value={resourcesPerRoom} onChange={(event) => setResourcesPerRoom(Number(event.target.value))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Resource type</span><select value={resourceType} onChange={(event) => setResourceType(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3"><option>BED</option><option>DENTAL_CHAIR</option><option>TREATMENT_TABLE</option><option>CABIN</option><option>ROOM</option><option>MACHINE</option><option>OTHER</option></select></label>
          </div> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1 block text-xs font-semibold">Booking mode</span><select value={useFacility ? bookingMode : "simple"} disabled={!useFacility} onChange={(event) => setBookingMode(event.target.value as BookingMode)} className="h-11 w-full rounded-xl border border-slate-200 px-3 disabled:bg-slate-50"><option value="simple">Simple/provider</option><option value="capacity">Capacity</option><option value="specific_resource">Specific resource</option></select></label>
            <label><span className="mb-1 block text-xs font-semibold">Duration (min)</span><input type="number" min={5} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Slot interval</span><input type="number" min={5} value={slotInterval} onChange={(event) => setSlotInterval(Number(event.target.value))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
          </div>
          {useFacility && bookingMode === "capacity" ? <label className="block"><span className="mb-1 block text-xs font-semibold">Maximum simultaneous bookings</span><input type="number" min={1} value={maxSimultaneous} onChange={(event) => setMaxSimultaneous(Number(event.target.value))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label> : null}
          <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={providerRequired} onChange={(event) => setProviderRequired(event.target.checked)} /> Provider required</label><label className="flex items-center gap-2"><input type="checkbox" checked={allowWalkIn} onChange={(event) => setAllowWalkIn(event.target.checked)} /> Allow walk-in</label></div>
          {facility ? <p className="text-xs text-slate-500">Current: {facility.rooms.length} rooms · {facility.resources.length} resources · {facility.booking?.bookingMode || "not configured"}</p> : null}
          <button type="button" onClick={saveFacility} disabled={busy === "facility"} className="h-11 w-full rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50">{busy === "facility" ? "Saving…" : "Save facility & booking"}</button>
        </div>
      </Panel>

      <Panel title="3. Services & prices" description="Create or update clinic-owned services. Relife prices are never substituted.">
        <div className="space-y-3">
          {clinic?.services?.length ? <div className="space-y-2">{clinic.services.map((service) => <button type="button" key={service.serviceCode} onClick={() => setServiceDraft(service)} className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left text-sm"><span><strong>{service.displayName}</strong><span className="ml-2 text-xs text-slate-400">{service.serviceCode}</span></span><span>{clinic.profile?.currency || ""} {service.price}</span></button>)}</div> : <p className="text-sm text-slate-500">No services configured yet.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="mb-1 block text-xs font-semibold">Service code</span><input value={serviceDraft.serviceCode} onChange={(event) => setServiceDraft((current) => ({ ...current, serviceCode: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Service name</span><input value={serviceDraft.displayName} onChange={(event) => setServiceDraft((current) => ({ ...current, displayName: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Price</span><input type="number" min={0} value={serviceDraft.price} onChange={(event) => setServiceDraft((current) => ({ ...current, price: Number(event.target.value) }))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Duration</span><input type="number" min={1} value={serviceDraft.durationMin} onChange={(event) => setServiceDraft((current) => ({ ...current, durationMin: Number(event.target.value) }))} className="h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label><span className="mb-1 block text-xs font-semibold">Department</span><select value={serviceDraft.department} onChange={(event) => setServiceDraft((current) => ({ ...current, department: event.target.value as Service["department"] }))} className="h-11 w-full rounded-xl border border-slate-200 px-3"><option>All</option><option>Physio</option><option>Dental</option></select></label>
          </div>
          <button type="button" onClick={saveService} disabled={busy === "service" || !serviceDraft.serviceCode.trim() || !serviceDraft.displayName.trim()} className="h-11 w-full rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50">{busy === "service" ? "Saving…" : "Save service"}</button>
        </div>
      </Panel>

      <Panel title="4. Staff & finance" description="Use the existing canonical staff and finance workflows; this wizard does not create a second writer.">
        <div className="grid gap-3 sm:grid-cols-2"><Link href="/security/staff-access" className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-900">Open Staff & Roles →</Link><Link href="/finance" className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-900">Open Finance →</Link></div>
      </Panel>

      <Panel title="5. Features" description="Owner may enable only modules already entitled by the commercial plan. Plan/entitlement assignment stays with Platform Admin.">
        <div className="space-y-2">{features.map((feature) => <div key={feature.featureKey} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2"><div><p className="text-sm font-semibold text-slate-900">{feature.featureKey}</p><p className="text-xs text-slate-400">{feature.entitled ? "Entitled" : "Not in current plan"}</p></div><button type="button" disabled={busy === `feature:${feature.featureKey}` || (!feature.entitled && !feature.enabled)} onClick={() => toggleFeature(feature)} className={`min-w-20 rounded-full px-3 py-2 text-xs font-bold ${feature.enabled ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"} disabled:opacity-40`}>{feature.enabled ? "Enabled" : "Disabled"}</button></div>)}</div>
      </Panel>

      <Panel title="6. Existing data import" description="Paste CSV, map columns, and validate every row. Current import remains preview-only by design; no data mutation is claimed.">
        <div className="space-y-3">
          <select value={importEntity} onChange={(event) => { setImportEntity(event.target.value as ImportEntity); setImportResult(null); }} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"><option value="patients">Patients</option><option value="appointments">Appointments</option><option value="services">Services</option><option value="staff">Staff</option></select>
          <textarea value={csvContent} onChange={(event) => setCsvContent(event.target.value)} rows={7} placeholder="name,phone\nPatient One,+8801..." className="w-full rounded-xl border border-slate-200 p-3 font-mono text-xs" />
          {headers.length ? <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Column mapping</p>{headers.map((header) => <div key={header} className="grid grid-cols-2 items-center gap-2 text-sm"><span className="truncate rounded-lg bg-slate-50 px-3 py-2">{header}</span><select value={mapping[header] || ""} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-2"><option value="">Skip</option>{importTargets[importEntity].map((target) => <option key={target} value={target}>{target}</option>)}</select></div>)}</div> : null}
          <button type="button" onClick={validateImport} disabled={busy === "import" || !csvContent.trim()} className="h-11 w-full rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50">{busy === "import" ? "Validating…" : "Validate import"}</button>
          {importResult ? <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">Rows: {String(importResult.totalRows || 0)} · Valid: {String(importResult.validRows || 0)} · Invalid: {String(importResult.invalidRows || 0)} · Can proceed: {String(importResult.canProceed || false)}</div> : null}
        </div>
      </Panel>

      <Panel title="7. Readiness & activation gate" description="Run the real fail-closed readiness engine. Privileged activation remains server/platform controlled and cannot be bypassed by the browser.">
        <button type="button" onClick={runReadiness} disabled={busy === "readiness"} className="h-11 w-full rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50">{busy === "readiness" ? "Checking…" : "Run readiness validation"}</button>
        {readinessChecks.length ? <div className="mt-3 space-y-2">{readinessChecks.map(([name, check]) => <div key={name} className="rounded-xl border border-slate-100 px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{name}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${check.status === "PASS" ? "bg-emerald-100 text-emerald-800" : check.status === "FAIL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{check.status || "UNVERIFIED"}</span></div>{check.evidence?.length ? <p className="mt-1 text-[11px] leading-4 text-slate-400">{check.evidence.join(" · ")}</p> : null}</div>)}</div> : null}
        <p className="mt-3 text-xs leading-5 text-slate-500">When every required check is PASS, the clinic is eligible for the existing privileged activation mechanism. The Owner UI intentionally does not receive service-role credentials or commercial entitlement authority.</p>
      </Panel>
    </div>
  );
}
