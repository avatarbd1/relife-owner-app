"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental" | "All";
type Role =
  | "Manager"
  | "Receptionist"
  | "Therapist"
  | "Dentist"
  | "Dental_Assistant"
  | "Auditor"
  | "System Admin";

type StaffItem = {
  staffId: string;
  fullName: string;
  phone: string;
  status: "Active" | "Inactive";
  primaryDepartment: Department;
  role: Role;
  roles: string[];
  departmentAccess: Department[];
  salary: number;
  clinicalWriteScope: string;
};

type Draft = {
  fullName: string;
  phone: string;
  role: Role;
  primaryDepartment: Department;
  departmentAccess: Department[];
  salary: string;
  dentalTemporaryClinical: boolean;
  status: "Active" | "Inactive";
};

const ROLE_OPTIONS: Role[] = [
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
  "Dental_Assistant",
  "Auditor",
  "System Admin",
];

const emptyDraft = (): Draft => ({
  fullName: "",
  phone: "",
  role: "Receptionist",
  primaryDepartment: "Physio",
  departmentAccess: ["Physio"],
  salary: "0",
  dentalTemporaryClinical: false,
  status: "Active",
});

function draftFor(item: StaffItem): Draft {
  return {
    fullName: item.fullName,
    phone: item.phone,
    role: item.role,
    primaryDepartment: item.primaryDepartment,
    departmentAccess: item.departmentAccess.length ? item.departmentAccess : [item.primaryDepartment],
    salary: String(item.salary || 0),
    dentalTemporaryClinical: item.clinicalWriteScope === "Dental_Temporary_Data_Entry",
    status: item.status,
  };
}

function friendlyError(value: unknown): string {
  const code = String(value || "");
  const messages: Record<string, string> = {
    ACCESS_DENIED: "Owner access required.",
    STAFF_NAME_REQUIRED: "Staff name is required.",
    INVALID_STAFF_PHONE: "Phone number is invalid.",
    INVALID_STAFF_ROLE: "Role is invalid.",
    INVALID_STAFF_DEPARTMENT: "Department is invalid.",
    INVALID_STAFF_DEPARTMENT_ACCESS: "At least one department access is required.",
    PRIMARY_DEPARTMENT_OUTSIDE_ACCESS: "Primary department must be inside the selected access scope.",
    THERAPIST_DEPARTMENT_INVALID: "Therapist must be Physio scoped.",
    DENTAL_ROLE_DEPARTMENT_INVALID: "Dentist/Dental Assistant must be Dental scoped.",
    INVALID_STAFF_SALARY: "Salary is invalid.",
    STAFF_PHONE_DUPLICATE: "Another staff profile already uses this phone number.",
    OWNER_PROFILE_IMMUTABLE: "Owner profile cannot be changed here.",
    STAFF_NOT_FOUND: "Staff profile was not found.",
    STAFF_SCHEMA_MISMATCH: "Staff sheet schema is unavailable. No change was saved.",
    STAFF_UNDO_CONFLICT: "Staff profile changed after deactivation. Undo was not applied.",
  };
  return messages[code] || code || "Staff change failed.";
}

