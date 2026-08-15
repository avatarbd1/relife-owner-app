type SpinnerSize = "sm" | "md" | "lg";
type StatusTone = "success" | "warning" | "error" | "info" | "neutral";

const SPINNER_SIZE: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const STATUS_STYLE: Record<StatusTone, { className: string; icon: string }> = {
  success: {
    className: "border-emerald-500 bg-emerald-100 text-emerald-700",
    icon: "✓",
  },
  warning: {
    className: "border-amber-500 bg-amber-100 text-amber-700",
    icon: "⌛",
  },
  error: {
    className: "border-red-500 bg-red-100 text-red-700",
    icon: "✕",
  },
  info: {
    className: "border-blue-500 bg-blue-100 text-blue-800",
    icon: "i",
  },
  neutral: {
    className: "border-slate-200 bg-slate-100 text-slate-500",
    icon: "•",
  },
};

export function Spinner({
  size = "md",
  className = "",
  label = "Loading",
}: {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`relife-spinner inline-block shrink-0 rounded-full ${SPINNER_SIZE[size]} ${className}`}
    />
  );
}

export function Skeleton({
  className = "h-4 w-full",
}: {
  className?: string;
}) {
  return <div aria-hidden="true" className={`relife-skeleton ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}

export function StatusBadge({
  children,
  tone,
  icon = true,
  uppercase = true,
  className = "",
}: {
  children: React.ReactNode;
  tone: StatusTone;
  icon?: boolean;
  uppercase?: boolean;
  className?: string;
}) {
  const style = STATUS_STYLE[tone];
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${
        uppercase ? "uppercase tracking-[0.04em]" : ""
      } ${style.className} ${className}`}
    >
      {icon && <span aria-hidden="true">{style.icon}</span>}
      <span>{children}</span>
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  tone = "auto",
  className = "",
}: {
  value: number;
  label?: string;
  tone?: "auto" | "primary" | "success" | "warning" | "error";
  className?: string;
}) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const resolvedTone =
    tone === "auto"
      ? safe >= 100
        ? "success"
        : safe >= 67
          ? "primary"
          : safe >= 34
            ? "warning"
            : "error"
      : tone;
  const fill = {
    primary: "bg-blue-700",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-600",
  }[resolvedTone];

  return (
    <div className={className}>
      {(label || Number.isFinite(value)) && (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-medium text-slate-500">
          <span>{label || "Progress"}</span>
          <span className="tabular-nums">{Math.round(safe)}%</span>
        </div>
      )}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(safe)}
      >
        <div
          className={`h-full origin-left rounded-full ${fill} transition-transform duration-200 ease-out`}
          style={{ transform: `scaleX(${safe / 100})` }}
        />
      </div>
    </div>
  );
}

export function InlineNotice({
  tone,
  title,
  children,
  className = "",
}: {
  tone: StatusTone;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const style = STATUS_STYLE[tone];
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 text-xs leading-5 ${style.className} ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}
