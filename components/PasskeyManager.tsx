"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Passkey = {
  credentialId: string;
  displayName: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string;
};

function shortDate(value: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(date);
}

export default function PasskeyManager({
  staffName,
  initialPasskeys,
}: {
  staffName: string;
  initialPasskeys: Passkey[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/home";
  const firstSetup = searchParams.get("first") === "1";
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function register() {
    if (busy || !supported) return;
    setBusy(true);
    setMessage(null);
    try {
      const startResponse = await fetch("/api/auth/webauthn/register/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok) throw new Error(startPayload?.error || "Biometric setup শুরু করা যায়নি।");
      const credential = await startRegistration({ optionsJSON: startPayload.options });
      const verifyResponse = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential, displayName: "Fingerprint / Face ID" }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyPayload?.ok) {
        throw new Error(verifyPayload?.error || "Biometric setup verify করা যায়নি।");
      }
      setMessage({ text: "Fingerprint / Face ID login চালু হয়েছে।", good: true });
      haptic("success");
      router.refresh();
      if (firstSetup) window.setTimeout(() => router.push(next), 650);
    } catch (error) {
      const text =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Setup বাতিল হয়েছে বা device verification শেষ হয়নি।"
          : error instanceof Error
            ? error.message
            : "Biometric setup ব্যর্থ হয়েছে।";
      setMessage({ text, good: false });
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(credentialId: string) {
    if (busy) return;
    if (!window.confirm("এই device/passkey থেকে Relife login বন্ধ করবেন?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Passkey remove করা যায়নি।");
      setMessage({ text: "Passkey বন্ধ করা হয়েছে।", good: true });
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Passkey remove ব্যর্থ হয়েছে।", good: false });
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Security</p>
            <h1 className="mt-1 text-2xl font-bold">Fingerprint / Face ID</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">{staffName} · device authenticator verifies you; PIN remains available as fallback.</p>
          </div>
          <StatusBadge tone={supported ? "success" : "warning"} className="border-white/10">{supported ? "Supported" : "PIN only"}</StatusBadge>
        </div>
      </section>

      {!supported && <InlineNotice tone="warning">এই browser-এ WebAuthn support পাওয়া যায়নি। PIN login ব্যবহার করুন।</InlineNotice>}

      {message && (
        <div className={message.good ? "relife-success-flash" : "relife-error-shake"}>
          <InlineNotice tone={message.good ? "success" : "error"}>{message.text}</InlineNotice>
        </div>
      )}

      <button
        type="button"
        onClick={register}
        disabled={busy || !supported}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none"
      >
        {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Setting up passkey" />}
        {busy ? "Working…" : initialPasskeys.length ? "+ Add another device/passkey" : "Set up Fingerprint / Face ID"}
      </button>

      {firstSetup && (
        <button type="button" onClick={() => router.push(next)} disabled={busy} className="min-h-12 w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Not now — continue with PIN</button>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-base font-semibold text-slate-900">Registered passkeys</h2><p className="mt-0.5 text-xs text-slate-500">Public-key records only</p></div>
          <StatusBadge tone={initialPasskeys.length ? "success" : "neutral"}>{initialPasskeys.length} devices</StatusBadge>
        </div>
        <div className="space-y-2">
          {initialPasskeys.map((item) => (
            <article key={item.credentialId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{item.displayName}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5"><StatusBadge tone="info">{item.deviceType || "passkey"}</StatusBadge>{item.backedUp && <StatusBadge tone="success">Synced</StatusBadge>}</div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">Added {shortDate(item.createdAt)} · Last used {shortDate(item.lastUsedAt)}</p>
                </div>
                <button type="button" onClick={() => revoke(item.credentialId)} disabled={busy} className="min-h-10 shrink-0 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50">Remove</button>
              </div>
            </article>
          ))}
          {initialPasskeys.length === 0 && <InlineNotice tone="neutral">No biometric/passkey login configured yet.</InlineNotice>}
        </div>
      </section>

      <p className="px-1 text-xs leading-5 text-slate-500">Relife stores credential public keys and security metadata. Biometric templates stay with the device/authenticator.</p>
    </div>
  );
}
