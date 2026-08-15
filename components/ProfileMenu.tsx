"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AppIcon from "@/components/AppIcon";

export default function ProfileMenu({
  roleLabel,
  isOwner,
}: {
  roleLabel: string;
  isOwner: boolean;
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
        className="grid h-10 w-10 place-items-center rounded-full border border-slate-700 bg-slate-800 text-sm font-semibold text-white transition active:scale-95 active:bg-slate-700"
      >
        {isOwner ? "O" : roleLabel.slice(0, 1).toUpperCase()}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Relife Clinic
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{roleLabel}</p>
          </div>

          <div className="p-2">
            <Link
              href="/security/passkeys"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 active:bg-slate-100"
            >
              <AppIcon name="security" className="h-5 w-5 text-slate-400" />
              Security & passkeys
            </Link>
            {isOwner && (
              <Link
                href="/security/staff-access"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 active:bg-slate-100"
              >
                <AppIcon name="staff" className="h-5 w-5 text-slate-400" />
                Staff access
              </Link>
            )}
            <Link
              href="/more"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 active:bg-slate-100"
            >
              <AppIcon name="more" className="h-5 w-5 text-slate-400" />
              More settings
            </Link>
          </div>

          <div className="border-t border-slate-100 p-2">
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={busy}
              className="flex min-h-12 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-red-600 active:bg-red-50 disabled:opacity-60"
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
