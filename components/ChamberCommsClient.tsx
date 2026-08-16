"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TapChoice from "@/components/TapChoice";
import { Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type MessagePriority = "Normal" | "Urgent";
type EquipmentStatus = "Requested" | "Accepted" | "Moving" | "Delivered" | "Returned" | "Cancelled";

type ChatMessage = {
  messageId: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  senderRoles: string[];
  messageType: "Message" | "System" | "Equipment";
  priority: MessagePriority;
  body: string;
  patientId: string;
  appointmentId: string;
  bedId: string;
  roomId: string;
  equipmentRequestId: string;
  status: string;
};

type EquipmentRequest = {
  requestId: string;
  createdAt: string;
  updatedAt: string;
  requestedById: string;
  requestedByName: string;
  resourceId: string;
  resourceName: string;
  fromLocation: string;
  toLocation: string;
  patientId: string;
  patientName: string;
  appointmentId: string;
  bedId: string;
  neededDurationMin: number;
  priority: MessagePriority;
  status: EquipmentStatus;
  acceptedById: string;
  acceptedByName: string;
  acceptedAt: string;
  movingAt: string;
  deliveredAt: string;
  returnedAt: string;
  notes: string;
};

type Machine = {
  resourceId: string;
  resourceName: string;
  roomId: string;
  defaultDurationMin: number;
};

type Snapshot = {
  currentStaffId: string;
  canUpdateEquipment: boolean;
  messages: ChatMessage[];
  equipmentRequests: EquipmentRequest[];
  machines: Machine[];
  locations: string[];
  pendingUrgentCount: number;
};

type ActivePatient = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  bedId: string;
  roomId: string;
};

const SOUND_KEY = "relife_chamber_sound_enabled";
const QUICK_MESSAGES = [
  { label: "Bed ready", body: "Bed ready", urgent: false },
  { label: "Patient arrived", body: "Patient arrived", urgent: false },
  { label: "Need assistance", body: "Need assistance", urgent: true },
  { label: "Cleaning needed", body: "Cleaning needed", urgent: false },
];

function shortTime(value: string): string {
  const match = /(?:T|\s)(\d{2}:\d{2})/.exec(value || "");
  return match?.[1] || value;
}

function statusTone(status: EquipmentStatus): "info" | "warning" | "success" | "danger" | "neutral" {
  if (status === "Requested") return "danger";
  if (status === "Accepted" || status === "Moving") return "warning";
  if (status === "Delivered") return "info";
  if (status === "Returned") return "success";
  return "neutral";
}

function nextStatus(status: EquipmentStatus): EquipmentStatus | null {
  if (status === "Requested") return "Accepted";
  if (status === "Accepted") return "Moving";
  if (status === "Moving") return "Delivered";
  if (status === "Delivered") return "Returned";
  return null;
}

function nextLabel(status: EquipmentStatus): string {
  if (status === "Requested") return "Accept";
  if (status === "Accepted") return "Moving";
  if (status === "Moving") return "Delivered";
  if (status === "Delivered") return "Returned";
  return "Done";
}

