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
    if (scope === current) return;
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
      className="flex w-full rounded-full bg-slate-800 p-1 text-sm font-medium"
      role="tablist"
      aria-label="Department scope"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => select(opt.value)}
            disabled={isPending}
            className={`flex-1 rounded-full py-2 transition-colors ${
              active
                ? "bg-white text-slate-900"
                : "text-slate-300 active:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
