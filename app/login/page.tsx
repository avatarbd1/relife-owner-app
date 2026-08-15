"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import BiometricLogin from "@/components/BiometricLogin";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const next =
    requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/home";

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupOffer, setSetupOffer] = useState(false);

  function completeLogin() {
    router.push(next);
    router.refresh();
  }

  async function submit(pinValue: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });
      if (!res.ok) {
        setError("ভুল PIN। আবার চেষ্টা করুন।");
        setPin("");
        return;
      }

      if (browserSupportsWebAuthn()) {
        try {
          const statusResponse = await fetch("/api/auth/webauthn/status", {
            cache: "no-store",
          });
          const status = await statusResponse.json().catch(() => ({}));
          if (statusResponse.ok && Number(status?.count || 0) === 0) {
            setSetupOffer(true);
            return;
          }
        } catch {
          // Biometric setup is optional. A status check failure must not block PIN login.
        }
      }
      completeLogin();
    } catch {
      setError("Network error. আবার চেষ্টা করুন।");
    } finally {
      setLoading(false);
    }
  }

  function press(digit: string) {
    if (loading) return;
    const updated = (pin + digit).slice(0, 6);
    setPin(updated);
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length === 0) return;
    submit(pin);
  }

  if (setupOffer) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 py-10">
        <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">🔐</div>
            <h1 className="mt-4 text-xl font-semibold text-slate-900">Faster login চালু করবেন?</h1>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              এই device-এ Fingerprint, Face ID, Windows Hello বা device passkey দিয়ে Relife খুলতে পারবেন। PIN fallback থাকবে।
            </p>
          </div>
          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={() =>
                router.push(`/security/passkeys?first=1&next=${encodeURIComponent(next)}`)
              }
              className="min-h-12 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:bg-emerald-700"
            >
              Set up now
            </button>
            <button
              type="button"
              onClick={completeLogin}
              className="min-h-12 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 active:bg-slate-200"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-semibold text-white">Relife Clinic</h1>
          <p className="mt-1 text-sm text-slate-400">Staff: Fingerprint / Face ID · Owner: PIN</p>
        </div>

        <div className="mb-5 space-y-3">
          <BiometricLogin
            disabled={loading}
            onSuccess={completeLogin}
            onError={(message) => setError(message || null)}
          />
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <span className="h-px flex-1 bg-slate-800" />
            <span>Owner PIN</span>
            <span className="h-px flex-1 bg-slate-800" />
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex justify-center gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className={`h-3.5 w-3.5 rounded-full border border-slate-500 ${
                  i < pin.length ? "bg-white" : "bg-transparent"
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="rounded-xl bg-red-950/40 px-3 py-2 text-center text-sm text-red-300" role="alert">
              {error}
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => press(d)}
                className="min-h-14 rounded-2xl bg-slate-800 py-4 text-xl font-medium text-white transition duration-100 active:scale-[0.97] active:bg-slate-700 motion-reduce:transition-none"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={backspace}
              className="min-h-14 rounded-2xl bg-slate-800 py-4 text-sm font-medium text-slate-300 active:bg-slate-700"
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={() => press("0")}
              className="min-h-14 rounded-2xl bg-slate-800 py-4 text-xl font-medium text-white active:bg-slate-700"
            >
              0
            </button>
            <button
              type="submit"
              disabled={pin.length === 0 || loading}
              className="min-h-14 rounded-2xl bg-emerald-600 py-4 text-sm font-medium text-white disabled:opacity-40 active:bg-emerald-700"
            >
              {loading ? "..." : "OK"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
