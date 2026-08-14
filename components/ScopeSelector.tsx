"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type TouchEvent,
} from "react";
import type { Scope } from "@/lib/types";

const OPTIONS: { value: Scope; label: string; hint: string }[] = [
  { value: "combined", label: "Combined", hint: "Physio + Dental" },
  { value: "physio", label: "Physio", hint: "Physio only" },
  { value: "dental", label: "Dental", hint: "Dental only" },
];

function showOnPath(pathname: string): boolean {
  if (pathname === "/home") return true;
  if (pathname === "/patients" || pathname === "/patients/new") return true;
  return [
    "/finance",
    "/operations",
    "/appointments",
    "/reports",
    "/more",
    "/daily",
  ].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export default function ScopeSelector({
  current,
  allowed,
}: {
  current: Scope;
  allowed: Scope[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowedKey = allowed.join("|");
  const options = OPTIONS.filter((option) => allowed.includes(option.value));
  const initial = allowed.includes(current) ? current : allowed[0] ?? current;
  const [open, setOpen] = useState(false);
  const [displayScope, setDisplayScope] = useState<Scope>(initial);
  const [saving, setSaving] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const next = allowed.includes(current) ? current : allowed[0];
    if (next) setDisplayScope(next);
  }, [current, allowedKey]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!showOnPath(pathname) || options.length <= 1) return null;

  const label = options.find((option) => option.value === displayScope)?.label ?? options[0].label;
  const busy = saving || isPending;

  function haptic(ms = 8) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  }

  function toggle() {
    if (busy) return;
    haptic();
    setOpen((value) => !value);
  }

  async function select(scope: Scope) {
    if (!allowed.includes(scope) || scope === displayScope || busy) {
      setOpen(false);
      return;
    }

    const previous = displayScope;
    setDisplayScope(scope);
    setSaving(true);
    haptic(10);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);

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
      setOpen(true);
    } finally {
      setSaving(false);
    }
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartY.current = event.changedTouches[0]?.clientY ?? null;
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (touchStartY.current === null || busy) return;
    const endY = event.changedTouches[0]?.clientY ?? touchStartY.current;
    const delta = endY - touchStartY.current;
    touchStartY.current = null;

    if (delta > 28) {
      haptic();
      setOpen(true);
    } else if (delta < -28) {
      haptic();
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      aria-busy={busy}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Department scope: ${label}`}
        disabled={busy}
        className="flex min-h-11 min-w-[112px] select-none items-center justify-between gap-2 rounded-full border border-white/10 bg-white/10 px-3.5 text-sm font-semibold text-white shadow-sm backdrop-blur transition duration-150 active:scale-[0.97] active:bg-white/15 disabled:opacity-70"
      >
        <span className="truncate">{label}</span>
        <span
          aria-hidden="true"
          className={`text-xs text-slate-300 transition-transform duration-300 ${
            open ? "rotate-180" : "rotate-0"
          }`}
        >
          ▾
        </span>
      </button>

      <div
        role="listbox"
        aria-label="Choose department scope"
        className={`absolute right-0 top-[calc(100%+0.55rem)] z-30 w-56 origin-top overflow-hidden rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-slate-200 transition-[opacity,transform] duration-300 ease-out ${
          open
            ? "pointer-events-auto translate-y-0 scale-y-100 opacity-100"
            : "pointer-events-none -translate-y-2 scale-y-95 opacity-0"
        }`}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" aria-hidden="true" />
        {options.map((option) => {
          const active = option.value === displayScope;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => select(option.value)}
              disabled={busy}
              className={`mb-1 flex min-h-14 w-full select-none items-center justify-between rounded-xl px-3 text-left transition duration-100 last:mb-0 active:scale-[0.98] disabled:opacity-60 ${
                active
                  ? "bg-emerald-50 text-emerald-900"
                  : "text-slate-700 active:bg-slate-100"
              }`}
            >
              <span>
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">{option.hint}</span>
              </span>
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 place-items-center rounded-full text-xs transition duration-100 ${
                  active
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-transparent"
                }`}
              >
                ✓
              </span>
            </button>
          );
        })}
        <p className="px-2 pb-1 pt-1 text-center text-[10px] text-slate-400">
          Swipe up to close
        </p>
      </div>
    </div>
  );
}
