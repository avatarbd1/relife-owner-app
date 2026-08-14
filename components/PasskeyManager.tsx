"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

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
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function register() {
    if (busy || !supported) return;
    setBusy(true);
    setMessage("");
    try {
      const startResponse = await fetch("/api/auth/webauthn/register/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok) {
        throw new Error(startPayload?.error || "Biometric setup শুরু করা যায়নি।");
      }
      const credential = await startRegistration({
        optionsJSON: startPayload.options,
      });
      const verifyResponse = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential,
          displayName: "Fingerprint / Face ID",
        }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyPayload?.ok) {
        throw new Error(verifyPayload?.error || "Biometric setup verify করা যায়নি।");
      }
      setMessage("Fingerprint / Face ID login চালু হয়েছে।");
      if (navigator.vibrate) navigator.vibrate(12);
      router.refresh();
      if (firstSetup) {
        window.setTimeout(() => router.push(next), 650);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setMessage("Setup বাতিল হয়েছে বা device verification শেষ হয়নি।");
      } else {
        setMessage(error instanceof Error ? error.message : "Biometric setup ব্যর্থ হয়েছে।");
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(credentialId: string) {
    if (busy) return;
    if (!window.confirm("এই device/passkey থেকে Relife login বন্ধ করবেন?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Passkey remove করা যায়নি।");
      setMessage("Passkey বন্ধ করা হয়েছে।");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey remove ব্যর্থ হয়েছে।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">Security</p>
        <h1 className="mt-1 text-xl font-semibold">Fingerprint / Face ID</h1>
        <p className="mt-2 text-sm leading-5 text-slate-300">
          {staffName} · PIN fallback সবসময় থাকবে। Browser/device biometric, screen lock বা passkey দিয়ে verification করতে পারে।
        </p>
      </section>

      {!supported && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          এই browser-এ WebAuthn support পাওয়া যায়নি। PIN login ব্যবহার করুন।
        </section>
      )}

      {message && (
        <p className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200" role="status">
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={register}
        disabled={busy || !supported}
        className="min-h-12 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition duration-150 active:scale-[0.98] disabled:opacity-50 motion-reduce:transition-none"
      >
        {busy ? "Working..." : initialPasskeys.length ? "+ Add another device/passkey" : "Set up Fingerprint / Face ID"}
      </button>

      {firstSetup && (
        <button
          type="button"
          onClick={() => router.push(next)}
          disabled={busy}
          className="min-h-12 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 active:bg-slate-50 disabled:opacity-50"
        >
          Not now — continue with PIN
        </button>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Registered passkeys</h2>
            <p className="text-xs text-slate-400">Public-key records only</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
            {initialPasskeys.length}
          </span>
        </div>
        <div className="space-y-3">
          {initialPasskeys.map((item) => (
            <article key={item.credentialId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{item.displayName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.deviceType || "passkey"}{item.backedUp ? " · synced/backup eligible" : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Added {shortDate(item.createdAt)} · Last used {shortDate(item.lastUsedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(item.credentialId)}
                  disabled={busy}
                  className="min-h-10 shrink-0 rounded-xl border border-red-200 bg-white px-3 text-xs font-semibold text-red-600 active:bg-red-50 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
          {initialPasskeys.length === 0 && (
            <p className="py-5 text-center text-sm text-slate-400">No biometric/passkey login configured yet.</p>
          )}
        </div>
      </section>

      <p className="px-1 text-xs leading-5 text-slate-400">
        Relife stores the credential public key and security metadata. Your biometric template is handled by the device/authenticator and is not sent to Relife.
      </p>
    </div>
  );
}
