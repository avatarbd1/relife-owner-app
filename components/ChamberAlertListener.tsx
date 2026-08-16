"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type EquipmentAlert = {
  requestId: string;
  createdAt: string;
  requestedById: string;
  requestedByName: string;
  resourceName: string;
  fromLocation: string;
  toLocation: string;
  patientName: string;
  bedId: string;
  status: string;
};

type MessageAlert = {
  messageId: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  messageType: string;
  priority: string;
  body: string;
  bedId: string;
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
  equipmentRequests?: EquipmentAlert[];
  messages?: MessageAlert[];
};

const SEEN_KEY = "relife_chamber_seen_alerts_v1";
const SOUND_KEY = "relife_chamber_sound_enabled";
const MAX_SEEN = 120;

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(-MAX_SEEN) : [];
  } catch {
    return [];
  }
}

function soundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== "off";
}

export default function ChamberAlertListener({ currentStaffId }: { currentStaffId: string }) {
  const [alert, setAlert] = useState<AlertItem | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const stopRing = useCallback(() => {
    stopRingRef.current?.();
    stopRingRef.current = null;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(0);
  }, []);

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
      gain.disconnect();
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
    await registration.showNotification(item.title, {
      body: item.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: item.id,
      requireInteraction: true,
      data: { url: item.href },
    }).catch(() => undefined);
  }, []);

  const processSnapshot = useCallback(async (payload: CommsResponse) => {
    const pendingCount = Number(payload.pendingUrgentCount || 0);
    window.dispatchEvent(new CustomEvent("relife-chamber-pending", { detail: pendingCount }));

    const candidates: AlertItem[] = [];
    for (const request of payload.equipmentRequests || []) {
      if (request.status !== "Requested" || request.requestedById === currentStaffId) continue;
      candidates.push({
        id: `equipment:${request.requestId}`,
        createdAt: request.createdAt,
        title: `Equipment call · ${request.resourceName}`,
        body: `${request.fromLocation} → ${request.toLocation}${request.patientName ? ` · ${request.patientName}` : ""}${request.bedId ? ` · ${request.bedId}` : ""}`,
        href: "/chamber/chat?tab=equipment",
      });
    }
    for (const message of payload.messages || []) {
      if (message.priority !== "Urgent" || message.messageType === "Equipment" || message.senderId === currentStaffId) continue;
      candidates.push({
        id: `message:${message.messageId}`,
        createdAt: message.createdAt,
        title: `Urgent Chamber call · ${message.senderName || "Team"}`,
        body: `${message.body}${message.bedId ? ` · ${message.bedId}` : ""}`,
        href: "/chamber/chat",
      });
    }
    candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set(readSeen());
    const unseen = candidates.filter((item) => !seen.has(item.id));
    if (unseen.length === 0) return;

    for (const item of unseen) seen.add(item.id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
    const newest = unseen[0];
    if (!mountedRef.current) return;
    setAlert(newest);
    await Promise.allSettled([playTenSecondCall(), showSystemNotification(newest)]);
  }, [currentStaffId, playTenSecondCall, showSystemNotification]);

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
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]">Urgent Chamber call</p>
        <p className="mt-0.5 text-sm font-bold">{alert.title}</p>
      </div>
      <div className="p-4">
        <p className="text-sm leading-5 text-slate-700">{alert.body}</p>
        <p className="mt-1 text-[10px] font-semibold text-red-600">10-second call alert · tap an action to stop</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              stopRing();
              window.location.href = alert.href;
            }}
            className="min-h-11 rounded-xl bg-red-600 px-3 text-xs font-bold text-white"
          >
            Open Chamber
          </button>
          <button
            type="button"
            onClick={() => {
              stopRing();
              setAlert(null);
            }}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
