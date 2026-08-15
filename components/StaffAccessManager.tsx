"use client";

import { useState } from "react";

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
  const [message, setMessage] = useState("");

  async function createLink(staffId: string) {
    setBusyId(staffId);
    setMessage("");
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
      setLink({
        staffId,
        url: payload.setupUrl,
        expiresInSeconds: Number(payload.expiresInSeconds || 0),
      });
      setMessage("Setup link তৈরি হয়েছে। Staff-এর নিজের phone-এ পাঠান।");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup link তৈরি ব্যর্থ হয়েছে।");
    } finally {
      setBusyId("");
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setMessage("Link copied.");
    } catch {
      setMessage("Copy করা যায়নি। Share button ব্যবহার করুন।");
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
        return;
      } catch {
        return;
      }
    }
    await copyLink();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">Owner Security</p>
        <h1 className="mt-1 text-xl font-semibold">Staff device access</h1>
        <p className="mt-2 text-sm leading-5 text-slate-300">
          Public signup বন্ধ। Owner link দিলে staff নিজের device-এ passkey setup করতে পারবে।
        </p>
      </section>

      {message && (
        <p className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200" role="status">{message}</p>
      )}

      {link && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">One-time setup link</p>
          <p className="mt-1 break-all text-xs leading-5 text-emerald-800">{link.url}</p>
          <p className="mt-2 text-xs text-emerald-700">
            প্রায় {Math.max(1, Math.round(link.expiresInSeconds / 60))} মিনিট valid; passkey যোগ হলে পুরোনো link আর কাজ করবে না।
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={copyLink} className="min-h-11 rounded-xl bg-white px-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 active:bg-emerald-100">Copy</button>
            <button type="button" onClick={shareLink} className="min-h-11 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white active:bg-emerald-700">Share</button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        {staff.map((item) => (
          <article key={item.staffId} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.fullName}</p>
                <p className="mt-1 text-xs text-slate-500">{item.staffId} · {item.roles.join(" · ")}</p>
                <p className="mt-1 text-xs text-slate-400">{item.departments.join(" · ")}</p>
              </div>
              <button
                type="button"
                onClick={() => createLink(item.staffId)}
                disabled={Boolean(busyId)}
                className="min-h-10 shrink-0 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white active:bg-slate-800 disabled:opacity-50"
              >
                {busyId === item.staffId ? "..." : "Setup link"}
              </button>
            </div>
          </article>
        ))}
        {staff.length === 0 && (
          <p className="rounded-2xl bg-white p-5 text-center text-sm text-slate-500 ring-1 ring-slate-200">No active staff ready for web access.</p>
        )}
      </section>
    </div>
  );
}
