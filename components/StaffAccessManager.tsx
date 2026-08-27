"use client";

import { useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type StaffItem = {
  staffId: string;
  fullName: string;
  roles: string[];
  departments: string[];
};

type LinkState = {
  staffId: string;
  url: string;
  expiresInSeconds: number;
} | null;

export default function StaffAccessManager({ staff }: { staff: StaffItem[] }) {
  const [busyId, setBusyId] = useState("");
  const [link, setLink] = useState<LinkState>(null);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  async function createLink(staffId: string) {
    setBusyId(staffId);
    setMessage(null);
    setLink(null);
    try {
      const response = await fetch("/api/staff/enrollment-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staffId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || !payload?.setupUrl) {
        throw new Error(payload?.error || "Setup link তৈরি করা যায়নি।");
      }
      setLink({ staffId, url: payload.setupUrl, expiresInSeconds: Number(payload.expiresInSeconds || 0) });
      setMessage({ text: "Setup link তৈরি হয়েছে। Staff-এর নিজের phone-এ পাঠান।", good: true });
      haptic("success");
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Setup link তৈরি ব্যর্থ হয়েছে।", good: false });
      haptic("error");
    } finally {
      setBusyId("");
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setMessage({ text: "Link copied.", good: true });
      haptic("success");
    } catch {
      setMessage({ text: "Copy করা যায়নি। Share button ব্যবহার করুন।", good: false });
      haptic("error");
    }
  }

  async function shareLink() {
    if (!link) return;
    const selected = staff.find((item) => item.staffId === link.staffId);
    const shareData = {
      title: "Relife Staff Access",
      text: `${selected?.fullName || "Staff"} — Relife access setup`,
      url: link.url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        haptic("success");
        return;
      } catch {
        return;
      }
    }
    await copyLink();
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Owner security</p>
            <h1 className="mt-1 text-2xl font-bold">Staff device access</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Public signup is closed. One-time enrollment links bind staff identity to their own passkey-capable device.</p>
          </div>
          <StatusBadge tone="success" className="border-white/10">Invite only</StatusBadge>
        </div>
      </section>

      {message && (
        <div className={message.good ? "relife-success-flash" : "relife-error-shake"}>
          <InlineNotice tone={message.good ? "success" : "error"}>{message.text}</InlineNotice>
        </div>
      )}

      {link && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-emerald-950">One-time setup link</p><p className="mt-1 text-xs text-emerald-800">For {staff.find((item) => item.staffId === link.staffId)?.fullName || link.staffId}</p></div>
            <StatusBadge tone="success">Ready</StatusBadge>
          </div>
          <p className="mt-3 break-all rounded-lg bg-white/70 p-2 text-[11px] leading-5 text-emerald-900 ring-1 ring-emerald-100">{link.url}</p>
          <p className="mt-2 text-xs text-emerald-800">প্রায় {Math.max(1, Math.round(link.expiresInSeconds / 60))} মিনিট valid; passkey যোগ হলে পুরোনো link আর কাজ করবে না।</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={copyLink} className="min-h-11 rounded-lg bg-white px-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">Copy</button>
            <button type="button" onClick={shareLink} className="min-h-11 rounded-lg bg-blue-800 px-3 text-sm font-semibold text-white shadow-md hover:bg-blue-900">Share</button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        {staff.map((item) => (
          <article key={item.staffId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.fullName}</p>
                <p className="mt-1 text-xs text-slate-500">{item.staffId} · {item.roles.join(" · ")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.departments.map((department) => <StatusBadge key={department} tone="info">{department}</StatusBadge>)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => createLink(item.staffId)}
                disabled={Boolean(busyId)}
                className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-800 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-900 disabled:shadow-none"
              >
                {busyId === item.staffId && <Spinner size="sm" className="border-white/30 border-t-white" label="Creating setup link" />}
                {busyId === item.staffId ? "Creating…" : "Setup link"}
              </button>
            </div>
          </article>
        ))}
        {staff.length === 0 && <InlineNotice tone="neutral">No active staff ready for web access.</InlineNotice>}
      </section>
    </div>
  );
}
