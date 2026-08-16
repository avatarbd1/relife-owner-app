"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Relife dashboard render failed", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-xl py-8">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
          Live data unavailable
        </p>
        <h1 className="mt-2 text-xl font-bold text-amber-950">
          Clinic data could not be loaded safely.
        </h1>
        <p className="mt-2 text-sm leading-6 text-amber-900/80">
          Relife will not substitute demo or seed records for failed production data.
          Check the connection and retry.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 min-h-11 rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white active:scale-[0.98]"
        >
          Retry live data
        </button>
      </section>
    </div>
  );
}
