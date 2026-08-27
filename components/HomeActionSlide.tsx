import Link from "next/link";
import AppIcon, { type AppIconName } from "@/components/AppIcon";

export default function HomeActionSlide({
  href,
  icon,
  label,
  subtitle = "Tap to open",
}: {
  href: string;
  icon: AppIconName;
  label: string;
  subtitle?: string;
}) {
  const resolvedHref = label === "Live chat" ? "/chamber/chat" : href;

  return (
    <div
      data-home-action-slide={label}
      className="flex min-h-[calc(100dvh-15rem)] items-start justify-center px-1 pb-24 pt-[8vh]"
    >
      <Link
        href={resolvedHref}
        className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/80 active:scale-[0.99]"
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <AppIcon name={icon} className="h-8 w-8" />
        </div>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
          Quick action
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{label}</h2>
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        <div className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white">
          Open {label}
          <span className="ml-2" aria-hidden="true">→</span>
        </div>
      </Link>
    </div>
  );
}
