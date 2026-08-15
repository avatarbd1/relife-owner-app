"use client";

import { haptic } from "@/lib/interactions";

export type TapChoiceOption<T extends string> = {
  value: T;
  label: string;
  subtitle?: string;
  disabled?: boolean;
  tone?: "blue" | "emerald" | "amber" | "red" | "slate";
};

const ACTIVE = {
  blue: "border-blue-800 bg-blue-800 text-white shadow-sm",
  emerald: "border-emerald-700 bg-emerald-700 text-white shadow-sm",
  amber: "border-amber-600 bg-amber-500 text-white shadow-sm",
  red: "border-red-600 bg-red-600 text-white shadow-sm",
  slate: "border-slate-800 bg-slate-800 text-white shadow-sm",
} as const;

export default function TapChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 2,
  allowClear = false,
  disabled = false,
  compact = false,
  tone = "blue",
}: {
  label?: string;
  value: T | "";
  options: Array<TapChoiceOption<T>>;
  onChange: (value: T | "") => void;
  columns?: 2 | 3 | 4;
  allowClear?: boolean;
  disabled?: boolean;
  compact?: boolean;
  tone?: TapChoiceOption<T>["tone"];
}) {
  const grid = columns === 4 ? "grid-cols-2 sm:grid-cols-4" : columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <fieldset disabled={disabled}>
      {label && <legend className="mb-2 text-xs font-semibold text-slate-700">{label}</legend>}
      <div className={`grid ${grid} gap-2`} role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = value === option.value;
          const optionTone = option.tone || tone || "blue";
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || option.disabled}
              onClick={() => {
                const next = allowClear && active ? "" : option.value;
                onChange(next as T | "");
                haptic("tap");
              }}
              className={`relife-interactive min-w-0 rounded-lg border px-2.5 text-left font-semibold transition-colors duration-100 ${
                compact ? "min-h-10 py-2 text-[11px]" : "min-h-11 py-2.5 text-xs"
              } ${
                active
                  ? ACTIVE[optionTone]
                  : option.disabled
                    ? "border-slate-100 bg-slate-100 text-slate-400 opacity-60"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="block truncate">{option.label}</span>
              {option.subtitle && (
                <span className={`mt-0.5 block truncate text-[9px] font-normal ${active ? "text-white/75" : "text-slate-400"}`}>
                  {option.subtitle}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
