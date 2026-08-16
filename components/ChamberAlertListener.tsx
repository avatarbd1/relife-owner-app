"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type MessageAlert = {
  messageId: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  messageType: string;
  priority: string;
  body: string;
  bedId: string;
  roomId: string;
  status: string;
};

type AlertItem = {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  href: string;
};

type CommsResponse = {
  ok: boolean;
  pendingUrgentCount?: number;
  messages?: MessageAlert[];
};

const SEEN_KEY = "relife_chamber_seen_alerts_v2";
const SOUND_KEY = "relife_chamber_sound_enabled";
const MAX_SEEN = 120;
const CALL_PREFIX = "CALL:";
const ALERT_START_HOUR = 9;
const ALERT_END_HOUR = 21;

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string").slice(-MAX_SEEN)
      : [];
  } catch {
    return [];
  }
}

function soundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== "off";
}

function dhakaHour(ref = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ref);
  return Number(parts.find((part) => part.type === "hour")?.value || -1);
}

function withinChamberAlertHours(ref = new Date()): boolean {
  const hour = dhakaHour(ref);
  return hour >= ALERT_START_HOUR && hour < ALERT_END_HOUR;
}

function targetMatches(
  marker: string,
  currentStaffId: string,
  currentRoles: string[]
): boolean {
  const value = marker.trim();
  if (!value.startsWith(CALL_PREFIX)) return false;
  if (value.startsWith("CALL:STAFF:")) {
    return value.slice("CALL:STAFF:".length) === currentStaffId;
  }
  if (value.startsWith("CALL:ROLE:")) {
    const role = value.slice("CALL:ROLE:".length).trim().toLowerCase();
    return currentRoles.some((item) => item.trim().toLowerCase() === role);
  }
  return false;
}

