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
  messageId: string;
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

const SOUND_KEY = "relife_chamber_sound_enabled";
const CALL_PREFIX = "CALL:";
const ALERT_START_HOUR = 9;
const ALERT_END_HOUR = 21;
const CALL_GAIN = 1;
const RING_INTERVAL_MS = 1_100;

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

function createdWithinChamberAlertHours(createdAt: string): boolean {
  const match = /(?:T|\s)(\d{2}):\d{2}/.exec(createdAt || "");
  if (!match) return false;
  const hour = Number(match[1]);
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

function isActiveCall(message: MessageAlert): boolean {
  return String(message.status || "Active").trim().toLowerCase() === "active";
}

export default function ChamberAlertListener({
  currentStaffId,
  currentRoles,
}: {
  currentStaffId: string;
  currentRoles: string[];
}) {
  const [alert, setAlert] = useState<AlertItem | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);
  const activeMessageIdRef = useRef("");
  const mountedRef = useRef(true);

  const stopRing = useCallback(() => {
    stopRingRef.current?.();
    stopRingRef.current = null;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(0);
    }
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

  const startPersistentCallRing = useCallback(async () => {
    stopRing();
    if (!soundEnabled()) return;

    const context = await ensureAudioContext();
    let stopped = false;
    const oscillators = new Set<OscillatorNode>();
    const toneGains = new Set<GainNode>();
    let masterGain: GainNode | null = null;
    let compressor: DynamicsCompressorNode | null = null;

    if (context) {
      masterGain = context.createGain();
      masterGain.gain.setValueAtTime(CALL_GAIN, context.currentTime);
      compressor = context.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-18, context.currentTime);
      compressor.knee.setValueAtTime(8, context.currentTime);
      compressor.ratio.setValueAtTime(12, context.currentTime);
      compressor.attack.setValueAtTime(0.003, context.currentTime);
      compressor.release.setValueAtTime(0.18, context.currentTime);
      masterGain.connect(compressor);
      compressor.connect(context.destination);
    }

    const pulse = async () => {
      if (stopped || !withinChamberAlertHours()) return;

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([700, 160, 700, 320]);
      }

      if (!context || !masterGain) return;
      if (context.state === "suspended") {
        await context.resume().catch(() => undefined);
      }
      if (context.state !== "running") return;

      const startAt = context.currentTime + 0.02;
      const scheduleTone = (frequency: number, offset: number, duration: number) => {
        const oscillator = context.createOscillator();
        const toneGain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(frequency, startAt + offset);
        toneGain.gain.setValueAtTime(0.0001, startAt + offset);
        toneGain.gain.exponentialRampToValueAtTime(0.95, startAt + offset + 0.012);
        toneGain.gain.setValueAtTime(0.95, startAt + offset + duration - 0.025);
        toneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + duration);
        oscillator.connect(toneGain);
        toneGain.connect(masterGain);
        oscillators.add(oscillator);
        toneGains.add(toneGain);
        oscillator.addEventListener(
          "ended",
          () => {
            oscillators.delete(oscillator);
            toneGains.delete(toneGain);
            try {
              oscillator.disconnect();
              toneGain.disconnect();
            } catch {
              // already disconnected
            }
          },
          { once: true }
        );
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + duration + 0.02);
      };

      scheduleTone(930, 0, 0.34);
      scheduleTone(690, 0.38, 0.38);
    };

    await pulse();
    const timer = window.setInterval(() => void pulse(), RING_INTERVAL_MS);

    stopRingRef.current = () => {
      stopped = true;
      window.clearInterval(timer);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(0);
      }
      for (const oscillator of oscillators) {
        try {
          oscillator.stop();
        } catch {
          // already stopped
        }
      }
      for (const toneGain of toneGains) {
        try {
          toneGain.disconnect();
        } catch {
          // already disconnected
        }
      }
      try {
        masterGain?.disconnect();
        compressor?.disconnect();
      } catch {
        // already disconnected
      }
      oscillators.clear();
      toneGains.clear();
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
        requireInteraction: true,
        data: { url: item.href },
      })
      .catch(() => undefined);
  }, []);

  const closeSystemNotification = useCallback(async (item: AlertItem) => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    if (!registration || typeof registration.getNotifications !== "function") return;
    const notifications = await registration.getNotifications({ tag: item.id }).catch(() => []);
    for (const notification of notifications) notification.close();
  }, []);

  const processSnapshot = useCallback(
    async (payload: CommsResponse) => {
      const pendingCount = Number(payload.pendingUrgentCount || 0);
      window.dispatchEvent(
        new CustomEvent("relife-chamber-pending", { detail: pendingCount })
      );

      const messages = payload.messages || [];
      const activeMessageId = activeMessageIdRef.current;
      if (activeMessageId) {
        const current = messages.find((message) => message.messageId === activeMessageId);
        const stillTargeted =
          current &&
          isActiveCall(current) &&
          targetMatches(current.roomId || "", currentStaffId, currentRoles);
        if (!stillTargeted) {
          stopRing();
          activeMessageIdRef.current = "";
          if (mountedRef.current) {
            setAlert(null);
            setAccepting(false);
            setAcceptError("");
          }
          return;
        }
        if (!withinChamberAlertHours()) {
          stopRing();
        } else if (!stopRingRef.current) {
          await startPersistentCallRing();
        }
        return;
      }

      if (!withinChamberAlertHours()) return;

      const candidates = messages
        .filter(
          (message) =>
            message.priority === "Urgent" &&
            message.messageType !== "Equipment" &&
            message.senderId !== currentStaffId &&
            isActiveCall(message) &&
            createdWithinChamberAlertHours(message.createdAt) &&
            targetMatches(message.roomId || "", currentStaffId, currentRoles)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const newest = candidates[0];
      if (!newest || !mountedRef.current) return;

      const item: AlertItem = {
        id: `message:${newest.messageId}`,
        messageId: newest.messageId,
        createdAt: newest.createdAt,
        title: `Chamber call · ${newest.senderName || "Team"}`,
        body: `${newest.body}${newest.bedId ? ` · ${newest.bedId}` : ""}`,
        href: "/chamber?tab=team&team=messages#chamber-team-panel",
      };
      activeMessageIdRef.current = newest.messageId;
      setAlert(item);
      setAcceptError("");
      await Promise.allSettled([
        startPersistentCallRing(),
        showSystemNotification(item),
      ]);
    },
    [currentRoles, currentStaffId, showSystemNotification, startPersistentCallRing, stopRing]
  );

  const acceptCall = useCallback(async () => {
    if (!alert || accepting) return;
    setAccepting(true);
    setAcceptError("");
    try {
      const response = await fetch("/api/chamber/comms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept_call", messageId: alert.messageId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "CALL_ACCEPT_FAILED");
      }
      stopRing();
      activeMessageIdRef.current = "";
      await closeSystemNotification(alert);
      if (mountedRef.current) {
        setAlert(null);
        setAcceptError("");
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(80);
      }
    } catch (error) {
      if (mountedRef.current) {
        setAcceptError(error instanceof Error ? error.message : "Call acceptance failed");
      }
    } finally {
      if (mountedRef.current) setAccepting(false);
    }
  }, [accepting, alert, closeSystemNotification, stopRing]);

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
      activeMessageIdRef.current = "";
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
    const timer = window.setInterval(() => void poll(), 5_000);
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
          Loud call ring repeats until an authorized recipient accepts.
        </p>
        {acceptError && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {acceptError} · Ring is still active.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={accepting}
            onClick={() => void acceptCall()}
            className="min-h-11 rounded-xl bg-red-600 px-3 text-xs font-bold text-white disabled:opacity-60"
          >
            {accepting ? "Accepting…" : "Accept call"}
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = alert.href;
            }}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
          >
            Open Team
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-slate-400">
          In-app gain is set to full scale. Final loudness still follows the device/media volume and browser audio policy.
        </p>
      </div>
    </div>
  );
}
