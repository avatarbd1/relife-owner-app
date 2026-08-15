"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AppIcon from "@/components/AppIcon";
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
    setError(null);
    setPin((current) => (current + digit).slice(0, 6));
  }

  function backspace() {
    if (loading) return;
    setPin((current) => current.slice(0, -1));
  }

  function clearPin() {
    if (loading) return;
    setPin("");
    setError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length === 0) return;
    submit(pin);
  }

  if (setupOffer) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-5 py-8">
        <section className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200/60">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <AppIcon name="security" className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Optional secure sign-in
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
            Faster login চালু করবেন?
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            এই device-এ Fingerprint, Face ID, Windows Hello বা device passkey দিয়ে Relife খুলতে পারবেন। Owner PIN fallback থাকবে।
          </p>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() =>
                router.push(`/security/passkeys?first=1&next=${encodeURIComponent(next)}`)
              }
              className="min-h-11 w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] active:bg-blue-900"
            >
              Set up passkey
            </button>
            <button
              type="button"
              onClick={completeLogin}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition active:bg-slate-50"
            >
              Not now
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
      <section className="relative flex min-h-[34vh] flex-col justify-end overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-6 pb-8 pt-[max(env(safe-area-inset-top),2rem)] text-white lg:min-h-dvh lg:px-10 lg:pb-12">
        <div aria-hidden="true" className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

        <div className="relative max-w-md">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
            <AppIcon name="security" className="h-6 w-6 text-emerald-300" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-200">
            Relife Clinic OS
          </p>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.1] tracking-tight">
            Owner control center
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">
            Physio + Dental operations, finance, staff access and clinic oversight in one secure workspace.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-2 text-xs font-medium text-slate-200 ring-1 ring-white/10">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Secure owner access
          </div>
        </div>
      </section>

      <section className="px-5 py-6 sm:px-8 lg:flex lg:min-h-dvh lg:items-center lg:justify-center lg:px-10">
        <div className="mx-auto w-full max-w-sm lg:mx-0">
          <div className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-800">
              Authentication
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Owner PIN</h2>
            <p className="mt-1 text-sm text-slate-500">Enter your PIN using the secure keypad.</p>
          </div>

          <form onSubmit={onSubmit}>
            <div
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 shadow-sm"
              aria-label={`${pin.length} PIN digits entered`}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3 w-3 rounded-full border transition ${
                    i < pin.length
                      ? "border-blue-800 bg-blue-800"
                      : "border-slate-300 bg-slate-100"
                  }`}
                />
              ))}
            </div>

            {error && (
              <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-center text-sm font-medium text-red-700" role="alert">
                {error}
              </p>
            )}

            <div className="mt-5 grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  aria-label={`Enter ${digit}`}
                  onClick={() => press(digit)}
                  className="min-h-14 rounded-xl border border-slate-200 bg-white text-xl font-semibold text-slate-950 shadow-sm transition active:scale-[0.97] active:bg-slate-100"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={clearPin}
                className="min-h-14 rounded-xl border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-600 transition active:bg-slate-200"
              >
                Clear
              </button>
              <button
                type="button"
                aria-label="Enter 0"
                onClick={() => press("0")}
                className="min-h-14 rounded-xl border border-slate-200 bg-white text-xl font-semibold text-slate-950 shadow-sm transition active:scale-[0.97] active:bg-slate-100"
              >
                0
              </button>
              <button
                type="button"
                aria-label="Delete last PIN digit"
                onClick={backspace}
                className="min-h-14 rounded-xl border border-slate-200 bg-slate-100 text-lg font-semibold text-slate-700 transition active:bg-slate-200"
              >
                ⌫
              </button>
            </div>

            <button
              type="submit"
              disabled={pin.length === 0 || loading}
              className="mt-4 min-h-11 w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] active:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>Staff / passkey</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <BiometricLogin
            disabled={loading}
            onSuccess={completeLogin}
            onError={(message) => setError(message || null)}
          />

          <div className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">
            Owner access uses PIN. Registered staff devices can use the biometric/passkey button when supported.
          </div>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