export default function ChamberAlertListener({
  currentStaffId,
  currentRoles,
}: {
  currentStaffId: string;
  currentRoles: string[];
}) {
  const [alert, setAlert] = useState<AlertItem | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);
  const autoDismissRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const stopRing = useCallback(() => {
    stopRingRef.current?.();
    stopRingRef.current = null;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }, []);

  const dismissAlert = useCallback(() => {
    stopRing();
    if (autoDismissRef.current !== null) {
      window.clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    setAlert(null);
  }, [stopRing]);

  const ensureAudioContext = useCallback(async (): Promise<AudioContext | null> => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume().catch(() => undefined);
      }
      return audioContextRef.current;
    }
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    const context = new AudioCtor();
    await context.resume().catch(() => undefined);
    audioContextRef.current = context;
    return context;
  }, []);

  const playTenSecondCall = useCallback(async () => {
    stopRing();
    if (!soundEnabled()) return;
    const context = await ensureAudioContext();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([650, 250, 650, 650, 650, 250, 650, 650, 650, 250, 650, 650]);
    }
    if (!context || context.state !== "running") return;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.connect(context.destination);
    const oscillators: OscillatorNode[] = [];
    const startAt = context.currentTime + 0.03;

    for (let offset = 0; offset < 10; offset += 1.35) {
      const first = context.createOscillator();
      first.type = "sine";
      first.frequency.setValueAtTime(760, startAt + offset);
      first.connect(gain);
      first.start(startAt + offset);
      first.stop(startAt + offset + 0.36);
      oscillators.push(first);

      const second = context.createOscillator();
      second.type = "sine";
      second.frequency.setValueAtTime(610, startAt + offset + 0.4);
      second.connect(gain);
      second.start(startAt + offset + 0.4);
      second.stop(startAt + offset + 0.8);
      oscillators.push(second);
    }

    gain.gain.setValueAtTime(0.11, startAt);
    gain.gain.setValueAtTime(0.11, startAt + 9.85);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 10);

    const timeout = window.setTimeout(() => {
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
      stopRingRef.current = null;
    }, 10_100);

    stopRingRef.current = () => {
      window.clearTimeout(timeout);
      for (const oscillator of oscillators) {
        try {
          oscillator.stop();
        } catch {
          // already stopped
        }
      }
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    };
  }, [ensureAudioContext, stopRing]);

  const showSystemNotification = useCallback(async (item: AlertItem) => {
    if (document.visibilityState === "visible" || !("Notification" in window)) return;
    if (Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    if (!registration) return;
    await registration
      .showNotification(item.title, {
        body: item.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: item.id,
        requireInteraction: false,
        data: { url: item.href },
      })
      .catch(() => undefined);
  }, []);

  const processSnapshot = useCallback(async (payload: CommsResponse) => {
    const pendingCount = Number(payload.pendingUrgentCount || 0);
    window.dispatchEvent(
      new CustomEvent("relife-chamber-pending", { detail: pendingCount })
    );

    // Ring only explicitly targeted calls. Ordinary urgent Team messages and
    // equipment requests remain visible in Team, but never broadcast a phone call.
    const candidates: AlertItem[] = [];
    for (const message of payload.messages || []) {
      if (
        message.priority !== "Urgent" ||
        message.messageType === "Equipment" ||
        message.senderId === currentStaffId ||
        String(message.status || "Active").toLowerCase() !== "active" ||
        !targetMatches(message.roomId || "", currentStaffId, currentRoles)
      ) {
        continue;
      }
      candidates.push({
        id: `message:${message.messageId}`,
        createdAt: message.createdAt,
        title: `Chamber call · ${message.senderName || "Team"}`,
        body: `${message.body}${message.bedId ? ` · ${message.bedId}` : ""}`,
        href: "/chamber/chat",
      });
    }

    candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set(readSeen());
    const unseen = candidates.filter((item) => !seen.has(item.id));
    if (unseen.length === 0) return;

    // Calls created outside chamber hours are recorded in Team but deliberately
    // consumed silently so they do not ring later at 09:00.
    for (const item of unseen) seen.add(item.id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
    if (!withinChamberAlertHours()) return;

    const newest = unseen[0];
    if (!mountedRef.current) return;
    if (autoDismissRef.current !== null) {
      window.clearTimeout(autoDismissRef.current);
    }
    setAlert(newest);
    autoDismissRef.current = window.setTimeout(() => {
      stopRing();
      setAlert(null);
      autoDismissRef.current = null;
    }, 10_500);
    await Promise.allSettled([playTenSecondCall(), showSystemNotification(newest)]);
  }, [currentRoles, currentStaffId, playTenSecondCall, showSystemNotification, stopRing]);

  useEffect(() => {
    mountedRef.current = true;
    const prime = () => {
      void ensureAudioContext();
    };
    window.addEventListener("pointerdown", prime, { once: true, passive: true });
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pointerdown", prime);
      stopRing();
      if (autoDismissRef.current !== null) {
        window.clearTimeout(autoDismissRef.current);
        autoDismissRef.current = null;
      }
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [ensureAudioContext, stopRing]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch("/api/chamber/comms", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as CommsResponse;
        if (!cancelled && payload.ok) await processSnapshot(payload);
      } catch {
        // Keep alerts best-effort; the next poll retries.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [processSnapshot]);

  if (!alert) return null;

  return (
    <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-[70] mx-auto max-w-md overflow-hidden rounded-2xl border border-red-300 bg-white shadow-2xl">
      <div className="bg-red-600 px-4 py-2.5 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]">
          Direct Chamber call
        </p>
        <p className="mt-0.5 text-sm font-bold">{alert.title}</p>
      </div>
      <div className="p-4">
        <p className="text-sm leading-5 text-slate-700">{alert.body}</p>
        <p className="mt-1 text-[10px] font-semibold text-red-600">
          10-second call · auto closes
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              dismissAlert();
              window.location.href = alert.href;
            }}
            className="min-h-11 rounded-xl bg-red-600 px-3 text-xs font-bold text-white"
          >
            Open Chamber
          </button>
          <button
            type="button"
            onClick={dismissAlert}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
