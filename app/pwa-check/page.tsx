"use client";

import { useEffect, useState } from "react";

export default function PwaCheckPage() {
  const [status, setStatus] = useState("Checking PWA...");

  useEffect(() => {
    const run = async () => {
      const lines: string[] = [];
      lines.push(`HTTPS: ${location.protocol === "https:" ? "OK" : "FAIL"}`);
      lines.push(`Service worker API: ${"serviceWorker" in navigator ? "OK" : "FAIL"}`);
      try {
        const manifest = await fetch("/manifest.webmanifest", { cache: "no-store" });
        lines.push(`Manifest HTTP: ${manifest.status}`);
      } catch {
        lines.push("Manifest HTTP: FAIL");
      }
      try {
        const sw = await navigator.serviceWorker.getRegistration("/");
        lines.push(`Service worker registered: ${sw ? "YES" : "NO"}`);
        lines.push(`Service worker scope: ${sw?.scope ?? "none"}`);
      } catch {
        lines.push("Service worker registered: ERROR");
      }
      lines.push(`Standalone: ${window.matchMedia("(display-mode: standalone)").matches ? "YES" : "NO"}`);
      setStatus(lines.join("\n"));
    };
    void run();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <h1 className="mb-4 text-2xl font-bold">Relife PWA Check</h1>
      <pre className="whitespace-pre-wrap rounded-xl bg-white p-4 shadow">{status}</pre>
    </main>
  );
}
