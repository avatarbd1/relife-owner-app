"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner, StatusBadge } from "@/components/FeedbackUI";
import type {
  ChamberChatContext,
  ChamberChatRecipient,
  ChamberChatWorkspacePayload,
  ChamberContextMessage,
  ChamberContextMessagePriority,
} from "@/lib/types/chamberChat";
import { haptic } from "@/lib/interactions";

const QUICK_MESSAGES: Array<{
  label: string;
  body: string;
  priority: ChamberContextMessagePriority;
}> = [
  {
    label: "🆘 Help needed — Jan/Asen",
    body: "Help needed — Jan/Asen counter",
    priority: "Urgent",
  },
  { label: "✅ Patient arrived", body: "Patient arrived", priority: "Normal" },
  { label: "⏱️ Session starting", body: "Session starting", priority: "Normal" },
  { label: "✅ Session completed", body: "Session completed", priority: "Normal" },
  { label: "🧹 Room cleanup needed", body: "Room cleanup needed", priority: "Normal" },
  { label: "📋 Assessment done", body: "Assessment done", priority: "Normal" },
  {
    label: "❓ Can't proceed — Need approval",
    body: "Can't proceed — Need approval",
    priority: "Urgent",
  },
  {
    label: "👤 Staff needed — Receptionist",
    body: "Staff needed — Call receptionist",
    priority: "Urgent",
  },
  {
    label: "🚑 Emergency — assistance required",
    body: "Emergency — assistance required",
    priority: "Urgent",
  },
  { label: "📞 Call required", body: "Call required", priority: "Urgent" },
];

const ARCHIVE_DELAY_MS = 5 * 60 * 1000;

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function shortTime(value: string): string {
  const match = /(?:T|\s)(\d{2}:\d{2})/.exec(value || "");
  return match?.[1] || value || "—";
}

