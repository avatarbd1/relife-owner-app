"use client";

import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { useToastContext } from "@/components/ToastProvider";

interface ApprovalItem {
  id: string;
  date: string;
  category?: string;
  description?: string;
  amount: number;
  requestedBy?: string;
  details: string;
}

interface BulkApprovalWidgetProps {
  title: string;
  items: ApprovalItem[];
  onApprove: (ids: string[]) => Promise<{ success: number; failed: number }>;
  onReject?: (ids: string[], reason: string) => Promise<{ success: number; failed: number }>;
  emptyMessage?: string;
  color?: "amber" | "red" | "blue" | "purple";
}

export default function BulkApprovalWidget({
  title,
  items,
  onApprove,
  onReject,
  emptyMessage = "No pending items",
  color = "amber",
}: BulkApprovalWidgetProps) {
  const toast = useToastContext();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const colorMap = {
    amber: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-900",
      button: "bg-amber-100 hover:bg-amber-200 text-amber-800",
    },
    red: {
      bg: "bg-red-50",
      border: "border-red-200",
      text: "text-red-900",
      button: "bg-red-100 hover:bg-red-200 text-red-800",
    },
    blue: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      text: "text-blue-900",
      button: "bg-blue-100 hover:bg-blue-200 text-blue-800",
    },
    purple: {
      bg: "bg-purple-50",
      border: "border-purple-200",
      text: "text-purple-900",
      button: "bg-purple-100 hover:bg-purple-200 text-purple-800",
    },
  };

  const colors = colorMap[color];
  const allSelected = selected.size === items.length && items.length > 0;
  const totalAmount = Array.from(selected).reduce((sum, id) => {
    const item = items.find((i) => i.id === id);
    return sum + (item?.amount || 0);
  }, 0);

  function toggleItem(id: string) {
    haptic("tap");
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  }

  function toggleAll() {
    haptic("tap");
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  async function handleApprove() {
    if (selected.size === 0) {
      toast.warning("Select items to approve");
      return;
    }

    setLoading(true);
    try {
      const result = await onApprove(Array.from(selected));
      if (result.success > 0) {
        toast.success(`${result.success} approved${result.failed > 0 ? `, ${result.failed} failed` : ""}`);
        setSelected(new Set());
        haptic("success");
      } else {
        toast.error(`All approvals failed`);
        haptic("error");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
      haptic("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (selected.size === 0) {
      toast.warning("Select items to reject");
      return;
    }

    if (!rejectReason.trim()) {
      toast.warning("Provide rejection reason");
      return;
    }

    setLoading(true);
    try {
      const result = await onReject?.(Array.from(selected), rejectReason) || { success: 0, failed: 0 };
      if (result.success > 0) {
        toast.success(`${result.success} rejected${result.failed > 0 ? `, ${result.failed} failed` : ""}`);
        setSelected(new Set());
        setRejectReason("");
        setShowRejectReason(false);
        haptic("success");
      } else {
        toast.error("All rejections failed");
        haptic("error");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rejection failed");
      haptic("error");
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4 text-center text-sm ${colors.text}`}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`space-y-3 rounded-lg border ${colors.border} ${colors.bg} p-4`}>
      {/* Header with select all */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-5 w-5 cursor-pointer rounded"
          />
          <span className={`text-sm font-semibold ${colors.text}`}>
            {title} ({selected.size}/{items.length})
          </span>
        </div>
        {selected.size > 0 && (
          <span className={`text-xs font-bold ${colors.text}`}>
            ৳{new Intl.NumberFormat("en-BD").format(totalAmount)}
          </span>
        )}
      </div>

      {/* Items List */}
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded bg-white p-3"
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900">{item.details}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {item.date}
                {item.requestedBy && ` · ${item.requestedBy}`}
              </p>
            </div>
            <span className="flex-shrink-0 text-xs font-bold text-slate-900 tabular-nums">
              ৳{new Intl.NumberFormat("en-BD").format(item.amount)}
            </span>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      {selected.size > 0 && (
        <div className="space-y-2 border-t border-opacity-30 pt-3">
          {showRejectReason ? (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why are you rejecting? (required)"
                rows={2}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-red-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={loading || !rejectReason.trim()}
                  className="flex-1 flex items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {loading && <Spinner size="sm" className="border-white/30 border-t-white" />}
                  Confirm Reject
                </button>
                <button
                  onClick={() => {
                    setShowRejectReason(false);
                    setRejectReason("");
                  }}
                  className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleApprove}
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading && <Spinner size="sm" className="border-white/30 border-t-white" />}
                ✓ Approve ({selected.size})
              </button>
              {onReject && (
                <button
                  onClick={() => setShowRejectReason(true)}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 rounded bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  ✕ Reject
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
