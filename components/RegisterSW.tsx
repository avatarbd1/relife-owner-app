"use client";

import { useEffect } from "react";

/**
 * Registers the minimal service worker in public/sw.js.
 * This is what makes Chrome/Android treat the site as an installable PWA
 * (proper "Install app" / "Add to Home screen" behavior with the manifest
 * icons, instead of a plain bookmark shortcut).
 */
export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: app still works fine as a normal website if this fails.
    });
  }, []);

  return null;
}
