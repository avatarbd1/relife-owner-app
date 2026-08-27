"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Scope } from "@/lib/types";

const OPTIONS: { value: Scope; label: string }[] = [
  { value: "combined", label: "Combined" },
  { value: "physio", label: "Physio" },
  { value: "dental", label: "Dental" },
];

export default function ScopeSelector({
  current,
  allowed,
}: {
  current: Scope;
  allowed: Scope[];
}) {
  const router = useRouter();
  const options = OPTIONS.filter((option) => allowed.includes(option.value));
  const [displayScope, setDisplayScope] = useState<Scope>(
    allowed.includes(current) ? current : allowed[0] ?? current
  );
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();

  if (options.length <= 1) return null;
  const busy = saving || pending;

  async function select(scope: Scope) {
    if (busy || scope === displayScope || !allowed.includes(scope)) return;
    const previous = displayScope;
    setDisplayScope(scope);
    setSaving(true);
    try {
      const response = await fetch("/api/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!response.ok) throw new Error(`Scope update failed: ${response.status}`);
      startTransition(() => router.refresh());
    } catch (error) {
      console.error(error);
      setDisplayScope(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Department scope"
      aria-busy={busy}
      className="inline-flex w-full rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200"
    >
      {options.map((option) => {
        const active = option.value === displayScope;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={busy}
            onClick={() => select(option.value)}
            className={`min-h-10 flex-1 rounded-lg px-3 text-xs font-semibold transition disabled:opacity-60 ${
              active
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 active:bg-white/70"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