function timestampMs(value: string): number {
  if (!value) return 0;
  const candidate = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}+06:00`;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestContextMessage(
  messages: ChamberContextMessage[],
  appointmentId: string
): ChamberContextMessage | null {
  return (
    messages
      .filter((message) => message.appointmentId === appointmentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null
  );
}

function contextPhase(
  context: ChamberChatContext,
  messages: ChamberContextMessage[]
): "Active" | "Closing" | "Archived" {
  if (context.active) return "Active";
  const latest = latestContextMessage(messages, context.appointmentId);
  const latestAt = latest ? timestampMs(latest.createdAt) : 0;
  if (latestAt && Date.now() - latestAt < ARCHIVE_DELAY_MS) return "Closing";
  return "Archived";
}

function phaseTone(
  phase: "Active" | "Closing" | "Archived"
): "success" | "warning" | "neutral" {
  if (phase === "Active") return "success";
  if (phase === "Closing") return "warning";
  return "neutral";
}

function recipientRole(recipient: ChamberChatRecipient): string {
  if (recipient.roles.includes("Owner")) return "Owner";
  if (recipient.roles.includes("Manager")) return "Manager";
  if (recipient.roles.includes("Receptionist")) return "Receptionist";
  if (recipient.roles.includes("Therapist")) return "Therapist";
  return recipient.roles[0] || "Staff";
}

function suggestedRecipients(
  recipients: ChamberChatRecipient[],
  context: ChamberChatContext,
  currentStaffId: string
): ChamberChatRecipient[] {
  const assigned = normalize(context.therapist);
  return recipients.filter((recipient) => {
    if (recipient.staffId === currentStaffId) return false;
    if (
      recipient.roles.includes("Owner") ||
      recipient.roles.includes("Manager") ||
      recipient.roles.includes("Receptionist")
    ) {
      return true;
    }
    if (!recipient.roles.includes("Therapist") || !assigned) return false;
    return (
      normalize(recipient.staffId) === assigned ||
      normalize(recipient.fullName) === assigned
    );
  });
}

function muteKey(appointmentId: string): string {
  return `relife_chamber_context_mute:${appointmentId}`;
}

function isContextMuted(appointmentId: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(muteKey(appointmentId)) === "1";
}

export default function ChamberContextChatClient({
  initial,
}: {
  initial: ChamberChatWorkspacePayload;
}) {
  const [workspace, setWorkspace] = useState(initial);
  const workspaceRef = useRef(initial);
  const [selectedId, setSelectedId] = useState(
    initial.contexts.find((context) => context.active)?.appointmentId ||
      initial.contexts[0]?.appointmentId ||
      ""
  );
  const [message, setMessage] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");

  const selected = useMemo(
    () =>
      workspace.contexts.find((context) => context.appointmentId === selectedId) ||
      workspace.contexts[0] ||
      null,
    [selectedId, workspace.contexts]
  );

  const contextMessages = useMemo(() => {
    if (!selected) return [];
    const query = normalize(search);
    return workspace.messages
      .filter((item) => item.appointmentId === selected.appointmentId)
      .filter((item) => {
        if (!query) return true;
        return [item.body, item.senderName, item.senderRoles.join(" ")]
          .map(normalize)
          .some((value) => value.includes(query));
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [search, selected, workspace.messages]);

  const recipients = useMemo(
    () =>
      selected
        ? suggestedRecipients(
            workspace.recipients,
            selected,
            workspace.currentStaffId
          )
        : [],
    [selected, workspace.currentStaffId, workspace.recipients]
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/chamber/context-chat", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const result = await response.json().catch(() => null);
    if (!result?.ok) return;

    const next = result as ChamberChatWorkspacePayload & { ok: true };
    const previousIds = new Set(
      workspaceRef.current.messages.map((item) => item.messageId)
    );
    const newMessages = (next.messages || []).filter(
      (item) => !previousIds.has(item.messageId)
    );

    if (typeof window !== "undefined" && "Notification" in window) {
      for (const item of newMessages) {
        if (item.senderId === next.currentStaffId) continue;
        const mutedForContext = isContextMuted(item.appointmentId);
        if (mutedForContext && item.priority !== "Urgent") continue;
        if (Notification.permission === "granted") {
          const context = next.contexts.find(
            (entry) => entry.appointmentId === item.appointmentId
          );
          new Notification(
            item.priority === "Urgent" ? "Urgent chamber message" : "Chamber message",
            {
              body: `${context?.patientName || "Patient"}: ${item.body}`,
              tag: `relife-chat-${item.messageId}`,
            }
          );
        }
      }
    }

    const nextWorkspace: ChamberChatWorkspacePayload = {
      currentStaffId: next.currentStaffId,
      contexts: next.contexts || [],
      recipients: next.recipients || [],
      messages: next.messages || [],
      pendingUrgentCount: next.pendingUrgentCount || 0,
    };
    workspaceRef.current = nextWorkspace;
    setWorkspace(nextWorkspace);
    setSelectedId((current) => {
      if (nextWorkspace.contexts.some((item) => item.appointmentId === current)) {
        return current;
      }
      return (
        nextWorkspace.contexts.find((item) => item.active)?.appointmentId ||
        nextWorkspace.contexts[0]?.appointmentId ||
        ""
      );
    });
  }, []);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    setNotificationPermission(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "unsupported"
    );
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setMuted(false);
      return;
    }
    setMuted(isContextMuted(selectedId));
  }, [selectedId]);

  async function postMessage(
    body: string,
    priority: ChamberContextMessagePriority,
    key: string
  ) {
    if (!selected || !selected.active || busy) return;
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/chamber/context-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send_context_message",
          appointmentId: selected.appointmentId,
          body,
          priority,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = String(result.error || `HTTP ${response.status}`);
        if (reason === "NON_OPERATIONAL_MESSAGE") {
          throw new Error("Only room, patient, session or staff-work messages are allowed here.");
        }
        if (reason === "CHAT_CONTEXT_CLOSED") {
          throw new Error("This session chat is already closed.");
        }
        throw new Error(reason);
      }
      haptic("success");
      setMessage("");
      setUrgent(false);
      await refresh();
    } catch (postError) {
      haptic("error");
      setError(postError instanceof Error ? postError.message : "Message failed");
    } finally {
      setBusy("");
    }
  }

  function toggleMute() {
    if (!selected) return;
    const next = !muted;
    setMuted(next);
    localStorage.setItem(muteKey(selected.appointmentId), next ? "1" : "0");
    haptic("tap");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  if (!selected) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-base font-bold text-slate-900">No chamber chat context yet</p>
        <p className="mt-2 text-sm text-slate-500">
          A patient appointment or Chamber session will create the next context.
        </p>
        <Link
          href="/chamber"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white"
        >
          Open Chamber
        </Link>
      </section>
    );
  }

  const phase = contextPhase(selected, workspace.messages);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">
            Active context
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible">
            {workspace.contexts.map((context) => {
              const active = context.appointmentId === selected.appointmentId;
              const itemPhase = contextPhase(context, workspace.messages);
              return (
                <button
                  key={context.appointmentId}
                  type="button"
                  onClick={() => {
                    setSelectedId(context.appointmentId);
                    setSearch("");
                    haptic("tap");
                  }}
                  className={`min-w-[190px] rounded-xl border p-3 text-left lg:min-w-0 lg:w-full ${
                    active
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-bold text-slate-950">
                      {context.roomId || "Waiting"}
                    </span>
                    <span className="text-[9px] text-slate-400">{shortTime(context.time)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-700">
                    {context.patientName || context.patientId}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-slate-400">
                    {context.bedId || "No bed yet"} · {itemPhase}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-900">Recipients</p>
            <span className="text-[9px] font-semibold text-slate-400">Auto-suggested</span>
          </div>
          <div className="mt-2 space-y-2">
            {recipients.slice(0, 8).map((recipient) => (
              <div key={recipient.staffId} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                  {recipient.fullName}
                </span>
                <span className="text-[9px] text-slate-400">{recipientRole(recipient)}</span>
              </div>
            ))}
            {recipients.length === 0 && (
              <p className="text-[11px] text-slate-400">No additional recipient suggested.</p>
            )}
          </div>
          <p className="mt-3 text-[9px] leading-4 text-slate-400">
            Suggested recipients are operational shortcuts. Chamber-authorized Physio staff can view permitted room contexts.
          </p>
        </section>
      </aside>

      <main className="min-w-0 space-y-3">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">
                  {selected.roomId || "Waiting area"} · {selected.bedId || "No bed"}
                </p>
                <h2 className="mt-1 truncate text-xl font-bold text-slate-950">
                  {selected.patientName || selected.patientId}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selected.time || "Time pending"}
                  {selected.therapist ? ` · ${selected.therapist}` : ""}
                </p>
              </div>
              <StatusBadge tone={phaseTone(phase)}>{phase}</StatusBadge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 sm:col-span-2">
                <span className="sr-only">Search messages</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search messages or staff"
                  className="min-h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <button
                type="button"
                onClick={toggleMute}
                className={`min-h-10 rounded-xl border px-3 text-xs font-semibold ${
                  muted
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {muted ? "🔇 Muted" : "🔔 Alerts"}
              </button>
              <button
                type="button"
                disabled={
                  notificationPermission === "granted" ||
                  notificationPermission === "unsupported"
                }
                onClick={() => void enableNotifications()}
                className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 disabled:opacity-55"
              >
                {notificationPermission === "granted" ? "System alerts on" : "Enable alerts"}
              </button>
            </div>
            {muted && (
              <p className="mt-2 text-[10px] text-amber-700">
                Normal notifications are muted for this context. Urgent messages still alert.
              </p>
            )}
          </div>

          <div className="min-h-[250px] space-y-2 bg-slate-50/60 p-4">
            {contextMessages.map((item) => {
              const own = item.senderId === workspace.currentStaffId;
              return (
                <article
                  key={item.messageId}
                  className={`max-w-[86%] rounded-2xl border px-3 py-2.5 text-sm shadow-sm ${
                    own
                      ? "ml-auto border-amber-100 bg-amber-50 text-amber-950"
                      : item.priority === "Urgent"
                        ? "border-red-200 bg-red-50 text-red-950"
                        : "border-blue-100 bg-blue-50 text-blue-950"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[10px] font-bold">
                      {own ? `${item.senderName || "You"} (You)` : item.senderName || "Staff"}
                    </span>
                    <span className="shrink-0 text-[9px] opacity-55">{shortTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-5">{item.body}</p>
                  {item.priority === "Urgent" && (
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-red-700">
                      Urgent
                    </p>
                  )}
                </article>
              );
            })}
            {contextMessages.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm font-semibold text-slate-600">No messages in this context</p>
                <p className="mt-1 text-xs text-slate-400">Use a quick operational message to start.</p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-950">Quick messages</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">One tap sends to this patient/session context.</p>
            </div>
            {workspace.pendingUrgentCount > 0 && (
              <StatusBadge tone="warning">{workspace.pendingUrgentCount} urgent</StatusBadge>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {QUICK_MESSAGES.map((item) => (
              <button
                key={item.body}
                type="button"
                disabled={!selected.active || Boolean(busy)}
                onClick={() => void postMessage(item.body, item.priority, `preset:${item.body}`)}
                className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs font-semibold text-slate-700 active:bg-slate-100 disabled:opacity-45"
              >
                {busy === `preset:${item.body}` ? "Sending…" : item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-950">Custom message</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">Operational, room or patient context only.</p>
            </div>
            <button
              type="button"
              disabled={!selected.active}
              onClick={() => setUrgent((value) => !value)}
              className={`min-h-9 rounded-lg border px-3 text-[10px] font-bold ${
                urgent
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              } disabled:opacity-40`}
            >
              {urgent ? "Urgent ON" : "Mark urgent"}
            </button>
          </div>
          <textarea
            data-home-swipe-ignore
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={!selected.active}
            maxLength={500}
            rows={3}
            placeholder={
              selected.active
                ? "Patient needs 10 more minutes"
                : "This context is closed"
            }
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={!selected.active || !message.trim() || Boolean(busy)}
            onClick={() =>
              void postMessage(
                message.trim(),
                urgent ? "Urgent" : "Normal",
                "custom"
              )
            }
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-45"
          >
            {busy === "custom" && (
              <Spinner
                size="sm"
                className="border-white/40 border-t-white"
                label="Sending"
              />
            )}
            Send
          </button>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
          <div>
            <p className="font-semibold text-slate-800">
              {phase === "Active"
                ? "Context closes with the Chamber session."
                : phase === "Closing"
                  ? "Session closed · archiving after 5 minutes of inactivity."
                  : "This chat is archived. History remains readable."}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Next patient uses a fresh appointment context.
            </p>
          </div>
          <Link
            href={phase === "Active" ? "/chamber?tab=live" : "/chamber?tab=team"}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 font-semibold text-slate-700"
          >
            {phase === "Active" ? "Open Chamber" : "View team tools"}
          </Link>
        </section>
      </main>
    </div>
  );
}
