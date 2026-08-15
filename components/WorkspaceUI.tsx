import Link from "next/link";
import AppIcon, { type AppIconName } from "@/components/AppIcon";

export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight tracking-tight text-slate-950">{title}</h1>
        {subtitle && <p className="mt-1 text-sm leading-5 text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function MetricGrid({
  items,
}: {
  items: { label: string; value: string; tone?: "default" | "positive" | "warning" }[];
}) {
  return (
    <div className={`grid gap-2.5 ${items.length >= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm">
          <p
            className={`text-lg font-semibold tabular-nums ${
              item.tone === "positive"
                ? "text-emerald-700"
                : item.tone === "warning"
                  ? "text-amber-700"
                  : "text-slate-950"
            }`}
          >
            {item.value}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-base font-semibold leading-snug text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function ActionRow({
  href,
  icon,
  title,
  subtitle,
  meta,
}: {
  href: string;
  icon: AppIconName;
  title: string;
  subtitle?: string;
  meta?: string | number;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 border-t border-slate-100 px-4 py-3 transition first:border-t-0 hover:bg-slate-50 active:bg-slate-100"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
        <AppIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-slate-500">{subtitle}</span>}
      </span>
      {meta !== undefined && (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          {meta}
        </span>
      )}
      <span aria-hidden="true" className="text-lg text-slate-300">›</span>
    </Link>
  );
}

export function QuickButton({
  href,
  icon,
  label,
}: {
  href: string;
  icon: AppIconName;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[76px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] active:bg-slate-100"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-800">
        <AppIcon name={icon} className="h-4.5 w-4.5" />
      </span>
      <span className="mt-3 text-xs font-semibold leading-4 text-slate-900">{label}</span>
    </Link>
  );
}