export default function ChamberCommsClient({
  initial,
  activePatients,
  defaultTab = "messages",
}: {
  initial: Snapshot;
  activePatients: ActivePatient[];
  defaultTab?: "messages" | "equipment";
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<"messages" | "equipment">(defaultTab);
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("Normal");
  const [machineId, setMachineId] = useState(initial.machines[0]?.resourceId || "");
  const [fromLocation, setFromLocation] = useState("Shared");
  const [toLocation, setToLocation] = useState("Room 1");
  const [patientAppointmentId, setPatientAppointmentId] = useState("");
  const [duration, setDuration] = useState(20);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");

  const selectedPatient = activePatients.find((item) => item.appointmentId === patientAppointmentId);
  const selectedMachine = snapshot.machines.find((item) => item.resourceId === machineId);
  const activeRequests = useMemo(
    () => snapshot.equipmentRequests.filter((item) => item.status !== "Returned" && item.status !== "Cancelled"),
    [snapshot.equipmentRequests]
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/chamber/comms", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    if (result.ok) {
      setSnapshot({
        currentStaffId: result.currentStaffId,
        canUpdateEquipment: result.canUpdateEquipment,
        messages: result.messages || [],
        equipmentRequests: result.equipmentRequests || [],
        machines: result.machines || [],
        locations: result.locations || [],
        pendingUrgentCount: result.pendingUrgentCount || 0,
      });
    }
  }, []);

  useEffect(() => {
    setSoundOn(localStorage.getItem(SOUND_KEY) !== "off");
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function post(body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/chamber/comms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      haptic("success");
      await refresh();
    } catch (postError) {
      haptic("error");
      setError(postError instanceof Error ? postError.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function sendMessage() {
    const body = message.trim();
    if (!body) return;
    await post(
      {
        action: "send_message",
        body,
        priority,
        appointmentId: selectedPatient?.appointmentId || "",
        patientId: selectedPatient?.patientId || "",
        bedId: selectedPatient?.bedId || "",
        roomId: selectedPatient?.roomId || "",
      },
      "message"
    );
    setMessage("");
    setPriority("Normal");
  }

  async function requestEquipment() {
    if (!machineId || fromLocation === toLocation) return;
    await post(
      {
        action: "request_equipment",
        resourceId: machineId,
        fromLocation,
        toLocation,
        appointmentId: selectedPatient?.appointmentId || "",
        patientId: selectedPatient?.patientId || "",
        patientName: selectedPatient?.patientName || "",
        bedId: selectedPatient?.bedId || "",
        neededDurationMin: duration,
        notes,
      },
      "equipment-request"
    );
    setNotes("");
  }

  async function updateStatus(requestId: string, status: EquipmentStatus) {
    await post({ action: "equipment_status", requestId, status }, `${requestId}:${status}`);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    window.dispatchEvent(new CustomEvent("relife-chamber-sound", { detail: next }));
    haptic("tap");
  }

  async function enableSystemNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">Chamber communication</p>
            <h1 className="mt-1 text-xl font-bold text-slate-950">Team chat & equipment</h1>
            <p className="mt-1 text-xs leading-5 text-slate-500">Short operational messages only. Clinical notes stay in the patient file.</p>
          </div>
          {snapshot.pendingUrgentCount > 0 && <StatusBadge tone="warning">{snapshot.pendingUrgentCount} urgent</StatusBadge>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={toggleSound}
            className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${soundOn ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}
          >
            🔊 Call sound {soundOn ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => void enableSystemNotifications()}
            disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
            className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 disabled:opacity-60"
          >
            {notificationPermission === "granted" ? "Notifications ON" : notificationPermission === "unsupported" ? "System alert unavailable" : "Enable system alert"}
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-slate-400">Urgent messages and equipment requests ring for up to 10 seconds while the app is active. Opening or dismissing the alert stops it immediately.</p>
      </section>

      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        <button type="button" onClick={() => setTab("messages")} className={`min-h-10 rounded-lg text-xs font-semibold ${tab === "messages" ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"}`}>Messages</button>
        <button type="button" onClick={() => setTab("equipment")} className={`relative min-h-10 rounded-lg text-xs font-semibold ${tab === "equipment" ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"}`}>
          Equipment
          {activeRequests.filter((item) => item.status === "Requested").length > 0 && (
            <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] text-white">{activeRequests.filter((item) => item.status === "Requested").length}</span>
          )}
        </button>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</p>}

      {tab === "messages" && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-700">Quick message</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {QUICK_MESSAGES.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => {
                    setMessage(item.body);
                    setPriority(item.urgent ? "Urgent" : "Normal");
                    haptic("tap");
                  }}
                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {activePatients.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-700">Link patient (optional)</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPatientAppointmentId("")} className={`min-h-11 rounded-xl border px-2 text-xs font-semibold ${!patientAppointmentId ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-500"}`}>No patient</button>
                  {activePatients.slice(0, 7).map((patient) => (
                    <button type="button" key={patient.appointmentId} onClick={() => setPatientAppointmentId(patient.appointmentId)} className={`min-h-11 rounded-xl border px-2 text-left text-xs ${patientAppointmentId === patient.appointmentId ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600"}`}>
                      <span className="block truncate font-semibold">{patient.patientName}</span>
                      <span className="block truncate text-[10px] opacity-70">{patient.bedId || "Waiting"}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Message
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={3} placeholder="Short operational message" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" />
            </label>
            <TapChoice
              label="Priority"
              value={priority}
              columns={2}
              tone={priority === "Urgent" ? "red" : "blue"}
              options={[{ value: "Normal", label: "Normal", subtitle: "No call ring" }, { value: "Urgent", label: "Urgent", subtitle: "10-sec call alert" }]}
              onChange={(value) => setPriority(value as MessagePriority)}
            />
            <button type="button" disabled={!message.trim() || Boolean(busy)} onClick={() => void sendMessage()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {busy === "message" && <Spinner size="sm" className="border-white/40 border-t-white" label="Sending" />}
              Send message
            </button>
          </section>

          <section className="space-y-2">
            {snapshot.messages.map((item) => {
              const own = item.senderId === snapshot.currentStaffId;
              return (
                <article key={item.messageId} className={`rounded-2xl border p-3 shadow-sm ${item.priority === "Urgent" ? "border-red-200 bg-red-50" : own ? "border-blue-100 bg-blue-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">{own ? "You" : item.senderName || item.senderId}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{shortTime(item.createdAt)} · {item.messageType}</p>
                    </div>
                    {item.priority === "Urgent" && <StatusBadge tone="warning">Urgent</StatusBadge>}
                  </div>
                  <p className="mt-2 text-sm leading-5 text-slate-700">{item.body}</p>
                  {(item.patientId || item.bedId || item.roomId) && <p className="mt-2 text-[10px] font-medium text-slate-500">{[item.patientId, item.bedId, item.roomId].filter(Boolean).join(" · ")}</p>}
                </article>
              );
            })}
            {snapshot.messages.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-400">No Chamber messages today.</div>}
          </section>
        </>
      )}

      {tab === "equipment" && (
        <>
          <section className="rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-900">Request equipment</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Every new equipment request is an urgent 10-second Chamber call.</p>
              </div>
              <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-700">CALL</span>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-700">Machine</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {snapshot.machines.map((machine) => (
                  <button type="button" key={machine.resourceId} onClick={() => { setMachineId(machine.resourceId); setDuration(machine.defaultDurationMin || 15); }} className={`min-h-12 rounded-xl border px-3 text-left ${machineId === machine.resourceId ? "border-red-500 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-700"}`}>
                    <span className="block text-xs font-semibold">{machine.resourceName}</span>
                    <span className="block text-[10px] opacity-65">{machine.defaultDurationMin || 15} min default</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <TapChoice label="From" value={fromLocation} columns={1} tone="slate" options={snapshot.locations.map((value) => ({ value, label: value }))} onChange={setFromLocation} />
              <TapChoice label="To" value={toLocation} columns={1} tone="red" options={snapshot.locations.filter((value) => value !== "Shared").map((value) => ({ value, label: value }))} onChange={setToLocation} />
            </div>

            {activePatients.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-700">For patient (optional)</p>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  <button type="button" onClick={() => setPatientAppointmentId("")} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold ${!patientAppointmentId ? "border-red-400 bg-red-50 text-red-800" : "border-slate-200 text-slate-500"}`}>None</button>
                  {activePatients.map((patient) => (
                    <button type="button" key={patient.appointmentId} onClick={() => setPatientAppointmentId(patient.appointmentId)} className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs ${patientAppointmentId === patient.appointmentId ? "border-red-400 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600"}`}>
                      <span className="block font-semibold">{patient.patientName}</span>
                      <span className="block text-[10px] opacity-65">{patient.bedId || "Waiting"}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-700">Needed duration</p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[10, 15, 20, 30].map((value) => (
                  <button type="button" key={value} onClick={() => setDuration(value)} className={`min-h-10 rounded-xl border text-xs font-semibold ${duration === value ? "border-red-500 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600"}`}>{value}m</button>
                ))}
              </div>
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-700">Note (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-red-500" placeholder="e.g. Need for Bed 1 now" /></label>
            {fromLocation === toLocation && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">From and To location must be different.</p>}
            <button type="button" disabled={!selectedMachine || fromLocation === toLocation || Boolean(busy)} onClick={() => void requestEquipment()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy === "equipment-request" && <Spinner size="sm" className="border-white/40 border-t-white" label="Requesting" />}
              🔔 Send equipment call
            </button>
          </section>

          <section className="space-y-3">
            {snapshot.equipmentRequests.map((item) => {
              const next = nextStatus(item.status);
              return (
                <article key={item.requestId} className={`rounded-2xl border bg-white p-4 shadow-sm ${item.status === "Requested" ? "border-red-200" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-bold text-slate-950">{item.resourceName}</h2>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-500">{item.fromLocation} → {item.toLocation} · {item.neededDurationMin} min</p>
                    </div>
                    <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">Requested by <strong>{item.requestedByName || item.requestedById}</strong> · {shortTime(item.createdAt)}</p>
                  {(item.patientName || item.bedId) && <p className="mt-1 text-[11px] text-slate-500">{[item.patientName, item.bedId].filter(Boolean).join(" · ")}</p>}
                  {item.acceptedByName && <p className="mt-1 text-[10px] text-slate-400">Handled by {item.acceptedByName}</p>}
                  {item.notes && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">{item.notes}</p>}
                  {snapshot.canUpdateEquipment && next && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" disabled={Boolean(busy)} onClick={() => void updateStatus(item.requestId, next)} className="min-h-11 rounded-xl bg-blue-800 px-3 text-xs font-semibold text-white disabled:opacity-50">
                        {busy === `${item.requestId}:${next}` ? "Updating…" : nextLabel(item.status)}
                      </button>
                      {item.status !== "Delivered" && (
                        <button type="button" disabled={Boolean(busy)} onClick={() => void updateStatus(item.requestId, "Cancelled")} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500 disabled:opacity-50">Cancel</button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {snapshot.equipmentRequests.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-400">No equipment requests today.</div>}
          </section>
        </>
      )}
    </div>
  );
}
