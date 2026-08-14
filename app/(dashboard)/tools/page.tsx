import Link from "next/link";
import ParityToolsClient from "@/components/ParityToolsClient";
import { formatBDT } from "@/lib/format";
import { getPhysioInventorySnapshot } from "@/lib/webos/inventory";
import { getParitySnapshot } from "@/lib/webos/parity";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children = "কোনো রেকর্ড নেই।" }: { children?: React.ReactNode }) {
  return <p className="py-5 text-center text-xs text-slate-400">{children}</p>;
}

export default async function ToolsPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const params = searchParams ? await searchParams : {};
  const snapshot = await getParitySnapshot(context, params.date);
  const inventory = snapshot.capabilities.inventory
    ? await getPhysioInventorySnapshot(context)
    : null;

  const receiptOptions = snapshot.dailyRegister.rows
    .filter((row) => Boolean(row.receiptNo))
    .map((row) => ({
      receiptNo: row.receiptNo,
      patientName: row.patientName,
      amount: row.amount,
    }));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
          Telegram → Web parity
        </p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Physio Operations & Tools</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              Daily Register, treatment history, reports, inventory, salary history, AI, case study, learning, audit, correction and admin diagnostics.
              Dental clinical এই batch-এ ইচ্ছাকৃতভাবে বাদ।
            </p>
          </div>
          {context.roles.includes("Owner") && (
            <Link
              href="/more"
              className="min-h-11 shrink-0 rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-white active:bg-white/20"
            >
              Approvals
            </Link>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-xl bg-white/10 p-2">
            <p className="text-sm font-bold">{snapshot.integrations.aiConfigured ? "Ready" : "Key needed"}</p>
            <p className="text-slate-300">AI</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <p className="text-sm font-bold">{snapshot.integrations.driveUploadConfigured ? "Ready" : "Config"}</p>
            <p className="text-slate-300">Drive upload</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <p className="text-sm font-bold">Physio</p>
            <p className="text-slate-300">Locked scope</p>
          </div>
        </div>
      </section>

      <ParityToolsClient
        capabilities={snapshot.capabilities}
        patients={snapshot.visiblePatients}
        inventoryItems={inventory?.items || []}
        todayReceipts={receiptOptions}
      />

      {snapshot.capabilities.dailyRegister && (
        <Section title="📋 Daily Register" subtitle="Bot parity: 06_Payments ভিত্তিক date register · Physio only">
          <form method="get" className="mb-3 flex gap-2">
            <input
              type="date"
              name="date"
              defaultValue={snapshot.date}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm"
            />
            <button className="min-h-11 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white">
              দেখুন
            </button>
          </form>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold">{snapshot.dailyRegister.rows.length}</p><p className="text-[10px] text-slate-500">Entries</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold">{snapshot.dailyRegister.totalSessions}</p><p className="text-[10px] text-slate-500">Sessions</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold">{formatBDT(snapshot.dailyRegister.totalPaid)}</p><p className="text-[10px] text-slate-500">Paid</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold">{formatBDT(snapshot.dailyRegister.totalDue)}</p><p className="text-[10px] text-slate-500">Due snapshot</p></div>
          </div>
          <div className="space-y-2">
            {snapshot.dailyRegister.rows.map((row) => (
              <div key={row.receiptNo || `${row.patientId}-${row.sl}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{row.sl || "—"}. {row.patientName || row.patientId}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{row.receiptNo} · {row.sessions} session{row.service ? ` · ${row.service}` : ""}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${row.status === "Paid" ? "bg-emerald-100 text-emerald-700" : row.status === "Partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                    {row.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <span>Paid {formatBDT(row.amount)}</span><span>Discount {formatBDT(row.discount)}</span><span>Due {formatBDT(row.due)}</span><span>{row.paymentMethod}</span>
                </div>
              </div>
            ))}
            {snapshot.dailyRegister.rows.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.inventory && inventory && (
        <Section title="📦 Inventory" subtitle="Department + Item keyed stock · Auto-Registration / Auto-Session logs preserved">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {inventory.items.map((item) => (
              <div key={item.itemId} className={`rounded-xl border p-3 ${item.lowStock ? "border-red-200 bg-red-50" : "border-slate-100 bg-slate-50"}`}>
                <p className="text-xs font-semibold text-slate-900">{item.itemName}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{item.currentStock} <span className="text-[10px] font-medium text-slate-400">{item.unit}</span></p>
                <p className="text-[10px] text-slate-500">Minimum {item.minimumStock}{item.lowStock ? " · LOW" : ""}</p>
              </div>
            ))}
          </div>
          <details className="mt-3 rounded-xl bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">Recent stock log ({inventory.recentLog.length})</summary>
            <div className="mt-2 space-y-2">
              {inventory.recentLog.map((row, index) => (
                <div key={`${row.timestamp}-${row.itemId}-${index}`} className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2 text-[11px]">
                  <div><p className="font-medium text-slate-700">{row.itemName} · {row.reason}</p><p className="text-slate-400">{row.timestamp} · {row.staff}</p></div>
                  <p className="shrink-0 font-semibold text-slate-700">{row.change > 0 ? "+" : ""}{row.change} → {row.newBalance}</p>
                </div>
              ))}
            </div>
          </details>
        </Section>
      )}

      {snapshot.capabilities.treatmentHistory && (
        <Section title="📜 Treatment History" subtitle="05_Treatments · newest first · Physio only">
          <div className="space-y-2">
            {snapshot.treatments.map((row) => (
              <Link key={row.treatmentId} href={`/patients/${encodeURIComponent(row.patientId)}/clinical`} className="block rounded-xl border border-slate-100 bg-slate-50 p-3 active:bg-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.patientName || row.patientId}</p><p className="text-[11px] text-slate-500">{row.date} · Session {row.sessionNo} · {row.therapist}</p></div>
                  <span className="shrink-0 text-[10px] text-slate-400">{row.treatmentId}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{row.treatmentGiven || row.diagnosis || "Treatment note"}</p>
                {(row.painBefore || row.painAfter) && <p className="mt-1 text-[11px] text-slate-500">Pain: {row.painBefore || "—"} → {row.painAfter || "—"}</p>}
              </Link>
            ))}
            {snapshot.treatments.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.reportLibrary && (
        <Section title="🗂️ Patient Reports" subtitle="14_Reports · legacy Telegram metadata + new Drive uploads">
          <div className="space-y-2">
            {snapshot.reports.map((report) => (
              <div key={report.reportId} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{report.patientName || report.patientId}</p><p className="text-[11px] text-slate-500">{report.fileName || report.reportId} · {report.uploadDate}</p></div>
                  {report.driveLink ? <a className="shrink-0 rounded-lg bg-white px-2.5 py-2 text-[11px] font-semibold text-emerald-700 ring-1 ring-slate-200" href={report.driveLink} target="_blank" rel="noreferrer">Open</a> : <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-700">Telegram legacy</span>}
                </div>
              </div>
            ))}
            {snapshot.reports.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.caseStudy && (
        <Section title="📚 Case Studies" subtitle="15_Case_Studies · patient scope resolved before display">
          <div className="space-y-2">
            {snapshot.caseStudies.map((item) => (
              <details key={item.caseStudyId} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">Lesson {item.lessonNumber}: {item.lessonTitle || item.patientName}</summary>
                <p className="mt-1 text-[11px] text-slate-500">{item.patientName} · {item.timestamp} · {item.createdBy}</p>
                <div className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-700">{item.content}</div>
              </details>
            ))}
            {snapshot.caseStudies.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.salaryHistory && (
        <Section title="💰 Salary History" subtitle="13_Salary · Physio payments/advance history">
          <div className="space-y-2">
            {snapshot.salaries.map((row) => (
              <div key={row.paymentId} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div><p className="text-sm font-semibold text-slate-900">{row.staffId} · {formatBDT(row.amount)}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.date} · {row.month} · {row.status || "Recorded"}</p><p className="mt-1 text-[11px] text-slate-500">{row.note}</p></div>
                <span className="shrink-0 text-[10px] text-slate-400">{row.paidFrom}</span>
              </div>
            ))}
            {snapshot.salaries.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.learning && (
        <Section title="🧠 Learning Progress" subtitle="18_Learning_Progress · self or authorized team view">
          <div className="space-y-2">
            {snapshot.learning.map((row, index) => (
              <div key={`${row.staffId}-${row.timestamp}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-900">{row.fullName || row.staffId} · {row.type}</p><span className={`rounded-full px-2 py-1 text-[10px] ${row.correct.toLowerCase() === "true" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{row.correct || "Recorded"}</span></div>
                <p className="mt-1 text-[11px] text-slate-500">{row.date} · {row.category} · {row.itemId}</p>
              </div>
            ))}
            {snapshot.learning.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {(snapshot.capabilities.corrections || snapshot.capabilities.audit) && (
        <Section title="🗑️ Correction / Delete Log" subtitle="16_Delete_Log · raw destructive actions stay auditable">
          <div className="space-y-2">
            {snapshot.deleteLog.map((row, index) => (
              <div key={`${row.receiptNo}-${row.timestamp}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between gap-3"><p className="font-semibold text-slate-900">{row.receiptNo} · {row.patientName || row.patientId}</p><span className="text-[10px] text-slate-400">{row.type}</span></div>
                <p className="mt-1 text-slate-500">{row.timestamp} · by {row.deletedBy} · {formatBDT(row.amount)} · {row.sessions} sessions</p>
              </div>
            ))}
            {snapshot.deleteLog.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.audit && (
        <Section title="🛡️ Data Audit" subtitle="20_Data_Audit · latest Physio actions">
          <div className="space-y-2">
            {snapshot.audit.map((row) => (
              <details key={row.auditId} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-900">{row.action} · {row.entityType} {row.entityId}</summary>
                <p className="mt-1 text-[11px] text-slate-500">{row.timestamp} · actor {row.actorId}{row.patientId ? ` · patient ${row.patientId}` : ""}</p>
                {row.reason && <p className="mt-2 text-[11px] leading-5 text-slate-600">{row.reason}</p>}
              </details>
            ))}
            {snapshot.audit.length === 0 && <Empty />}
          </div>
        </Section>
      )}

      {snapshot.capabilities.settings && (
        <Section title="⚙️ Staff & Access Diagnostics" subtitle="Server-authorized role/department mapping · no role cookie or client role switching">
          <div className="space-y-2">
            {snapshot.staff.map((staff) => (
              <div key={staff.staffId} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{staff.fullName}</p><p className="text-[11px] text-slate-500">{staff.staffId} · {staff.roles.join(" + ") || "No role"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${staff.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{staff.status}</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500"><p>Primary: <b className="text-slate-700">{staff.primaryDepartment || "—"}</b></p><p>Access: <b className="text-slate-700">{staff.departmentAccess.join(", ")}</b></p><p>Clinical: <b className="text-slate-700">{staff.clinicalWriteScope || "—"}</b></p><p>Finance: <b className="text-slate-700">{staff.financialAccess || "—"}</b></p></div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
