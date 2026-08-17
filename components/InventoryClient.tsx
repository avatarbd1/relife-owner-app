"use client";

import { useState, useMemo } from "react";
import { Spinner, InlineNotice } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import type { InventoryItem, InventoryLogRow } from "@/lib/webos/inventory";
import { adjustPhysioInventory } from "@/app/(dashboard)/inventory/actions";

export default function InventoryClient({
  items,
  recentLog,
  canWrite,
}: {
  items: InventoryItem[];
  recentLog: InventoryLogRow[];
  canWrite: boolean;
}) {
  const [selectedTab, setSelectedTab] = useState<"stock" | "log" | "adjust">("stock");
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [adjustmentForm, setAdjustmentForm] = useState({
    itemName: "",
    change: "",
    reason: "Stock add",
    quantity: "",
  });

  const lowStockItems = useMemo(
    () => items.filter((item) => item.lowStock),
    [items]
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory =
        filterCategory === "all" || item.category === filterCategory;
      const matchesSearch =
        searchQuery === "" ||
        item.itemName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, filterCategory, searchQuery]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category))),
    [items]
  );

  async function handleAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustmentForm.itemName.trim() || !adjustmentForm.quantity.trim()) {
      setError("Item এবং quantity উভয় ভরুন।");
      return;
    }

    const quantity = parseInt(adjustmentForm.quantity, 10);
    if (!Number.isFinite(quantity) || quantity === 0) {
      setError("Quantity একটি valid সংখ্যা হতে হবে।");
      return;
    }

    setAdjusting(true);
    setError("");
    setSuccess("");

    try {
      const multiplier = adjustmentForm.reason === "Stock add" ? 1 : -1;
      const result = await adjustPhysioInventory({
        itemName: adjustmentForm.itemName.trim(),
        change: quantity * multiplier,
        reason: adjustmentForm.reason,
      });

      haptic("success");
      setSuccess(
        `${result.itemName} updated: ${result.previous} → ${result.newBalance}`
      );
      setAdjustmentForm({
        itemName: "",
        change: "",
        reason: "Stock add",
        quantity: "",
      });

      setTimeout(() => {
        setSuccess("");
        window.location.reload();
      }, 2000);
    } catch (err) {
      haptic("error");
      setError(
        err instanceof Error ? err.message : "Inventory update ব্যর্থ"
      );
    } finally {
      setAdjusting(false);
    }
  }

  return (
    <div className="space-y-4">
      {lowStockItems.length > 0 && (
        <InlineNotice tone="warning">
          ⚠️ {lowStockItems.length} item{lowStockItems.length > 1 ? "s" : ""}{" "}
          low stock এ আছে। এই কয়েকটি item reorder করতে হবে।
        </InlineNotice>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        {["stock", "log", ...(canWrite ? ["adjust"] : [])].map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab as typeof selectedTab)}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              selectedTab === tab
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab === "stock"
              ? "📦 Stock"
              : tab === "log"
                ? "📋 Log"
                : "✏️ Adjust"}
          </button>
        ))}
      </div>

      {selectedTab === "stock" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-11 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">সব category</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => (
              <div
                key={item.itemId}
                className={`rounded-lg border p-4 transition-colors ${
                  item.lowStock
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.itemName}
                    </p>
                    <p className="text-[11px] text-slate-500">{item.category}</p>
                  </div>
                  {item.lowStock && (
                    <span className="shrink-0 rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      LOW
                    </span>
                  )}
                </div>

                <div className="mt-3">
                  <p className="text-2xl font-bold text-slate-900">
                    {item.currentStock}
                    <span className="ml-1 text-xs font-medium text-slate-500">
                      {item.unit}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Min: {item.minimumStock} {item.unit}
                  </p>
                </div>

                <div className="mt-3 border-t border-slate-200 pt-2">
                  <p className="text-[10px] text-slate-500">
                    Last updated: {item.lastUpdated || "—"}
                  </p>
                  {item.supplier && (
                    <p className="text-[10px] text-slate-500">
                      Supplier: {item.supplier}
                    </p>
                  )}
                </div>

                {item.lowStock && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold text-red-700">
                      ⚠️ Reorder করতে হবে এখনই!
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {filteredItems.length === 0 && (
            <div className="rounded-lg bg-slate-50 py-8 text-center text-sm text-slate-500">
              কোনো inventory item পাওয়া যায়নি।
            </div>
          )}
        </div>
      )}

      {selectedTab === "log" && (
        <div className="space-y-2">
          {recentLog.length === 0 ? (
            <div className="rounded-lg bg-slate-50 py-8 text-center text-sm text-slate-500">
              কোনো transaction log নেই।
            </div>
          ) : (
            recentLog.map((row, index) => (
              <div
                key={`${row.timestamp}-${row.itemId}-${index}`}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.itemName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {row.timestamp} · {row.staff}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {row.reason}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-sm font-bold ${
                        row.change > 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {row.change > 0 ? "+" : ""}
                      {row.change}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Balance: {row.newBalance}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {selectedTab === "adjust" && canWrite && (
        <form onSubmit={handleAdjustment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Reason *
            </label>
            <select
              value={adjustmentForm.reason}
              onChange={(e) =>
                setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })
              }
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="Stock add">Stock add</option>
              <option value="Stock consume">Stock consume</option>
              <option value="Expiry discard">Expiry discard</option>
              <option value="Manual adjustment">Manual adjustment</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Item Name *
            </label>
            <input
              list="item-names"
              type="text"
              value={adjustmentForm.itemName}
              onChange={(e) =>
                setAdjustmentForm({ ...adjustmentForm, itemName: e.target.value })
              }
              placeholder="Type or select item..."
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
            <datalist id="item-names">
              {items.map((item) => (
                <option key={item.itemId} value={item.itemName} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Quantity *
            </label>
            <input
              type="number"
              value={adjustmentForm.quantity}
              onChange={(e) =>
                setAdjustmentForm({ ...adjustmentForm, quantity: e.target.value })
              }
              inputMode="numeric"
              min="1"
              max="1000"
              placeholder="কত quantity যোগ/বাদ হবে?"
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={adjusting}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {adjusting && <Spinner size="sm" className="border-white/30 border-t-white" />}
            {adjusting ? "Updating..." : "Update Stock"}
          </button>
        </form>
      )}
    </div>
  );
}
