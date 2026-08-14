"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Scope } from "@/lib/types";

const OPTIONS: { value: Scope; label: string }[] = [
  { value: "combined", label: "Combined" },
  { value: "physio", label: "Physio" },
  { value: "dental", label: "Dental" },
];

export default function ScopeSelector({ current }: { current: Scope }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function select(scope: Scope) {
    if (scope === current || isPending) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(8);
    }
    await fetch("/api/scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div
      className="flex w-full rounded-2xl bg-slate-800 p-1 text-sm font-semibold"
      role="tablist"
      aria-label="Department scope"
      aria-busy={isPending}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => select(opt.value)}
            disabled={isPending}
            className={`min-h-12 flex-1 select-none rounded-xl px-2 transition duration-100 active:scale-[0.97] disabled:opacity-70 ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-300 active:bg-slate-700 active:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
