"use client";

import Link from "next/link";
import { haptic } from "@/lib/interactions";

interface QuickAction {
  href: string;
  icon: string;
  label: string;
  sublabel: string;
  badge?: number | string;
  color: "blue" | "emerald" | "amber" | "purple";
}

export default function QuickActionsWidget({
  actions,
}: {
  actions: QuickAction[];
}) {
  const colorMap = {
    blue: {
      border: "border-blue-200",
      bg: "bg-blue-50",
      text: "text-blue-700",
      icon: "text-blue-600",
      hover: "hover:bg-blue-100",
    },
    emerald: {
      border: "border-emerald-200",
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      icon: "text-emerald-600",
      hover: "hover:bg-emerald-100",
    },
    amber: {
      border: "border-amber-200",
      bg: "bg-amber-50",
      text: "text-amber-700",
      icon: "text-amber-600",
      hover: "hover:bg-amber-100",
    },
    purple: {
      border: "border-purple-200",
      bg: "bg-purple-50",
      text: "text-purple-700",
      icon: "text-purple-600",
      hover: "hover:bg-purple-100",
    },
  };

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {actions.map((action) => {
        const colors = colorMap[action.color];
        return (
          <Link
            key={action.href}
            href={action.href}
            onClick={() => haptic("tap")}
            className={`group relative flex flex-col items-center justify-center gap-2 rounded-xl border ${colors.border} ${colors.bg} p-4 text-center transition-colors ${colors.hover}`}
          >
            {/* Icon */}
            <div className={`text-3xl ${colors.icon}`}>{action.icon}</div>

            {/* Label */}
            <div>
              <p className={`text-xs font-bold ${colors.text}`}>{action.label}</p>
              <p className="text-[10px] text-slate-600">{action.sublabel}</p>
            </div>

            {/* Badge */}
            {action.badge !== undefined && action.badge > 0 && (
              <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {action.badge > 9 ? "9+" : action.badge}
              </div>
            )}

            {/* Keyboard Shortcut Hint */}
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
              {action.href.includes("/payments") && "Press P"}
              {action.href.includes("/appointments") && "Press A"}
              {action.href.includes("/treatment") && "Press T"}
              {action.href.includes("/expenses") && "Press E"}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
