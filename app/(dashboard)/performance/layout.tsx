import Link from "next/link";

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="mx-auto mb-3 flex w-full max-w-3xl gap-2 px-0" aria-label="Performance navigation">
        <Link href="/performance" className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
          Performance
        </Link>
        <Link href="/performance/claims" className="rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white shadow-sm">
          Reward Claims
        </Link>
        <Link href="/performance/weekly" className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
          Weekly
        </Link>
        <Link href="/performance/monthly" className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
          Monthly RC
        </Link>
      </nav>
      {children}
    </div>
  );
}
