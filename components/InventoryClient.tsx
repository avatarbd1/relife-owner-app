"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { adjustPhysioInventory } from "@/app/(dashboard)/inventory/actions";
import { haptic } from "@/lib/interactions";

type InventoryItem = {
  itemId: string;
  itemName: string;
  category: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
  supplier: string;
  lastUpdated: string;
  lowStock: boolean;
};

type InventoryLogRow = {
  timestamp: string;
  itemId: string;
  itemName: string;
  change: number;
  reason: string;
  staff: string;
  newBalance: number;
};

type Tab = "stock" | "log" | "adjust";
type Operation = "add" | "use" | "discard" | "adjust";

const OPERATION_LABEL: Record<Operation, string> = {
  add: "Stock add",
  use: "Stock consume",
  discard: "Expiry discard",
  adjust: "Manual adjustment",
};

export default function InventoryClient({
  items,
  recentLog,
  canWrite,
}: {
  items: InventoryItem[];
  recentLog: InventoryLogRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("stock");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [operation, setOperation] = useState<Operation>("add");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter(Boolean))].sort(),
    [items]
  );
  const lowStockItems = useMemo(() => items.filter((item) => item.lowStock), [items]);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const categoryMatch = category === "all" || item.category === category;
      const textMatch = !needle || `${item.itemName} ${item.itemId} ${item.supplier}`.toLowerCase().includes(needle);
      return categoryMatch && textMatch;
    });
  }, [items, category, query]);

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    const raw = Number(quantity);
    if (!itemName.trim() || !Number.isFinite(raw) || raw === 0) {
      setError("Item এবং non-zero quantity দিন।");
      return;
    }
    if (operation !== "adjust" && raw < 0) {
      setError("Add/Use/Discard-এর quantity positive দিন।");
      return;
    }
    if (operation === "adjust" && !note.trim()) {
      setError("Manual adjustment-এর reason লিখুন।");
      return;
    }

    const change =
      operation === "add"
        ? Math.abs(raw)
        : operation === "use" || operation === "discard"
          ? -Math.abs(raw)
          : raw;
    const reason = `${OPERATION_LABEL[operation]}${note.trim() ? `: ${note.trim()}` : ""}`;

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await adjustPhysioInventory({
        itemName: itemName.trim(),
        change,
        reason,
      });
      setSuccess(`${result.itemName}: ${result.previous} → ${result.newBalance}`);
      setQuantity("");
      setNote("");
      haptic("success");
      router.refresh();
    } catch (adjustError) {
      const message = adjustError instanceof Error ? adjustError.message : "INVENTORY_UPDATE_FAILED";
      setError(
        message === "INVENTORY_INSUFFICIENT_STOCK"
          ? "Current stock-এর চেয়ে বেশি consume/discard করা যাবে না।"
          : message === "ACCESS_DENIED"
            ? "Inventory update permission নেই।"
            : message
      );
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "stock", label: "Stock" },
    { id: "log", label: "Movement log" },
    ...(canWrite ? [{ id: "adjust" as const, label: "Adjust" }] : []),
  ];

  return (
    <div className="space-y-4">
      {lowStockItems.length > 0 && (
        <InlineNotice tone="warning" title="Low stock alert">
          {lowStockItems.length} item minimum stock-এ বা নিচে আছে। Stock tab-এ red cards দেখুন।
        </InlineNotice>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Inventory tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => { setTab(item.id); haptic("tap"); }}
              className={`min-h-11 rounded-lg px-4 text-xs font-semibold ${tab === item.id ? "bg-blue-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "stock" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item, ID or supplier" className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-100" />
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-2 text-xs">
              <option value="all">All</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => (
              <article key={item.itemId} className={`rounded-xl border p-3 ${item.lowStock ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.itemName}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.itemId} · {item.category || "Uncategorized"}</p></div>
                  {item.lowStock && <StatusBadge tone="error">Low</StatusBadge>}
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums text-slate-950">{item.currentStock}<span className="ml-1 text-xs font-medium text-slate-500">{item.unit}</span></p>
                <p className="mt-1 text-[11px] text-slate-500">Minimum {item.minimumStock} {item.unit}</p>
                {(item.supplier || item.lastUpdated) && <p className="mt-3 border-t border-slate-200 pt-2 text-[10px] leading-4 text-slate-400">{item.supplier ? `Supplier: ${item.supplier}` : ""}{item.supplier && item.lastUpdated ? " · " : ""}{item.lastUpdated ? `Updated ${item.lastUpdated}` : ""}</p>}
              </article>
            ))}
          </div>
          {filteredItems.length === 0 && <InlineNotice tone="neutral">Matching inventory item নেই।</InlineNotice>}
        </section>
      )}

      {tab === "log" && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {recentLog.map((row, index) => (
            <article key={`${row.timestamp}-${row.itemId}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.itemName}</p><p className="mt-0.5 text-[10px] text-slate-400">{row.timestamp} · {row.staff}</p><p className="mt-1 text-xs text-slate-600">{row.reason}</p></div>
              <div className="shrink-0 text-right"><p className={`text-sm font-bold tabular-nums ${row.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.change > 0 ? "+" : ""}{row.change}</p><p className="text-[10px] text-slate-400">Balance {row.newBalance}</p></div>
            </article>
          ))}
          {recentLog.length === 0 && <InlineNotice tone="neutral">Inventory movement log নেই।</InlineNotice>}
        </section>
      )}

      {tab === "adjust" && canWrite && (
        <form onSubmit={submitAdjustment} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold text-slate-700">Action</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["add", "use", "discard", "adjust"] as const).map((value) => (
                <button key={value} type="button" onClick={() => { setOperation(value); setError(""); haptic("tap"); }} className={`min-h-11 rounded-lg border px-2 text-xs font-semibold ${operation === value ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{OPERATION_LABEL[value]}</button>
              ))}
            </div>
          </div>

          <label className="block text-xs font-semibold text-slate-700">Item *
            <input list="inventory-item-names" value={itemName} onChange={(event) => setItemName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="Type or choose item" />
            <datalist id="inventory-item-names">{items.map((item) => <option key={item.itemId} value={item.itemName} />)}</datalist>
          </label>

          <label className="block text-xs font-semibold text-slate-700">{operation === "adjust" ? "Signed change *" : "Quantity *"}
            <input type="number" step="1" min={operation === "adjust" ? undefined : 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder={operation === "adjust" ? "e.g. -2 or 5" : "e.g. 5"} />
          </label>

          <label className="block text-xs font-semibold text-slate-700">Reason / note {operation === "adjust" ? "*" : ""}
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Optional context; required for manual adjustment" />
          </label>

          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          {success && <InlineNotice tone="success">{success}</InlineNotice>}

          <button disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Updating inventory" />}
            {busy ? "Updating…" : "Update stock"}
          </button>
          <p className="text-center text-[10px] text-slate-400">Every adjustment is serialized by distributed lock and written with inventory log + audit evidence in one Sheets batch.</p>
        </form>
      )}
    </div>
  );
}
