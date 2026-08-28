"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AppIcon from "@/components/AppIcon";

export default function ProfileMenu({
  roleLabel,
  isOwner,
  isPlatformOwner = false,
}: {
  roleLabel: string;
  isOwner: boolean;
  isPlatformOwner?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="grid h-8 w-8 place-items-center rounded-full border border-slate-700 bg-slate-800 text-[11px] font-semibold text-white shadow-sm transition duration-150 active:scale-95 active:bg-slate-700"
      >
        {isOwner ? "O" : roleLabel.slice(0, 1).toUpperCase()}
      </button>

      <div
        role="menu"
        aria-hidden={!open}
        className={`absolute right-0 top-10 z-40 w-56 origin-top-right overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-[opacity,transform] duration-180 ease-out ${
          open
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
        }`}
      >
        <div className="border-b border-slate-100 px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Relife Clinic
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{roleLabel}</p>
        </div>

        <div className="p-1.5">
          {isPlatformOwner && (
            <Link
              href="/platform"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-blue-700 transition active:bg-blue-50"
            >
              <span className="grid h-5 w-5 place-items-center rounded-md bg-blue-50 text-[10px] font-bold">P</span>
              Platform Owner
            </Link>
          )}
          <Link
            href="/settings"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 transition active:bg-slate-100"
          >
            <AppIcon name="more" className="h-5 w-5 text-slate-400" />
            Account settings
          </Link>
        </div>

        <div className="border-t border-slate-100 p-1.5">
          <button
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={logout}
            disabled={busy}
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-red-600 transition active:bg-red-50 disabled:opacity-60"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}
