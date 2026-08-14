"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/home";

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      router.push(next);
      router.refresh();
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white">Relife Owner</h1>
          <p className="mt-1 text-sm text-slate-400">
            Owner PIN দিয়ে লগইন করুন
          </p>
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
            <p className="text-center text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => press(d)}
                className="rounded-2xl bg-slate-800 py-4 text-xl font-medium text-white active:bg-slate-700"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={backspace}
              className="rounded-2xl bg-slate-800 py-4 text-sm font-medium text-slate-300 active:bg-slate-700"
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={() => press("0")}
              className="rounded-2xl bg-slate-800 py-4 text-xl font-medium text-white active:bg-slate-700"
            >
              0
            </button>
            <button
              type="submit"
              disabled={pin.length === 0 || loading}
              className="rounded-2xl bg-emerald-600 py-4 text-sm font-medium text-white disabled:opacity-40 active:bg-emerald-700"
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
