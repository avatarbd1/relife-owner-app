"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);

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
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-100 transition duration-150 active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none"
      aria-label="Log out"
    >
      {busy ? "..." : "Logout"}
    </button>
  );
}