export default function StaffManagementClient({ staff }: { staff: StaffItem[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const [deactivateUndo, setDeactivateUndo] = useState<StaffItem | null>(null);
  const sorted = useMemo(
    () => [...staff].sort((a, b) => Number(b.status === "Active") - Number(a.status === "Active") || a.fullName.localeCompare(b.fullName)),
    [staff]
  );

  useEffect(() => {
    if (!deactivateUndo) return;
    const timer = window.setTimeout(() => setDeactivateUndo(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [deactivateUndo]);

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setShowForm(true);
    setMessage(null);
  }

  function startEdit(item: StaffItem) {
    setEditingId(item.staffId);
    setDraft(draftFor(item));
    setShowForm(true);
    setMessage(null);
  }

  function applyRole(role: Role) {
    if (role === "Therapist") {
      setDraft((current) => ({ ...current, role, primaryDepartment: "Physio", departmentAccess: ["Physio"], dentalTemporaryClinical: false }));
      return;
    }
    if (role === "Dentist" || role === "Dental_Assistant") {
      setDraft((current) => ({ ...current, role, primaryDepartment: "Dental", departmentAccess: ["Dental"], dentalTemporaryClinical: false }));
      return;
    }
    if (role === "Auditor" || role === "System Admin") {
      setDraft((current) => ({ ...current, role, primaryDepartment: "All", departmentAccess: ["All"], dentalTemporaryClinical: false }));
      return;
    }
    setDraft((current) => ({ ...current, role, dentalTemporaryClinical: false }));
  }

  function toggleDepartment(department: Department) {
    setDraft((current) => {
      if (department === "All") {
        return { ...current, departmentAccess: ["All"], primaryDepartment: current.primaryDepartment === "All" ? "All" : current.primaryDepartment };
      }
      const withoutAll = current.departmentAccess.filter((item) => item !== "All");
      const next = withoutAll.includes(department)
        ? withoutAll.filter((item) => item !== department)
        : [...withoutAll, department];
      const safe = next.length ? next : [department];
      const primary = current.primaryDepartment === "All" || !safe.includes(current.primaryDepartment)
        ? department
        : current.primaryDepartment;
      return { ...current, departmentAccess: safe, primaryDepartment: primary };
    });
  }

  async function save() {
    const endpoint = editingId ? `/api/staff/${encodeURIComponent(editingId)}` : "/api/staff";
    const method = editingId ? "PATCH" : "POST";
    setBusy(editingId || "create");
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: draft.fullName,
          phone: draft.phone,
          role: draft.role,
          primaryDepartment: draft.primaryDepartment,
          departmentAccess: draft.departmentAccess,
          salary: Number(draft.salary || 0),
          clinicalWriteScope: draft.dentalTemporaryClinical ? "Dental_Temporary_Data_Entry" : "",
          status: editingId ? draft.status : "Active",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(friendlyError(payload?.error));
      setMessage({ text: editingId ? "Staff profile updated." : `Staff created: ${payload.staffId}`, good: true });
      setShowForm(false);
      setEditingId(null);
      setDraft(emptyDraft());
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Staff change failed.", good: false });
      haptic("error");
    } finally {
      setBusy("");
    }
  }

  async function deactivate(item: StaffItem) {
    if (!window.confirm(`Deactivate ${item.fullName}? Existing records will remain; new access will be blocked.`)) return;
    setBusy(`deactivate:${item.staffId}`);
    setMessage(null);
    setDeactivateUndo(null);
    try {
      const response = await fetch(`/api/staff/${encodeURIComponent(item.staffId)}/deactivate`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(friendlyError(payload?.error));
      setMessage({ text: `${item.fullName} deactivated. Historical records were preserved.`, good: true });
      if (payload.changed !== false) setDeactivateUndo(item);
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Deactivate failed.", good: false });
      haptic("error");
    } finally {
      setBusy("");
    }
  }

  async function undoDeactivate() {
    if (!deactivateUndo || busy) return;
    const item = deactivateUndo;
    setBusy(`undo-deactivate:${item.staffId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/staff/${encodeURIComponent(item.staffId)}/undo-deactivate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedProfile: {
            fullName: item.fullName,
            phone: item.phone,
            role: item.role,
            primaryDepartment: item.primaryDepartment,
            salary: item.salary,
            clinicalWriteScope: item.clinicalWriteScope,
            departmentAccess: item.departmentAccess,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(friendlyError(payload?.error));
      setDeactivateUndo(null);
      setMessage({ text: `${item.fullName} reactivated. Deactivation was undone.`, good: true });
      haptic("success");
      router.refresh();
    } catch (error) {
      setDeactivateUndo(null);
      setMessage({ text: error instanceof Error ? error.message : "Undo failed.", good: false });
      haptic("error");
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  const clinicianLocked = draft.role === "Therapist" || draft.role === "Dentist" || draft.role === "Dental_Assistant";
  const allLocked = draft.role === "Auditor" || draft.role === "System Admin";
  const canTemporaryDental = draft.role === "Receptionist" && draft.primaryDepartment === "Dental" && draft.departmentAccess.length === 1 && draft.departmentAccess[0] === "Dental";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Staff authority</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">Staff management</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">Create, edit, reactivate or deactivate staff. Changes are server-authorized and audited.</p>
          </div>
          <button type="button" onClick={startCreate} className="min-h-11 rounded-lg bg-blue-800 px-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-900">New staff</button>
        </div>
      </section>

      {message && <InlineNotice tone={message.good ? "success" : "error"}>{message.text}</InlineNotice>}

      {deactivateUndo && (
        <section className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <span>{deactivateUndo.fullName} deactivated</span>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void undoDeactivate()}
            className="min-h-9 shrink-0 rounded-lg bg-white px-3 text-xs font-bold text-blue-800 ring-1 ring-blue-200 disabled:opacity-50"
          >
            {busy === `undo-deactivate:${deactivateUndo.staffId}` ? "Undoing…" : "UNDO"}
          </button>
        </section>
      )}

      {showForm && (
        <section className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-950">{editingId ? "Edit staff" : "Create staff"}</p>
              {editingId && <p className="mt-0.5 text-xs text-slate-500">{editingId}</p>}
            </div>
            <button type="button" onClick={() => setShowForm(false)} className="min-h-10 rounded-lg bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">Cancel</button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Full name
              <input value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950" autoComplete="name" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Phone <span className="font-normal text-slate-500">(optional)</span>
              <input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950" inputMode="tel" autoComplete="tel" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Role
              <select value={draft.role} onChange={(event) => applyRole(event.target.value as Role)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">Fixed monthly salary
              <input value={draft.salary} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950" inputMode="decimal" type="number" min="0" step="1" />
            </label>
            <label className="text-xs font-semibold text-slate-700">Primary department
              <select disabled={clinicianLocked || allLocked} value={draft.primaryDepartment} onChange={(event) => setDraft((current) => ({ ...current, primaryDepartment: event.target.value as Department }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100">
                <option value="Physio">Physio</option>
                <option value="Dental">Dental</option>
                <option value="All">All</option>
              </select>
            </label>
            {editingId && <label className="text-xs font-semibold text-slate-700">Status
              <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as "Active" | "Inactive" }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>}
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700">Department access</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["Physio", "Dental", "All"] as Department[]).map((department) => {
                const active = draft.departmentAccess.includes(department);
                const disabled = clinicianLocked || allLocked;
                return <button key={department} type="button" disabled={disabled} onClick={() => toggleDepartment(department)} className={`min-h-10 rounded-lg px-3 text-xs font-semibold ring-1 ${active ? "bg-blue-800 text-white ring-blue-800" : "bg-white text-slate-700 ring-slate-200"} disabled:opacity-60`}>{department}</button>;
              })}
            </div>
          </div>

          {canTemporaryDental && (
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900">
              <input type="checkbox" checked={draft.dentalTemporaryClinical} onChange={(event) => setDraft((current) => ({ ...current, dentalTemporaryClinical: event.target.checked }))} />
              Temporary Dental clinical data entry
            </label>
          )}

          <InlineNotice tone="neutral">Owner role cannot be created or edited here. Deactivation is soft: historical records stay intact.</InlineNotice>

          <button type="button" onClick={save} disabled={Boolean(busy)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-900 disabled:opacity-60">
            {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving staff" />}
            {editingId ? "Save changes" : "Create staff"}
          </button>
        </section>
      )}

      <section className="space-y-2">
        {sorted.map((item) => (
          <article key={item.staffId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold text-slate-950">{item.fullName}</p>
                  <StatusBadge tone={item.status === "Active" ? "success" : "neutral"}>{item.status}</StatusBadge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{item.staffId} · {item.role}</p>
                <p className="mt-1 text-xs text-slate-600">{item.phone || "No phone"} · Salary ৳{Number(item.salary || 0).toLocaleString("en-BD")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.departmentAccess.map((department) => <StatusBadge key={department} tone="info">{department}</StatusBadge>)}
                  {item.clinicalWriteScope === "Dental_Temporary_Data_Entry" && <StatusBadge tone="warning">Dental temp clinical</StatusBadge>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button type="button" onClick={() => startEdit(item)} disabled={Boolean(busy)} className="min-h-10 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-200">Edit</button>
                {item.status === "Active" && <button type="button" onClick={() => deactivate(item)} disabled={Boolean(busy)} className="min-h-10 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100">{busy === `deactivate:${item.staffId}` ? "Working…" : "Deactivate"}</button>}
              </div>
            </div>
          </article>
        ))}
        {sorted.length === 0 && <InlineNotice tone="neutral">No non-owner staff profiles found.</InlineNotice>}
      </section>
    </div>
  );
}
