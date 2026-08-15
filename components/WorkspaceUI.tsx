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
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
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
    <div className={`grid gap-2 ${items.length >= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
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
          <p className="mt-0.5 text-[11px] text-slate-500">{item.label}</p>
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
    <section className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
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
      className="flex min-h-[62px] items-center gap-3 border-t border-slate-100 px-4 py-2.5 transition active:bg-slate-50 first:border-t-0"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
        <AppIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{subtitle}</span>}
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
      className="flex min-h-[74px] flex-col justify-between rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200 transition active:scale-[0.98] active:bg-slate-50"
    >
      <AppIcon name={icon} className="h-5 w-5 text-slate-500" />
      <span className="mt-3 text-xs font-semibold text-slate-900">{label}</span>
    </Link>
  );
}
