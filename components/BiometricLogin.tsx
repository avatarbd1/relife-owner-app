"use client";

import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

export default function BiometricLogin({
  disabled = false,
  onSuccess,
  onError,
}: {
  disabled?: boolean;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  if (!supported) return null;

  async function login() {
    if (busy || disabled) return;
    setBusy(true);
    onError("");
    try {
      const startResponse = await fetch("/api/auth/webauthn/authenticate/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok) {
        if (startPayload?.error === "NO_PASSKEYS_REGISTERED") {
          throw new Error("এখনো এই অ্যাপে Fingerprint / Face ID সেটআপ করা নেই। PIN ব্যবহার করুন।");
        }
        throw new Error("Biometric login শুরু করা যায়নি। PIN ব্যবহার করুন।");
      }

      const credential = await startAuthentication({
        optionsJSON: startPayload.options,
      });
      const verifyResponse = await fetch("/api/auth/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyPayload?.ok) {
        throw new Error("Biometric verification ব্যর্থ হয়েছে। PIN ব্যবহার করুন।");
      }
      onSuccess();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        onError("Biometric verification বাতিল হয়েছে বা সময় শেষ হয়েছে।");
      } else {
        onError(error instanceof Error ? error.message : "Biometric login ব্যর্থ হয়েছে।");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={login}
      disabled={busy || disabled}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition duration-150 active:scale-[0.98] active:bg-emerald-700 disabled:opacity-50 motion-reduce:transition-none"
    >
      <span aria-hidden="true">🔐</span>
      {busy ? "Verifying..." : "Fingerprint / Face ID"}
    </button>
  );
}
