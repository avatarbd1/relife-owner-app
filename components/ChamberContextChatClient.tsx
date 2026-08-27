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
type Sheet = "quick" | "more" | "contexts" | null;

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
  const threadEndRef = useRef<HTMLDivElement>(null);
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
  const [sheet, setSheet] = useState<Sheet>(null);
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

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [contextMessages.length, selectedId]);

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
      setSheet(null);
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

  function chooseContext(context: ChamberChatContext) {
    setSelectedId(context.appointmentId);
    setSearch("");
    setSheet(null);
    haptic("tap");
  }

  if (!selected) {
    return (
      <section className="mx-auto flex min-h-[58dvh] w-full max-w-[430px] flex-col items-center justify-center bg-white px-6 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-2xl">💬</div>
        <p className="mt-4 text-base font-bold text-slate-900">No chamber chat context yet</p>
        <p className="mt-2 max-w-xs text-sm text-slate-500">
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
    <div className="relative mx-auto min-h-[calc(100dvh-8.5rem)] w-full max-w-[430px] overflow-x-hidden bg-white shadow-sm ring-1 ring-slate-200/70 sm:rounded-2xl">
      <header className="sticky top-[58px] z-20 border-b border-slate-200 bg-white/95 px-2.5 py-2 backdrop-blur-xl">
        <div className="flex min-h-12 items-center gap-2">
          <Link
            href="/home"
            aria-label="Back to Home"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl font-semibold text-slate-700 active:bg-slate-100"
          >
            ‹
          </Link>

          <button
            type="button"
            onClick={() => setSheet("contexts")}
            className="min-w-0 flex-1 rounded-xl px-2 py-1 text-left active:bg-slate-50"
          >
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-bold text-slate-950">
                {selected.roomId || "Waiting"} · {selected.patientName || selected.patientId}
              </h1>
              <span className="text-[10px] text-slate-400">⌄</span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">
              {selected.time || "Time pending"}
              {selected.bedId ? ` · ${selected.bedId}` : ""}
              {selected.therapist ? ` · ${selected.therapist}` : ""}
            </p>
          </button>

          <StatusBadge tone={phaseTone(phase)}>{phase}</StatusBadge>
          <button
            type="button"
            aria-label="Chat options"
            onClick={() => setSheet("more")}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl leading-none text-slate-700 active:bg-slate-100"
          >
            ⋮
          </button>
        </div>
      </header>

      <main className="min-h-[calc(100dvh-15rem)] space-y-2 bg-slate-50/70 px-3 py-4">
        {search && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
            <span className="truncate">Search: “{search}”</span>
            <button type="button" onClick={() => setSearch("")} className="font-bold">
              Clear
            </button>
          </div>
        )}

        {phase !== "Active" && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-[10px] font-medium text-slate-500">
            {phase === "Closing"
              ? "Session closed · archiving after 5 minutes of inactivity."
              : "Archived chat · history is read-only."}
          </div>
        )}

        {contextMessages.map((item) => {
          const own = item.senderId === workspace.currentStaffId;
          return (
            <article
              key={item.messageId}
              className={`max-w-[84%] rounded-2xl px-3 py-2.5 text-sm shadow-sm ring-1 ${
                own
                  ? "ml-auto rounded-br-md bg-blue-700 text-white ring-blue-700"
                  : item.priority === "Urgent"
                    ? "rounded-bl-md bg-red-50 text-red-950 ring-red-200"
                    : "rounded-bl-md bg-white text-slate-900 ring-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`truncate text-[10px] font-bold ${own ? "text-blue-100" : "text-slate-500"}`}>
                  {own ? "You" : item.senderName || "Staff"}
                </span>
                <span className={`shrink-0 text-[9px] ${own ? "text-blue-200" : "text-slate-400"}`}>
                  {shortTime(item.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap leading-5">{item.body}</p>
              {item.priority === "Urgent" && !own && (
                <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-red-700">
                  Urgent
                </p>
              )}
            </article>
          );
        })}

        {contextMessages.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white text-xl shadow-sm ring-1 ring-slate-200">
              💬
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-600">
              {search ? "No matching messages" : "No messages yet"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {search ? "Try a different search." : "Use Quick for a one-tap operational message."}
            </p>
          </div>
        )}
        <div ref={threadEndRef} />
      </main>

      <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 p-2.5 backdrop-blur-xl">
        {error && (
          <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </div>
        )}
        {urgent && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-red-50 px-2.5 py-1.5 text-[10px] font-semibold text-red-700">
            <span>Urgent message ON</span>
            <button type="button" onClick={() => setUrgent(false)}>Turn off</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled={!selected.active}
            onClick={() => setSheet("quick")}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 active:bg-slate-100 disabled:opacity-40"
          >
            ⚡ Quick
          </button>
          <textarea
            data-home-swipe-ignore
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={!selected.active}
            maxLength={500}
            rows={1}
            placeholder={selected.active ? "Message…" : "Context closed"}
            className="max-h-24 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:text-slate-400"
          />
          <button
            type="button"
            aria-label="Send message"
            disabled={!selected.active || !message.trim() || Boolean(busy)}
            onClick={() =>
              void postMessage(
                message.trim(),
                urgent ? "Urgent" : "Normal",
                "custom"
              )
            }
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-700 text-sm font-bold text-white shadow-sm active:scale-[0.97] disabled:opacity-40"
          >
            {busy === "custom" ? (
              <Spinner size="sm" className="border-white/40 border-t-white" label="Sending" />
            ) : (
              "➤"
            )}
          </button>
        </div>
      </div>

      {sheet && (
        <>
          <button
            type="button"
            aria-label="Close chat sheet"
            onClick={() => setSheet(null)}
            className="fixed inset-0 z-30 bg-slate-950/25"
          />
          <section
            data-home-swipe-ignore
            className="fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 max-h-[72dvh] w-full max-w-[430px] -translate-x-1/2 overflow-y-auto rounded-t-3xl border border-slate-200 bg-white px-4 pb-5 pt-3 shadow-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />

            {sheet === "quick" && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-950">Quick messages</h2>
                    <p className="mt-0.5 text-[10px] text-slate-400">One tap sends to this patient/session.</p>
                  </div>
                  {workspace.pendingUrgentCount > 0 && (
                    <StatusBadge tone="warning">{workspace.pendingUrgentCount} urgent</StatusBadge>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {QUICK_MESSAGES.map((item) => (
                    <button
                      key={item.body}
                      type="button"
                      disabled={!selected.active || Boolean(busy)}
                      onClick={() => void postMessage(item.body, item.priority, `preset:${item.body}`)}
                      className="flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm font-semibold text-slate-700 active:bg-slate-100 disabled:opacity-45"
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] text-slate-400">
                        {busy === `preset:${item.body}` ? "Sending…" : item.priority === "Urgent" ? "Urgent" : "Send"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {sheet === "contexts" && (
              <>
                <h2 className="text-base font-bold text-slate-950">Chat contexts</h2>
                <p className="mt-1 text-[10px] text-slate-400">Each patient/session has a separate conversation.</p>
                <div className="mt-3 space-y-2">
                  {workspace.contexts.map((context) => {
                    const itemPhase = contextPhase(context, workspace.messages);
                    const active = context.appointmentId === selected.appointmentId;
                    return (
                      <button
                        key={context.appointmentId}
                        type="button"
                        onClick={() => chooseContext(context)}
                        className={`w-full rounded-xl border px-3 py-3 text-left ${
                          active ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-bold text-slate-900">
                            {context.roomId || "Waiting"} · {context.patientName || context.patientId}
                          </span>
                          <span className="text-[10px] text-slate-400">{shortTime(context.time)}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {context.bedId || "No bed"} · {itemPhase}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {sheet === "more" && (
              <>
                <h2 className="text-base font-bold text-slate-950">Chat options</h2>
                <div className="mt-3 space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Search
                    </span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search messages or staff"
                      className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={toggleMute}
                      className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${
                        muted
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      {muted ? "🔇 Muted" : "🔔 Mute room"}
                    </button>
                    <button
                      type="button"
                      disabled={!selected.active}
                      onClick={() => setUrgent((value) => !value)}
                      className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${
                        urgent
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      } disabled:opacity-40`}
                    >
                      {urgent ? "🚨 Urgent ON" : "Mark urgent"}
                    </button>
                  </div>

                  {notificationPermission !== "granted" && notificationPermission !== "unsupported" && (
                    <button
                      type="button"
                      onClick={() => void enableNotifications()}
                      className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
                    >
                      Enable system notifications
                    </button>
                  )}

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-900">Recipients</p>
                      <span className="text-[9px] font-semibold text-slate-400">Auto-suggested</span>
                    </div>
                    <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {recipients.slice(0, 8).map((recipient) => (
                        <div key={recipient.staffId} className="flex min-h-11 items-center gap-2 px-3 text-xs">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                            {recipient.fullName}
                          </span>
                          <span className="text-[9px] text-slate-400">{recipientRole(recipient)}</span>
                        </div>
                      ))}
                      {recipients.length === 0 && (
                        <p className="px-3 py-3 text-[11px] text-slate-400">No additional recipient suggested.</p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSheet("contexts")}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                  >
                    Switch patient/session
                  </button>

                  <Link
                    href={phase === "Active" ? "/chamber?tab=live" : "/chamber?tab=team"}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white"
                  >
                    Open Chamber
                  </Link>

                  <p className="text-center text-[10px] leading-4 text-slate-400">
                    {phase === "Active"
                      ? "Context closes with the Chamber session."
                      : "This context is read-only. Next patient starts a fresh chat."}
                  </p>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
