"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppIcon from "@/components/AppIcon";

type Profile = {
  staffId: string;
  fullName: string;
  phone: string;
  roleLabel: string;
  departments: string[];
};

function Row({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: "security" | "staff" | "calendar" | "clinical";
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 active:bg-slate-50"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
        <AppIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-slate-500">{subtitle}</span>
      </span>
      <span aria-hidden className="text-xl font-light text-slate-300">›</span>
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{children}</div>
    </section>
  );
}

export default function V1SettingsClient({
  initialProfile,
  isOwner,
}: {
  initialProfile: Profile;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialProfile.fullName);
  const [phone, setPhone] = useState(initialProfile.phone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clinicConfiguration, setClinicConfiguration] = useState<null | {
    profile: { clinicName: string; clinicType: string; branchName: string; address: string; phone: string; email: string; logoUrl: string; timezone: string; currency: string; locale: string } | null;
    operatingHours: Array<{ dayOfWeek: number; isOpen: boolean; opensAt: string | null; closesAt: string | null }>;
    services: Array<{ serviceCode: string; displayName: string; price: number; isActive: boolean }>;
  }>(null);
  const [configurationError, setConfigurationError] = useState("");
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [configurationMessage, setConfigurationMessage] = useState("");

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    fetch("/api/settings/clinic", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.ok) throw new Error(String(payload.error || "CONFIGURATION_READ_FAILED"));
        setClinicConfiguration(payload.configuration);
      })
      .catch(() => active && setConfigurationError("Clinic configuration is unavailable; no default schedule or price was substituted."));
    return () => { active = false; };
  }, [isOwner]);

  function updateClinicProfile(field: string, value: string) {
    setClinicConfiguration((current) => current?.profile ? {
      ...current,
      profile: { ...current.profile, [field]: value },
    } : current);
  }

  function updateHour(dayOfWeek: number, field: "isOpen" | "opensAt" | "closesAt", value: boolean | string) {
    setClinicConfiguration((current) => current ? {
      ...current,
      operatingHours: current.operatingHours.map((day) => day.dayOfWeek === dayOfWeek ? {
        ...day,
        [field]: value,
        ...(field === "isOpen" && value === false ? { opensAt: null, closesAt: null } : {}),
        ...(field === "isOpen" && value === true && !day.opensAt ? { opensAt: "09:00", closesAt: "17:00" } : {}),
      } : day),
    } : current);
  }

  async function saveClinicConfiguration() {
    if (!clinicConfiguration?.profile || configurationBusy) return;
    setConfigurationBusy(true);
    setConfigurationError("");
    setConfigurationMessage("");
    try {
      const response = await fetch("/api/settings/clinic", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: clinicConfiguration.profile, operatingHours: clinicConfiguration.operatingHours }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || "CONFIGURATION_WRITE_FAILED"));
      setClinicConfiguration(payload.configuration);
      setConfigurationMessage("Clinic configuration updated");
      router.refresh();
    } catch (saveError) {
      setConfigurationError(saveError instanceof Error ? saveError.message : "Clinic configuration could not be saved.");
    } finally {
      setConfigurationBusy(false);
    }
  }

  const dirty = fullName.trim() !== initialProfile.fullName || phone.trim() !== initialProfile.phone;

  async function saveProfile() {
    if (busy || !dirty) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, phone }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        const code = String(payload.error || "PROFILE_UPDATE_FAILED");
        if (code === "PROFILE_PHONE_DUPLICATE") throw new Error("এই phone number অন্য staff-এর profile-এ আছে।");
        if (code === "INVALID_PROFILE_PHONE") throw new Error("সঠিক phone number দিন।");
        if (code === "PROFILE_NAME_REQUIRED") throw new Error("নাম কমপক্ষে 2 অক্ষরের হতে হবে।");
        throw new Error("Profile save করা যায়নি। আবার চেষ্টা করুন।");
      }
      setFullName(String(payload.profile?.fullName || fullName));
      setPhone(String(payload.profile?.phone || phone));
      setMessage("Profile updated");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Profile save করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <Card title="Account">
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-900 text-base font-bold text-white">
              {(fullName.trim()[0] || initialProfile.roleLabel[0] || "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-slate-900">{fullName || initialProfile.fullName}</p>
              <p className="text-xs text-slate-500">{initialProfile.roleLabel} · {initialProfile.staffId}</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Name</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-500"
              maxLength={120}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Phone</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-500"
              maxLength={18}
            />
          </label>

          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
          {message ? <p className="text-xs font-medium text-emerald-700">{message}</p> : null}

          <button
            type="button"
            onClick={saveProfile}
            disabled={busy || !dirty || fullName.trim().length < 2}
            className="h-12 w-full rounded-xl bg-slate-900 text-sm font-bold text-white active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
        <Row
          href="/security/passkeys"
          icon="security"
          title="Sign-in security"
          subtitle="Fingerprint, Face ID and passkeys currently protect this account"
        />
      </Card>

      {isOwner ? (
        <Card title="Clinic">
          {clinicConfiguration?.profile ? (
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
              {([
                ["clinicName", "Clinic name"], ["branchName", "Branch"], ["address", "Address"],
                ["phone", "Clinic phone"], ["email", "Clinic email"], ["logoUrl", "Logo URL"],
                ["timezone", "Timezone"], ["currency", "Currency"],
              ] as const).map(([field, label]) => (
                <label key={field} className={field === "address" || field === "logoUrl" ? "sm:col-span-2" : ""}>
                  <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
                  <input
                    value={clinicConfiguration.profile?.[field] || ""}
                    onChange={(event) => updateClinicProfile(field, event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-500"
                    maxLength={field === "address" || field === "logoUrl" ? 500 : 160}
                  />
                </label>
              ))}
              <label>
                <span className="mb-1 block text-xs font-semibold text-slate-600">Clinic type</span>
                <select value={clinicConfiguration.profile.clinicType} onChange={(event) => updateClinicProfile("clinicType", event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                  <option value="physiotherapy">Physiotherapy</option><option value="dental">Dental</option><option value="doctor_chamber">Doctor chamber</option><option value="other">Other</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-slate-600">Locale</span>
                <input value={clinicConfiguration.profile.locale} onChange={(event) => updateClinicProfile("locale", event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" maxLength={20} />
              </label>
            </div>
          ) : <p className="px-4 py-3 text-xs text-red-600">Clinic profile is not configured. No Relife defaults were substituted.</p>}
          <Row
            href="/security/staff-access"
            icon="staff"
            title="Staff & roles"
            subtitle="Add, edit, deactivate and assign clinic access"
          />
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
                <AppIcon name="calendar" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Working hours</p>
                <div className="mt-2 space-y-2">
                  {clinicConfiguration?.operatingHours.map((day) => (
                    <div key={day.dayOfWeek} className="grid grid-cols-[3rem_4rem_1fr_1fr] items-center gap-2 text-xs">
                      <span>Day {day.dayOfWeek}</span>
                      <input type="checkbox" aria-label={`Day ${day.dayOfWeek} open`} checked={day.isOpen} onChange={(event) => updateHour(day.dayOfWeek, "isOpen", event.target.checked)} />
                      <input type="time" aria-label={`Day ${day.dayOfWeek} opens`} disabled={!day.isOpen} value={day.opensAt?.slice(0, 5) || ""} onChange={(event) => updateHour(day.dayOfWeek, "opensAt", event.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 disabled:bg-slate-50" />
                      <input type="time" aria-label={`Day ${day.dayOfWeek} closes`} disabled={!day.isOpen} value={day.closesAt?.slice(0, 5) || ""} onChange={(event) => updateHour(day.dayOfWeek, "closesAt", event.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 disabled:bg-slate-50" />
                    </div>
                  )) || <p>Loading tenant configuration…</p>}
                </div>
                <p className="text-[11px] leading-4 text-slate-400">Clinic timezone and the seven-day schedule are read from the canonical configuration.</p>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
                <AppIcon name="clinical" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Services</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{clinicConfiguration ? clinicConfiguration.services.filter((service) => service.isActive).map((service) => `${service.displayName} · ${clinicConfiguration.profile?.currency || ""} ${service.price}`).join(" · ") || "No active services configured" : "Loading tenant services…"}</p>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 p-4">
            {configurationError ? <p className="mb-2 text-xs font-medium text-red-600">{configurationError}</p> : null}
            {configurationMessage ? <p className="mb-2 text-xs font-medium text-emerald-700">{configurationMessage}</p> : null}
            <button type="button" onClick={saveClinicConfiguration} disabled={!clinicConfiguration?.profile || configurationBusy} className="h-11 w-full rounded-xl bg-slate-900 text-sm font-bold text-white disabled:opacity-40">
              {configurationBusy ? "Saving…" : "Save clinic configuration"}
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Notifications">
        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">No fake email switches</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Email handover and new-device alerts will be added only when a real mail delivery + account email path is connected. Current cash handover remains visible inside the app.
          </p>
        </div>
      </Card>
    </div>
  );
}
