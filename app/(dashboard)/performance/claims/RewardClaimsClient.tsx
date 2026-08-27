"use client";

import { useMemo, useState } from "react";

type Claim = {
  id: string;
  staffId: string;
  department: string;
  rewardKey: string;
  redemptionType: string;
  creditCost: number;
  requestedFor: string | null;
  requestNotes: string;
  coverageStatus: string;
  status: "pending" | "approved" | "denied" | "cancelled" | "claimed" | "expired";
  decisionReason: string;
  requestedAt: string | null;
  stateVersion: number;
  policySnapshot: Record<string, unknown>;
};

type Reward = {
  key: string;
  icon: string;
  title: string;
  description: string;
  kind: string;
  creditCost: number;
  coverageRequired: boolean;
  cooldownDays: number | null;
  maxPerMonth: number | null;
  maxPerQuarter: number | null;
};

type Props = {
  claims: Claim[];
  rewards: Reward[];
  staffNames: Record<string, string>;
  currentStaffId: string;
  isOwner: boolean;
  canRequest: boolean;
  departments: string[];
  today: string;
  availableRc: number | null;
  reservedRc: number | null;
  ledgerValid: boolean;
  serviceAvailable: boolean;
};

function friendlyError(value: unknown): string {
  const message = String(value || "Request failed");
  if (message.startsWith("INSUFFICIENT_REWARD_CREDIT:")) {
    const [, required, available] = message.split(":");
    return `Insufficient RC — দরকার ${required}, available ${available}.`;
  }
  if (message.startsWith("REWARD_COOLDOWN:")) {
    const [, eligible] = message.split(":");
    return `Cooldown চলছে — ${eligible ? new Date(eligible).toLocaleString() : "later"} থেকে eligible.`;
  }
  if (message === "REWARD_MONTH_LIMIT") return "এই reward-এর monthly limit পূর্ণ হয়েছে।";
  if (message === "REWARD_QUARTER_LIMIT") return "এই reward-এর quarterly limit পূর্ণ হয়েছে।";
  if (message === "CLAIM_CONFLICT") return "একই reward/week-এর আরেকটি active claim আছে।";
  if (message === "COVERAGE_REQUIRED") return "Coverage confirm না করে approve করা যাবে না।";
  if (message === "COVERAGE_UNAVAILABLE") return "Coverage unavailable — approve করা যাবে না।";
  if (message === "STALE_CLAIM_VERSION") return "Claim অন্য জায়গা থেকে update হয়েছে। Page reload করে আবার চেষ্টা করুন।";
  return message.replaceAll("_", " ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusClass(status: Claim["status"]): string {
  if (status === "pending") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "approved") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (status === "claimed") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

export function RewardClaimsClient(props: Props) {
  const [rewardKey, setRewardKey] = useState(props.rewards[0]?.key || "");
  const [department, setDepartment] = useState(props.departments[0] || "");
  const [requestedFor, setRequestedFor] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [coverage, setCoverage] = useState<Record<string, boolean>>({});

  const selectedReward = useMemo(
    () => props.rewards.find((reward) => reward.key === rewardKey) || null,
    [props.rewards, rewardKey]
  );

  async function submitClaim() {
    if (!selectedReward || !department) return;
    if ((selectedReward.kind === "family_time" || selectedReward.kind === "leave") && !requestedFor) {
      setMessage("এই reward-এর জন্য requested date লাগবে।");
      return;
    }
    const op = `new:${selectedReward.key}`;
    setBusy(op);
    setMessage("");
    try {
      const response = await fetch("/api/v1/gamification/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `ui-claim-${crypto.randomUUID()}`,
          department,
          rewardKey: selectedReward.key,
          requestedFor: requestedFor || null,
          requestNotes: notes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(String(data?.error || `HTTP ${response.status}`));
      window.location.reload();
    } catch (error) {
      setMessage(friendlyError(error instanceof Error ? error.message : error));
      setBusy("");
    }
  }

  async function act(claim: Claim, transition: "approve" | "deny" | "cancel" | "claim") {
    const key = `${claim.id}:${transition}`;
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/gamification/claims/${encodeURIComponent(claim.id)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transition,
          expectedVersion: claim.stateVersion,
          idempotencyKey: `ui-${claim.id}-${transition}-v${claim.stateVersion}`,
          reason: reasons[claim.id] || "",
          coverageStatus:
            transition === "approve" && claim.policySnapshot?.coverageRequired === true
              ? coverage[claim.id] ? "available" : ""
              : "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(String(data?.error || `HTTP ${response.status}`));
      window.location.reload();
    } catch (error) {
      setMessage(friendlyError(error instanceof Error ? error.message : error));
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-violet-50 p-3">
            <p className="text-lg font-black tabular-nums text-violet-900">{props.ledgerValid ? props.availableRc ?? 0 : "—"}</p>
            <p className="text-[9px] text-violet-600">Available RC</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-lg font-black tabular-nums text-slate-900">{props.ledgerValid ? props.reservedRc ?? 0 : "—"}</p>
            <p className="text-[9px] text-slate-500">Reserved RC</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-lg font-black tabular-nums text-slate-900">{props.claims.filter((claim) => claim.status === "pending").length}</p>
            <p className="text-[9px] text-slate-500">Pending</p>
          </div>
        </div>
        {!props.serviceAvailable && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Claim service unavailable — কোনো fallback write করা হচ্ছে না।</p>
        )}
      </section>

      {props.canRequest && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-950">Request a Reward</h2>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">Request submit হলেই RC reserve হবে; reject/cancel হলে release হবে।</p>
            </div>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">Hard validation</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Reward
              <select value={rewardKey} onChange={(event) => setRewardKey(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                {props.rewards.map((reward) => (
                  <option key={reward.key} value={reward.key}>{reward.title} · {reward.creditCost} RC</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Department
              <select value={department} onChange={(event) => setDepartment(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                {props.departments.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>

          {selectedReward && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-600">
              <p className="font-bold text-slate-900">{selectedReward.icon} {selectedReward.title}</p>
              <p className="mt-1">{selectedReward.description}</p>
              <p className="mt-1 font-semibold text-violet-700">
                {selectedReward.creditCost} RC
                {selectedReward.cooldownDays !== null ? ` · ${selectedReward.cooldownDays}d cooldown` : ""}
                {selectedReward.maxPerMonth !== null ? ` · max ${selectedReward.maxPerMonth}/month` : ""}
                {selectedReward.maxPerQuarter !== null ? ` · max ${selectedReward.maxPerQuarter}/quarter` : ""}
                {selectedReward.coverageRequired ? " · coverage required" : ""}
              </p>
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Requested date
              <input type="date" min={props.today} value={requestedFor} onChange={(event) => setRequestedFor(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Note
              <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Optional note" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
            </label>
          </div>

          <button type="button" onClick={submitClaim} disabled={!props.serviceAvailable || !selectedReward || busy !== ""} className="mt-4 w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy.startsWith("new:") ? "Submitting…" : selectedReward ? `Reserve ${selectedReward.creditCost} RC & Request` : "Request"}
          </button>
        </section>
      )}

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">{message}</div>}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className="border-b border-slate-100 px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-950">{props.isOwner ? "Claims Review" : "My Claims"}</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Every transition creates an immutable lifecycle event and audit entry.</p>
        </div>
        {props.claims.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">কোনো claim নেই।</div>
        ) : (
          props.claims.map((claim) => {
            const coverageRequired = claim.policySnapshot?.coverageRequired === true;
            const ownerCanApprove = props.isOwner && claim.status === "pending";
            const ownerCanClaim = props.isOwner && claim.status === "approved";
            const ownOpen = claim.staffId === props.currentStaffId && (claim.status === "pending" || claim.status === "approved");
            return (
              <div key={claim.id} className="border-b border-slate-100 p-4 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-950">{props.staffNames[claim.staffId] || claim.staffId}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{claim.rewardKey.replaceAll("_", " ")} · {claim.creditCost} RC · {claim.department}</p>
                    <p className="mt-1 text-[10px] text-slate-400">Requested {formatDate(claim.requestedAt)}{claim.requestedFor ? ` · for ${claim.requestedFor}` : ""}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusClass(claim.status)}`}>{claim.status}</span>
                </div>

                {claim.requestNotes && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{claim.requestNotes}</p>}
                {claim.decisionReason && <p className="mt-2 text-[10px] text-slate-500">Decision: {claim.decisionReason}</p>}

                {(ownerCanApprove || ownerCanClaim || ownOpen) && (
                  <div className="mt-3 space-y-2">
                    {ownerCanApprove && coverageRequired && (
                      <label className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">
                        <input type="checkbox" checked={Boolean(coverage[claim.id])} onChange={(event) => setCoverage((prev) => ({ ...prev, [claim.id]: event.target.checked }))} />
                        Coverage confirmed available
                      </label>
                    )}
                    {props.isOwner && (claim.status === "pending" || claim.status === "approved") && (
                      <input value={reasons[claim.id] || ""} onChange={(event) => setReasons((prev) => ({ ...prev, [claim.id]: event.target.value }))} maxLength={1000} placeholder="Decision / fulfillment note" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {ownerCanApprove && (
                        <button type="button" onClick={() => act(claim, "approve")} disabled={busy !== "" || (coverageRequired && !coverage[claim.id])} className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Approve</button>
                      )}
                      {ownerCanApprove && (
                        <button type="button" onClick={() => act(claim, "deny")} disabled={busy !== ""} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-200 disabled:opacity-40">Deny & Release</button>
                      )}
                      {ownerCanClaim && (
                        <button type="button" onClick={() => act(claim, "claim")} disabled={busy !== ""} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Confirm Claim & Redeem</button>
                      )}
                      {ownOpen && (
                        <button type="button" onClick={() => act(claim, "cancel")} disabled={busy !== ""} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">Cancel & Release</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
