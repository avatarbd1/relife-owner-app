"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ToolsCapabilities } from "@/lib/webos/parity";
import type { InventoryItem } from "@/lib/webos/inventory";

type PatientOption = { patientId: string; fullName: string };
type ReceiptOption = { receiptNo: string; patientName: string; amount: number };

async function jsonPost(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

function ActionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const inputClass =
  "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const buttonClass =
  "min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50";

export default function ParityToolsClient({
  capabilities,
  patients,
  inventoryItems,
  todayReceipts,
}: {
  capabilities: ToolsCapabilities;
  patients: PatientOption[];
  inventoryItems: InventoryItem[];
  todayReceipts: ReceiptOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [clinicalAnswer, setClinicalAnswer] = useState("");
  const [staffAnswer, setStaffAnswer] = useState("");
  const [inventoryItem, setInventoryItem] = useState(inventoryItems[0]?.itemName || "");
  const [inventoryChange, setInventoryChange] = useState("");
  const [inventoryReason, setInventoryReason] = useState("");
  const [clinicalPatient, setClinicalPatient] = useState("");
  const [clinicalQuestion, setClinicalQuestion] = useState("");
  const [staffQuestion, setStaffQuestion] = useState("");
  const [casePatient, setCasePatient] = useState(patients[0]?.patientId || "");
  const [caseTitle, setCaseTitle] = useState("");
  const [reportPatient, setReportPatient] = useState(patients[0]?.patientId || "");
  const [correctionReceipt, setCorrectionReceipt] = useState(todayReceipts[0]?.receiptNo || "");

  const sortedPatients = useMemo(
    () => [...patients].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [patients]
  );

  async function run(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setMessage("");
    try {
      await fn();
      if ("vibrate" in navigator) navigator.vibrate(10);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  const anyAction =
    capabilities.inventoryWrite ||
    capabilities.clinicalAi ||
    capabilities.staffAi ||
    capabilities.caseStudyGenerate ||
    capabilities.reportUpload ||
    capabilities.corrections;
  if (!anyAction) return null;

  return (
    <div className="mb-5 space-y-3">
      {message && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {message}
        </div>
      )}

      {capabilities.inventoryWrite && inventoryItems.length > 0 && (
        <ActionCard title="Inventory adjustment" subtitle="Physio stock only · every change is logged and audited">
          <div className="space-y-2">
            <select className={inputClass} value={inventoryItem} onChange={(event) => setInventoryItem(event.target.value)}>
              {inventoryItems.map((item) => (
                <option key={item.itemId} value={item.itemName}>
                  {item.itemName} · {item.currentStock} {item.unit}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder="Change e.g. -1 / 10"
                value={inventoryChange}
                onChange={(event) => setInventoryChange(event.target.value)}
              />
              <input
                className={inputClass}
                placeholder="Reason"
                value={inventoryReason}
                onChange={(event) => setInventoryReason(event.target.value)}
              />
            </div>
            <button
              className={buttonClass}
              disabled={busy === "inventory" || !inventoryItem || !inventoryChange}
              onClick={() =>
                run("inventory", async () => {
                  const payload = await jsonPost("/api/tools/inventory", {
                    itemName: inventoryItem,
                    change: Number(inventoryChange),
                    reason: inventoryReason,
                  });
                  setMessage(`${payload.itemName}: ${payload.previous} → ${payload.newBalance}`);
                  setInventoryChange("");
                  setInventoryReason("");
                  router.refresh();
                })
              }
            >
              {busy === "inventory" ? "Saving…" : "Save stock change"}
            </button>
          </div>
        </ActionCard>
      )}

      {capabilities.clinicalAi && (
        <ActionCard title="Clinical AI" subtitle="Only minimum necessary Physio clinical context is sent; identifiers are removed">
          <div className="space-y-2">
            <select className={inputClass} value={clinicalPatient} onChange={(event) => setClinicalPatient(event.target.value)}>
              <option value="">General question · no patient context</option>
              {sortedPatients.map((patient) => (
                <option key={patient.patientId} value={patient.patientId}>
                  {patient.fullName} · {patient.patientId}
                </option>
              ))}
            </select>
            <textarea
              className={`${inputClass} min-h-24 py-3`}
              placeholder="Clinical question / presentation"
              value={clinicalQuestion}
              onChange={(event) => setClinicalQuestion(event.target.value)}
            />
            <button
              className={buttonClass}
              disabled={busy === "clinical-ai" || clinicalQuestion.trim().length < 3}
              onClick={() =>
                run("clinical-ai", async () => {
                  const payload = await jsonPost("/api/tools/clinical-ai", {
                    patientId: clinicalPatient || undefined,
                    question: clinicalQuestion,
                  });
                  setClinicalAnswer(payload.answer || "");
                })
              }
            >
              {busy === "clinical-ai" ? "Thinking…" : "Ask Clinical AI"}
            </button>
            {clinicalAnswer && (
              <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                {clinicalAnswer}
              </div>
            )}
          </div>
        </ActionCard>
      )}

      {capabilities.staffAi && (
        <ActionCard title="Owner AI query" subtitle="De-identified Physio operational fields only; no whole-sheet dumps">
          <div className="space-y-2">
            <textarea
              className={`${inputClass} min-h-20 py-3`}
              placeholder="যেমন: আজকে মোট কত টাকা আদায় হয়েছে?"
              value={staffQuestion}
              onChange={(event) => setStaffQuestion(event.target.value)}
            />
            <button
              className={buttonClass}
              disabled={busy === "staff-ai" || staffQuestion.trim().length < 3}
              onClick={() =>
                run("staff-ai", async () => {
                  const payload = await jsonPost("/api/tools/staff-ai", { question: staffQuestion });
                  setStaffAnswer(payload.answer || "");
                })
              }
            >
              {busy === "staff-ai" ? "Analyzing…" : "Ask operations AI"}
            </button>
            {staffAnswer && (
              <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                {staffAnswer}
              </div>
            )}
          </div>
        </ActionCard>
      )}

      {capabilities.caseStudyGenerate && patients.length > 0 && (
        <ActionCard title="Case study lesson" subtitle="Generates an AI-assisted learning lesson from an authorized Physio case">
          <div className="space-y-2">
            <select className={inputClass} value={casePatient} onChange={(event) => setCasePatient(event.target.value)}>
              {sortedPatients.map((patient) => (
                <option key={patient.patientId} value={patient.patientId}>
                  {patient.fullName} · {patient.patientId}
                </option>
              ))}
            </select>
            <input className={inputClass} placeholder="Lesson title (optional)" value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} />
            <button
              className={buttonClass}
              disabled={busy === "case-study" || !casePatient}
              onClick={() =>
                run("case-study", async () => {
                  const payload = await jsonPost("/api/tools/case-study", {
                    patientId: casePatient,
                    lessonTitle: caseTitle,
                  });
                  setMessage(`Case study lesson ${payload.lessonNumber} created`);
                  setCaseTitle("");
                  router.refresh();
                })
              }
            >
              {busy === "case-study" ? "Generating…" : "Generate lesson"}
            </button>
          </div>
        </ActionCard>
      )}

      {capabilities.reportUpload && patients.length > 0 && (
        <ActionCard title="Patient report upload" subtitle="PDF/photo → Google Drive + 14_Reports metadata; max 12 MB">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void run("report", async () => {
                const formData = new FormData(form);
                formData.set("patientId", reportPatient);
                const response = await fetch("/api/tools/report-upload", { method: "POST", body: formData });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
                setMessage(`Report ${payload.reportId} uploaded`);
                form.reset();
                router.refresh();
              });
            }}
          >
            <select className={inputClass} value={reportPatient} onChange={(event) => setReportPatient(event.target.value)}>
              {sortedPatients.map((patient) => (
                <option key={patient.patientId} value={patient.patientId}>
                  {patient.fullName} · {patient.patientId}
                </option>
              ))}
            </select>
            <input
              className={`${inputClass} py-2`}
              type="file"
              name="file"
              required
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            />
            <button className={buttonClass} disabled={busy === "report" || !reportPatient} type="submit">
              {busy === "report" ? "Uploading…" : "Upload report"}
            </button>
          </form>
        </ActionCard>
      )}

      {capabilities.corrections && todayReceipts.length > 0 && (
        <ActionCard title="আজকের entry correction" subtitle="Owner only · latest patient entry + stale-state guard + atomic reversal + Delete_Log">
          <div className="space-y-2">
            <select className={inputClass} value={correctionReceipt} onChange={(event) => setCorrectionReceipt(event.target.value)}>
              {todayReceipts.map((receipt) => (
                <option key={receipt.receiptNo} value={receipt.receiptNo}>
                  {receipt.receiptNo} · {receipt.patientName} · ৳{receipt.amount}
                </option>
              ))}
            </select>
            <button
              className="min-h-12 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
              disabled={busy === "correction" || !correctionReceipt}
              onClick={() => {
                if (!window.confirm(`Delete and reverse ${correctionReceipt}? This is limited to today's latest entry for that patient.`)) return;
                void run("correction", async () => {
                  const payload = await jsonPost("/api/tools/correction", {
                    receiptNo: correctionReceipt,
                    confirmReceiptNo: correctionReceipt,
                  });
                  setMessage(`${payload.receiptNo} reversed and moved to Delete_Log`);
                  setCorrectionReceipt("");
                  router.refresh();
                });
              }}
            >
              {busy === "correction" ? "Reversing…" : "Delete + reverse entry"}
            </button>
          </div>
        </ActionCard>
      )}
    </div>
  );
}
