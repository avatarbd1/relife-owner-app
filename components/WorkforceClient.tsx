"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental" | "All";
type ShiftStatus = "Draft" | "Published" | "Cancelled";
type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
const LEAVE_TYPES = ["Sick", "Casual", "Earned", "Unpaid", "Emergency"] as const;

type ShiftRow = {
  shiftId: string;
  staffId: string;
  staffName: string;
  department: Department;
  shiftDate: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
  notes: string;
};

type LeaveRow = {
  leaveId: string;
  staffId: string;
  staffName: string;
  department: Department;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  decidedBy: string;
  decisionNote: string;
};

type StaffOption = { staffId: string; fullName: string; primaryDepartment: Department | null };
type ShiftUndoState = { shiftId: string; from: ShiftStatus; to: ShiftStatus };

type Tab = "shifts" | "leave";

function nextRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `WF_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

function shiftStatusTone(status: ShiftStatus): "success" | "warning" | "neutral" {
  if (status === "Published") return "success";
  if (status === "Cancelled") return "neutral";
  return "warning";
}

function leaveStatusTone(status: LeaveStatus): "success" | "warning" | "error" | "neutral" {
  if (status === "Approved") return "success";
  if (status === "Rejected") return "error";
  if (status === "Cancelled") return "neutral";
  return "warning";
}

async function mutate(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "WORKFORCE_ACTION_FAILED");
  return payload as Record<string, unknown>;
}

const ERROR_TEXT: Record<string, string> = {
  ACCESS_DENIED: "এই action-এর অনুমতি নেই।",
  SHIFT_OVERLAP: "এই staff-এর জন্য একই সময়ে অন্য shift আছে।",
  SHIFT_LEAVE_CONFLICT: "Approved leave-এর সাথে conflict করছে।",
  SHIFT_INVALID_TRANSITION: "এই shift এই action-এর জন্য প্রস্তুত নয়।",
  SHIFT_UNDO_CONFLICT: "Shift অন্যভাবে পরিবর্তন হয়েছে; Undo করা হয়নি।",
  SHIFT_UNDO_INVALID: "এই shift state Undo করা যাবে না।",
  WORKFORCE_REQUEST_ID_CONFLICT: "এই request ID অন্য action-এ ব্যবহার হয়েছে। আবার চেষ্টা করুন।",
  WORKFORCE_DATA_INVALID: "Workforce data invalid; Owner review প্রয়োজন।",
  SHIFT_DATE_INVALID: "সঠিক তারিখ দিন।",
  SHIFT_TIME_RANGE_INVALID: "End time অবশ্যই start time-এর পরে হতে হবে (একই দিনে)।",
  LEAVE_OVERLAP: "এই তারিখে ইতিমধ্যে একটি active leave request আছে।",
  LEAVE_DATE_RANGE_INVALID: "সঠিক তারিখ range দিন।",
  LEAVE_INVALID_TRANSITION: "এই leave request এই action-এর জন্য প্রস্তুত নয়।",
  LEAVE_SELF_DECISION_FORBIDDEN: "নিজের leave request নিজে decide করা যায় না।",
  WORKFORCE_SCHEMA_NOT_PROVISIONED: "Workforce sheet এখনও provision করা হয়নি।",
};

function friendlyError(code: string): string {
  return ERROR_TEXT[code] || code || "Action failed";
}

export default function WorkforceClient({
  currentStaffId,
  canReadShifts,
  canReadLeave,
  canManageShifts,
  canRequestLeave,
  canDecideLeave,
  canCancelAnyLeave,
  initialShifts,
  shiftsError,
  initialLeave,
  leaveError,
  staffOptions,
  staffOptionsUnavailable,
}: {
  currentStaffId: string;
  canReadShifts: boolean;
  canReadLeave: boolean;
  canManageShifts: boolean;
  canRequestLeave: boolean;
  canDecideLeave: boolean;
  canCancelAnyLeave: boolean;
  initialShifts: ShiftRow[];
  shiftsError: "schema" | "read" | null;
  initialLeave: LeaveRow[];
  leaveError: "schema" | "read" | null;
  staffOptions: StaffOption[];
  staffOptionsUnavailable: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(canReadShifts ? "shifts" : "leave");
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [shiftUndo, setShiftUndo] = useState<ShiftUndoState | null>(null);
  const requestIdsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!shiftUndo) return;
    const timer = window.setTimeout(() => setShiftUndo(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [shiftUndo]);

  function actionRequestId(key: string): string {
    const existing = requestIdsRef.current.get(key);
    if (existing) return existing;
    const created = nextRequestId();
    requestIdsRef.current.set(key, created);
    return created;
  }

  function clearActionRequestId(key: string) {
    requestIdsRef.current.delete(key);
  }

  const [showShiftForm, setShowShiftForm] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState("");
  const [shiftDraft, setShiftDraft] = useState({
    staffId: staffOptions[0]?.staffId || "",
    department: (staffOptions[0]?.primaryDepartment || "Physio") as Department,
    shiftDate: "",
    startTime: "",
    endTime: "",
    notes: "",
  });

  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveDraft, setLeaveDraft] = useState({
    department: "Physio" as Department,
    leaveType: "Casual" as (typeof LEAVE_TYPES)[number],
    startDate: "",
    endDate: "",
    reason: "",
  });

  const ownShifts = useMemo(
    () => initialShifts.filter((row) => row.staffId === currentStaffId),
    [initialShifts, currentStaffId]
  );
  const ownLeave = useMemo(
    () => initialLeave.filter((row) => row.staffId === currentStaffId),
    [initialLeave, currentStaffId]
  );
  const pendingDecisions = useMemo(
    () => initialLeave.filter((row) => row.status === "Pending"),
    [initialLeave]
  );

  function announce(text: string, good: boolean) {
    setMessage({ text, good });
    haptic(good ? "success" : "error");
  }

  function announceMutationError(error: unknown, actionKey: string) {
    const code = error instanceof Error ? error.message : "";
    if (code === "WORKFORCE_REQUEST_ID_CONFLICT") clearActionRequestId(actionKey);
    announce(`✕ ${friendlyError(code)}`, false);
  }

  async function submitShift() {
    if (!shiftDraft.staffId || !shiftDraft.shiftDate || !shiftDraft.startTime || !shiftDraft.endTime) {
      return announce("সব field পূরণ করুন।", false);
    }
    const actionKey = editingShiftId ? `update-shift:${editingShiftId}` : "create-shift";
    const requestId = actionRequestId(actionKey);
    setBusy(actionKey);
    try {
      const result = editingShiftId
        ? await mutate(`/api/workforce/shifts/${encodeURIComponent(editingShiftId)}`, "PATCH", {
            shiftDate: shiftDraft.shiftDate,
            startTime: shiftDraft.startTime,
            endTime: shiftDraft.endTime,
            notes: shiftDraft.notes,
            requestId,
          })
        : await mutate("/api/workforce/shifts", "POST", { ...shiftDraft, requestId });
      announce(
        result.duplicate
          ? "✓ Already saved — duplicate submit blocked"
          : editingShiftId ? "✓ Draft shift updated" : "✓ Shift created as Draft",
        true
      );
      clearActionRequestId(actionKey);
      setShowShiftForm(false);
      setEditingShiftId("");
      setShiftDraft((current) => ({ ...current, shiftDate: "", startTime: "", endTime: "", notes: "" }));
      router.refresh();
    } catch (error) {
      announceMutationError(error, actionKey);
    } finally {
      setBusy("");
    }
  }

  async function shiftAction(shiftId: string, action: "publish" | "cancel") {
    const actionKey = `${action}:${shiftId}`;
    const row = initialShifts.find((item) => item.shiftId === shiftId);
    const previousStatus = row?.status;
    const nextStatus: ShiftStatus = action === "publish" ? "Published" : "Cancelled";
    setShiftUndo(null);
    setBusy(actionKey);
    try {
      const result = await mutate(`/api/workforce/shifts/${encodeURIComponent(shiftId)}/${action}`, "POST", {
        requestId: actionRequestId(actionKey),
      });
      announce(result.duplicate ? "✓ Already up to date" : `✓ Shift ${action}ed`, true);
      clearActionRequestId(actionKey);
      if (
        !result.duplicate &&
        previousStatus &&
        ((nextStatus === "Published" && previousStatus === "Draft") ||
          (nextStatus === "Cancelled" && (previousStatus === "Draft" || previousStatus === "Published")))
      ) {
        setShiftUndo({ shiftId, from: previousStatus, to: nextStatus });
      }
      router.refresh();
    } catch (error) {
      announceMutationError(error, actionKey);
    } finally {
      setBusy("");
    }
  }

  async function undoShiftAction() {
    if (!shiftUndo || busy) return;
    const pending = shiftUndo;
    const actionKey = `undo-shift:${pending.shiftId}:${pending.from}:${pending.to}`;
    setBusy(actionKey);
    try {
      const result = await mutate(
        `/api/workforce/shifts/${encodeURIComponent(pending.shiftId)}/undo`,
        "POST",
        {
          expectedCurrentStatus: pending.to,
          restoreStatus: pending.from,
          requestId: actionRequestId(actionKey),
        }
      );
      announce(result.duplicate ? `✓ Already restored to ${pending.from}` : `✓ Shift restored to ${pending.from}`, true);
      clearActionRequestId(actionKey);
      setShiftUndo(null);
      router.refresh();
    } catch (error) {
      setShiftUndo(null);
      clearActionRequestId(actionKey);
      announceMutationError(error, actionKey);
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function submitLeave() {
    if (!leaveDraft.startDate || !leaveDraft.endDate) return announce("সঠিক তারিখ দিন।", false);
    const actionKey = "request-leave";
    setBusy("request-leave");
    try {
      const result = await mutate("/api/workforce/leave", "POST", { ...leaveDraft, requestId: actionRequestId(actionKey) });
      announce(
        result.duplicate ? "✓ Already saved — duplicate submit blocked" : "✓ Leave requested",
        true
      );
      clearActionRequestId(actionKey);
      setShowLeaveForm(false);
      setLeaveDraft((current) => ({ ...current, startDate: "", endDate: "", reason: "" }));
      router.refresh();
    } catch (error) {
      announceMutationError(error, actionKey);
    } finally {
      setBusy("");
    }
  }

  async function cancelLeaveAction(leaveId: string) {
    const actionKey = `cancel-leave:${leaveId}`;
    setBusy(actionKey);
    try {
      await mutate(`/api/workforce/leave/${encodeURIComponent(leaveId)}/cancel`, "POST", {
        requestId: actionRequestId(actionKey),
      });
      announce("✓ Leave request cancelled", true);
      clearActionRequestId(actionKey);
      router.refresh();
    } catch (error) {
      announceMutationError(error, actionKey);
    } finally {
      setBusy("");
    }
  }

  async function decide(leaveId: string, decision: "Approved" | "Rejected") {
    const actionKey = `decide:${decision}:${leaveId}`;
    setBusy(actionKey);
    try {
      await mutate(`/api/workforce/leave/${encodeURIComponent(leaveId)}/decide`, "POST", {
        decision,
        requestId: actionRequestId(actionKey),
      });
      announce(`✓ Leave ${decision.toLowerCase()}`, true);
      clearActionRequestId(actionKey);
      router.refresh();
    } catch (error) {
      announceMutationError(error, actionKey);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      {(canReadShifts || canReadLeave) && (
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
          <button
            type="button"
            disabled={!canReadShifts}
            onClick={() => setTab("shifts")}
            className={`min-h-11 rounded-lg px-2 py-2 text-xs font-semibold transition disabled:opacity-40 ${
              tab === "shifts" ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500"
            }`}
          >
            Shifts
          </button>
          <button
            type="button"
            disabled={!canReadLeave}
            onClick={() => setTab("leave")}
            className={`min-h-11 rounded-lg px-2 py-2 text-xs font-semibold transition disabled:opacity-40 ${
              tab === "leave" ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500"
            }`}
          >
            Leave
          </button>
        </div>
      )}

      {message && (
        <InlineNotice tone={message.good ? "success" : "error"}>{message.text}</InlineNotice>
      )}

      {shiftUndo && tab === "shifts" && (
        <section className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <span>Shift {shiftUndo.to.toLowerCase()}</span>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void undoShiftAction()}
            className="min-h-9 shrink-0 rounded-lg bg-white px-3 text-xs font-bold text-blue-800 ring-1 ring-blue-200 disabled:opacity-50"
          >
            {busy.startsWith("undo-shift:") ? "Undoing…" : "UNDO"}
          </button>
        </section>
      )}

      {tab === "shifts" && canReadShifts && (
        <div className="space-y-3">
          {shiftsError === "schema" && (
            <InlineNotice tone="warning" title="Schedule not provisioned yet">
              Staff_Shifts sheet এখনও provision করা হয়নি। Live tab provisioning একটি আলাদা reviewed operation।
            </InlineNotice>
          )}
          {shiftsError === "read" && (
            <InlineNotice tone="error" title="Schedule read failed">
              Schedule এখন load করা যায়নি। পরে আবার চেষ্টা করুন।
            </InlineNotice>
          )}
          {staffOptionsUnavailable && canManageShifts && (
            <InlineNotice tone="error" title="Staff directory unavailable">
              Staff list যাচাই করা যায়নি, তাই নতুন shift তৈরি বন্ধ রাখা হয়েছে।
            </InlineNotice>
          )}

          {canManageShifts && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Schedule a shift</h2>
                <button
                  type="button"
                  disabled={staffOptionsUnavailable || staffOptions.length === 0}
                  onClick={() => {
                    setEditingShiftId("");
                    setShowShiftForm((value) => !value);
                  }}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                >
                  {showShiftForm ? "Close" : "New shift"}
                </button>
              </div>
              {showShiftForm && (
                <div className="mt-3 space-y-3">
                  <select
                    value={shiftDraft.staffId}
                    disabled={Boolean(editingShiftId)}
                    onChange={(event) => {
                      const selected = staffOptions.find((item) => item.staffId === event.target.value);
                      setShiftDraft((current) => ({
                        ...current,
                        staffId: event.target.value,
                        department: (selected?.primaryDepartment || current.department) as Department,
                      }));
                    }}
                    className={inputClass}
                  >
                    {staffOptions.map((item) => (
                      <option key={item.staffId} value={item.staffId}>
                        {item.fullName} · {item.primaryDepartment}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={shiftDraft.shiftDate}
                    onChange={(event) => setShiftDraft((current) => ({ ...current, shiftDate: event.target.value }))}
                    className={inputClass}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      value={shiftDraft.startTime}
                      onChange={(event) => setShiftDraft((current) => ({ ...current, startTime: event.target.value }))}
                      className={inputClass}
                    />
                    <input
                      type="time"
                      value={shiftDraft.endTime}
                      onChange={(event) => setShiftDraft((current) => ({ ...current, endTime: event.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <input
                    placeholder="Notes (optional)"
                    value={shiftDraft.notes}
                    onChange={(event) => setShiftDraft((current) => ({ ...current, notes: event.target.value }))}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={busy === (editingShiftId ? `update-shift:${editingShiftId}` : "create-shift")}
                    onClick={submitShift}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === (editingShiftId ? `update-shift:${editingShiftId}` : "create-shift") && <Spinner size="sm" className="border-white/30 border-t-white" />}
                    {busy === (editingShiftId ? `update-shift:${editingShiftId}` : "create-shift")
                      ? "Saving…"
                      : editingShiftId ? "Update Draft" : "Save as Draft"}
                  </button>
                </div>
              )}
            </section>
          )}

          <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {canManageShifts ? "Department shifts" : "My shifts"}
              </h2>
            </div>
            {(canManageShifts ? initialShifts : ownShifts).map((row) => (
              <div key={row.shiftId} className="flex min-h-16 flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <div className="min-w-40 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {row.staffName} · {row.shiftDate}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {row.startTime}–{row.endTime} · {row.department}
                  </p>
                </div>
                <StatusBadge tone={shiftStatusTone(row.status)}>{row.status}</StatusBadge>
                {canManageShifts && row.status === "Draft" && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingShiftId(row.shiftId);
                      setShiftDraft({
                        staffId: row.staffId,
                        department: row.department,
                        shiftDate: row.shiftDate,
                        startTime: row.startTime,
                        endTime: row.endTime,
                        notes: row.notes,
                      });
                      setShowShiftForm(true);
                    }}
                    className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  >
                    Edit
                  </button>
                )}
                {canManageShifts && row.status === "Draft" && (
                  <button
                    type="button"
                    disabled={busy === `publish:${row.shiftId}`}
                    onClick={() => shiftAction(row.shiftId, "publish")}
                    className="min-h-11 rounded-lg bg-blue-800 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
                {canManageShifts && row.status !== "Cancelled" && (
                  <button
                    type="button"
                    disabled={busy === `cancel:${row.shiftId}`}
                    onClick={() => shiftAction(row.shiftId, "cancel")}
                    className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
            {(canManageShifts ? initialShifts : ownShifts).length === 0 && !shiftsError && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">কোনো shift নেই।</p>
            )}
          </section>
        </div>
      )}

      {tab === "leave" && canReadLeave && (
        <div className="space-y-3">
          {leaveError === "schema" && (
            <InlineNotice tone="warning" title="Leave records not provisioned yet">
              Leave_Requests sheet এখনও provision করা হয়নি। Live tab provisioning একটি আলাদা reviewed operation।
            </InlineNotice>
          )}
          {leaveError === "read" && (
            <InlineNotice tone="error" title="Leave read failed">
              Leave records এখন load করা যায়নি। পরে আবার চেষ্টা করুন।
            </InlineNotice>
          )}

          {canRequestLeave && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Request leave</h2>
                <button
                  type="button"
                  onClick={() => setShowLeaveForm((value) => !value)}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                >
                  {showLeaveForm ? "Close" : "New request"}
                </button>
              </div>
              {showLeaveForm && (
                <div className="mt-3 space-y-3">
                  <select
                    value={leaveDraft.leaveType}
                    onChange={(event) =>
                      setLeaveDraft((current) => ({
                        ...current,
                        leaveType: event.target.value as (typeof LEAVE_TYPES)[number],
                      }))
                    }
                    className={inputClass}
                  >
                    {LEAVE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={leaveDraft.startDate}
                      onChange={(event) => setLeaveDraft((current) => ({ ...current, startDate: event.target.value }))}
                      className={inputClass}
                    />
                    <input
                      type="date"
                      value={leaveDraft.endDate}
                      onChange={(event) => setLeaveDraft((current) => ({ ...current, endDate: event.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    placeholder="Reason (optional)"
                    value={leaveDraft.reason}
                    onChange={(event) => setLeaveDraft((current) => ({ ...current, reason: event.target.value }))}
                    className={`${inputClass} min-h-20 py-2`}
                  />
                  <button
                    type="button"
                    disabled={busy === "request-leave"}
                    onClick={submitLeave}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "request-leave" && <Spinner size="sm" className="border-white/30 border-t-white" />}
                    {busy === "request-leave" ? "Saving…" : "Submit request"}
                  </button>
                </div>
              )}
            </section>
          )}

          {canDecideLeave && (
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Pending decisions</h2>
              </div>
              {pendingDecisions.map((row) => (
                <div key={row.leaveId} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {row.staffName} · {row.leaveType} · {row.startDate}–{row.endDate}
                  </p>
                  {row.reason && <p className="mt-0.5 text-[11px] text-slate-500">{row.reason}</p>}
                  {row.staffId === currentStaffId ? (
                    <p className="mt-2 text-[11px] text-amber-700">নিজের request নিজে decide করা যায় না।</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy === `decide:Approved:${row.leaveId}` || busy === `decide:Rejected:${row.leaveId}`}
                        onClick={() => decide(row.leaveId, "Approved")}
                        className="min-h-11 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy === `decide:Approved:${row.leaveId}` || busy === `decide:Rejected:${row.leaveId}`}
                        onClick={() => decide(row.leaveId, "Rejected")}
                        className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      {canCancelAnyLeave && (
                        <button
                          type="button"
                          disabled={busy === `cancel-leave:${row.leaveId}`}
                          onClick={() => cancelLeaveAction(row.leaveId)}
                          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {pendingDecisions.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">কোনো pending request নেই।</p>
              )}
            </section>
          )}

          <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">My leave requests</h2>
            </div>
            {ownLeave.map((row) => (
              <div key={row.leaveId} className="flex min-h-16 items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {row.leaveType} · {row.startDate}–{row.endDate}
                  </p>
                  {row.decisionNote && <p className="mt-0.5 text-[11px] text-slate-500">{row.decisionNote}</p>}
                </div>
                <StatusBadge tone={leaveStatusTone(row.status)}>{row.status}</StatusBadge>
                {row.status === "Pending" && (
                  <button
                    type="button"
                    disabled={busy === `cancel-leave:${row.leaveId}`}
                    onClick={() => cancelLeaveAction(row.leaveId)}
                    className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
            {ownLeave.length === 0 && !leaveError && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">কোনো leave request নেই।</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
