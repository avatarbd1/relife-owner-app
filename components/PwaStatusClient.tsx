"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InlineNotice, ProgressBar, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type Diagnostic = {
  online: boolean;
  https: boolean;
  swSupported: boolean;
  swRegistered: boolean;
  swScope: string;
  manifestOk: boolean;
  standalone: boolean;
  cacheNames: string[];
  storageUsed: number;
  storageQuota: number;
  loadMs: number;
};

const EMPTY: Diagnostic = {
  online: true,
  https: false,
  swSupported: false,
  swRegistered: false,
  swScope: "",
  manifestOk: false,
  standalone: false,
  cacheNames: [],
  storageUsed: 0,
  storageQuota: 0,
  loadMs: 0,
};

function bytes(value: number): string {
  if (!value) return "0 MB";
  return `${(value / 1024 / 1024).toFixed(value > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export default function PwaStatusClient() {
  const [data, setData] = useState<Diagnostic>(EMPTY);
  const [checking, setChecking] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    const swSupported = "serviceWorker" in navigator;
    let registration: ServiceWorkerRegistration | undefined;
    if (swSupported) {
      try {
        registration = await navigator.serviceWorker.getRegistration("/");
      } catch {
        registration = undefined;
      }
    }

    let manifestOk = false;
    try {
      const response = await fetch("/manifest.webmanifest", { cache: "no-store" });
      manifestOk = response.ok;
    } catch {
      manifestOk = false;
    }

    let cacheNames: string[] = [];
    try {
      if ("caches" in window) cacheNames = await caches.keys();
    } catch {
      cacheNames = [];
    }

    let storageUsed = 0;
    let storageQuota = 0;
    try {
      const estimate = await navigator.storage?.estimate?.();
      storageUsed = Number(estimate?.usage || 0);
      storageQuota = Number(estimate?.quota || 0);
    } catch {
      storageUsed = 0;
      storageQuota = 0;
    }

    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const loadMs = navEntry ? Math.max(0, Math.round(navEntry.loadEventEnd || navEntry.duration || 0)) : 0;

    setData({
      online: navigator.onLine,
      https: location.protocol === "https:",
      swSupported,
      swRegistered: Boolean(registration),
      swScope: registration?.scope || "",
      manifestOk,
      standalone: window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      cacheNames,
      storageUsed,
      storageQuota,
      loadMs,
    });
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
    const online = () => void check();
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", captureInstall);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      window.removeEventListener("beforeinstallprompt", captureInstall);
    };
  }, [check]);

  const storagePct = data.storageQuota > 0 ? (data.storageUsed / data.storageQuota) * 100 : 0;
  const isIOS = useMemo(() => /iphone|ipad|ipod/i.test(navigator.userAgent), []);
  const isAndroid = useMemo(() => /android/i.test(navigator.userAgent), []);

  async function install() {
    if (!installPrompt) return;
    setMessage(null);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setMessage(choice.outcome === "accepted" ? "✓ Install accepted" : "Install dismissed");
    haptic(choice.outcome === "accepted" ? "success" : "tap");
    await check();
  }

  async function updateServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    setUpdating(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration) throw new Error("Service worker is not registered");
      await registration.update();
      setMessage("✓ App update check completed");
      haptic("success");
      await check();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Update check failed"}`);
      haptic("error");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-4">
      {!data.online && (
        <InlineNotice tone="error" title="Offline mode">
          Clinic data is not trusted offline. Financial and clinical writes remain disabled until internet returns.
        </InlineNotice>
      )}
      {message && (
        <div className={message.startsWith("✓") ? "relife-success-flash" : message.startsWith("✕") ? "relife-error-shake" : ""}>
          <InlineNotice tone={message.startsWith("✓") ? "success" : message.startsWith("✕") ? "error" : "info"}>{message}</InlineNotice>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-slate-950">Install & runtime status</h2><p className="mt-0.5 text-xs text-slate-500">Real browser capabilities — no simulated health states.</p></div>
          {checking ? <Spinner label="Checking PWA" /> : <StatusBadge tone={data.online && data.https && data.swRegistered && data.manifestOk ? "success" : "warning"}>{data.standalone ? "Installed" : "Browser"}</StatusBadge>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Internet" value={data.online ? "Online" : "Offline"} tone={data.online ? "success" : "error"} />
          <Metric label="HTTPS" value={data.https ? "Secure" : "Missing"} tone={data.https ? "success" : "error"} />
          <Metric label="Manifest" value={data.manifestOk ? "Loaded" : "Failed"} tone={data.manifestOk ? "success" : "error"} />
          <Metric label="Service worker" value={data.swRegistered ? "Registered" : data.swSupported ? "Not registered" : "Unsupported"} tone={data.swRegistered ? "success" : "warning"} />
        </div>
        {data.swScope && <p className="mt-3 break-all text-[10px] text-slate-400">Scope: {data.swScope}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Install Relife</h2>
        <p className="mt-0.5 text-xs text-slate-500">Use the browser-supported install path for this device.</p>
        <div className="mt-4 space-y-3">
          {data.standalone ? (
            <InlineNotice tone="success">Relife is running in standalone/app mode.</InlineNotice>
          ) : installPrompt ? (
            <button type="button" onClick={install} className="min-h-11 w-full rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900">Install app</button>
          ) : isIOS ? (
            <InlineNotice tone="info" title="iPhone / iPad">Safari → Share → Add to Home Screen → Add. Then open Relife from the Home Screen.</InlineNotice>
          ) : isAndroid ? (
            <InlineNotice tone="info" title="Android">Browser menu → Install app / Add to Home screen. If the install item is not offered, use the diagnostics below to confirm HTTPS, manifest and service worker status.</InlineNotice>
          ) : (
            <InlineNotice tone="info">Use the browser address-bar install icon or menu → Install app when available.</InlineNotice>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">Cache & update</h2><p className="mt-0.5 text-xs text-slate-500">Only static install assets are cached; authenticated clinic data stays network-only.</p></div><StatusBadge tone="info">Safe cache</StatusBadge></div>
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p><strong>Cache sets:</strong> {data.cacheNames.length ? data.cacheNames.join(", ") : "None reported"}</p>
          <p className="mt-1"><strong>Data policy:</strong> API/navigation and financial/clinical data are fetched from the network.</p>
        </div>
        <button type="button" disabled={updating || !data.online || !data.swRegistered} onClick={updateServiceWorker} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50">
          {updating && <Spinner size="sm" label="Checking app update" />}
          {updating ? "Checking…" : "Check app update"}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Storage & performance</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Storage used" value={bytes(data.storageUsed)} tone="info" />
          <Metric label="Storage quota" value={data.storageQuota ? bytes(data.storageQuota) : "Unavailable"} tone="neutral" />
          <Metric label="Page load" value={data.loadMs ? `${data.loadMs} ms` : "Unavailable"} tone={data.loadMs > 3000 ? "warning" : "success"} />
          <Metric label="Mode" value={data.standalone ? "Standalone" : "Browser"} tone={data.standalone ? "success" : "info"} />
        </div>
        {data.storageQuota > 0 && <ProgressBar value={storagePct} label="Browser storage used" tone={storagePct > 85 ? "warning" : "primary"} className="mt-4" />}
        <button type="button" disabled={checking} onClick={() => void check()} className="mt-3 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Refresh diagnostics</button>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "error" | "info" | "neutral" }) {
  const classes = {
    success: "bg-emerald-50 text-emerald-900",
    warning: "bg-amber-50 text-amber-900",
    error: "bg-red-50 text-red-900",
    info: "bg-blue-50 text-blue-900",
    neutral: "bg-slate-50 text-slate-900",
  }[tone];
  return <div className={`rounded-lg p-3 ${classes}`}><p className="text-[10px] font-medium opacity-70">{label}</p><p className="mt-1 text-xs font-bold">{value}</p></div>;
}
