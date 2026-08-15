"use client";

import Link from "next/link";
import { useState } from "react";
import { InlineNotice, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Tab = "general" | "access" | "data" | "backup";
type RoleSummary = { role: string; actions: string[]; staffCount: number };
type StaffSummary = { staffId: string; fullName: string; roles: string[]; departments: string[]; ready: boolean };

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "general", label: "General" },
  { id: "access", label: "Access Control" },
  { id: "data", label: "Data" },
  { id: "backup", label: "Backup" },
];

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-base font-semibold text-slate-900">{title}</h2>{subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}<div className="mt-4">{children}</div></section>;
}

export default function SettingsAdminClient({ roles, staff }: { roles: RoleSummary[]; staff: StaffSummary[] }) {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-horizontal-scroll><div className="flex min-w-max gap-1" role="tablist" aria-label="Settings tabs">{TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); haptic("tap"); }} className={`min-h-11 rounded-lg px-4 text-xs font-semibold ${tab === item.id ? "bg-blue-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>{item.label}</button>)}</div></div>

      {tab === "general" && <div className="space-y-4">
        <Card title="Organization" subtitle="Current Owner App identity">
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">{[["System", "Relife Clinic OS"], ["Organization", "Relife"], ["Clinics", "Physiotherapy + Dental"]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 px-3 py-2.5"><span className="text-xs text-slate-500">{label}</span><span className="text-xs font-semibold text-slate-900">{value}</span></div>)}</div>
          <InlineNotice tone="neutral" className="mt-3">Organization profile editing is not exposed by the current backend, so this page does not show a fake Save action.</InlineNotice>
        </Card>
        <Card title="System defaults" subtitle="Runtime conventions used across the app"><div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-blue-50 p-3"><p className="text-[10px] font-medium text-blue-700">Timezone</p><p className="mt-1 text-xs font-semibold text-blue-950">Asia/Dhaka · UTC+6</p></div><div className="rounded-lg bg-emerald-50 p-3"><p className="text-[10px] font-medium text-emerald-700">Currency</p><p className="mt-1 text-xs font-semibold text-emerald-950">BDT · ৳</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-medium text-slate-500">Language</p><p className="mt-1 text-xs font-semibold text-slate-900">Bangla + English</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-medium text-slate-500">Date</p><p className="mt-1 text-xs font-semibold text-slate-900">Clinic-local date</p></div></div></Card>
      </div>}

      {tab === "access" && <div className="space-y-4">
        <Card title="Roles & permissions" subtitle="Current server allowlist — UI does not grant permissions by itself.">
          <div className="space-y-2">{roles.map((item) => <article key={item.role} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{item.role}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.staffCount} active staff · {item.actions.length} allowed actions</p></div><StatusBadge tone={item.actions.length > 0 ? "success" : "warning"}>{item.actions.length > 0 ? "Configured" : "No access"}</StatusBadge></div><div className="mt-2 flex flex-wrap gap-1.5">{item.actions.slice(0, 8).map((action) => <span key={action} className="rounded-md bg-white px-2 py-1 text-[10px] text-slate-600 ring-1 ring-slate-200">{action}</span>)}{item.actions.length > 8 && <span className="rounded-md bg-white px-2 py-1 text-[10px] text-slate-500 ring-1 ring-slate-200">+{item.actions.length - 8} more</span>}</div></article>)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2"><Link href="/security/staff-access" className="flex min-h-11 items-center justify-center rounded-lg bg-blue-800 px-3 text-center text-xs font-semibold text-white">Staff setup</Link><Link href="/security" className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-center text-xs font-semibold text-slate-700">Security overview</Link></div>
        </Card>
        <Card title="Live staff mapping" subtitle="Staff_Department_Access-backed readiness"><div className="space-y-2">{staff.map((item) => <div key={item.staffId} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900">{item.fullName}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.staffId} · {item.roles.join(" · ") || "No role"}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.departments.join(" · ") || "No department mapping"}</p></div><StatusBadge tone={item.ready ? "success" : "error"}>{item.ready ? "Ready" : "Blocked"}</StatusBadge></div>)}</div></Card>
      </div>}

      {tab === "data" && <div className="space-y-4">
        <Card title="Data & exports" subtitle="Only supported exports and evidence paths are shown."><div className="space-y-2"><Link href="/audit" className="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-50"><span>Audit timeline + CSV export</span><span>→</span></Link><Link href="/finance/history" className="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-50"><span>Finance transaction evidence</span><span>→</span></Link><Link href="/reports" className="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-50"><span>Operational & financial reports</span><span>→</span></Link></div><InlineNotice tone="info" className="mt-3">Bulk patient/payment/session PDF or CSV export is not configured in the current backend. It is intentionally not simulated here.</InlineNotice></Card>
        <Card title="Data retention" subtitle="No configurable retention service is connected."><InlineNotice tone="neutral">Retention policy controls are unavailable in Owner App at present. Existing Sheets and Drive records remain governed by their current storage lifecycle.</InlineNotice></Card>
      </div>}

      {tab === "backup" && <div className="space-y-4">
        <Card title="Backup status" subtitle="Backend capability check"><div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><div><p className="text-sm font-semibold text-amber-900">Automated backup integration</p><p className="mt-0.5 text-xs leading-5 text-amber-800">Not configured in the current Owner App backend.</p></div><StatusBadge tone="warning">Unavailable</StatusBadge></div></Card>
        <Card title="Offline / sync" subtitle="Current PWA behavior">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><div><p className="text-sm font-semibold text-blue-950">Safe static cache</p><p className="mt-0.5 text-xs leading-5 text-blue-800">Manifest and install icons may be cached. Authenticated pages, APIs, patient, clinical and finance data remain network-only.</p></div><StatusBadge tone="info">Online clinic data</StatusBadge></div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">Financial and clinical writes require internet and are never queued silently.</p>
          <Link href="/pwa" className="mt-3 flex min-h-11 items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100"><span>Open PWA diagnostics</span><span>→</span></Link>
        </Card>
        <Card title="Danger zone" subtitle="Destructive administration"><InlineNotice tone="error">Factory reset / delete-all is not implemented. No destructive placeholder button is exposed.</InlineNotice></Card>
      </div>}
    </div>
  );
}
