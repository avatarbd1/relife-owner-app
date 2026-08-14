"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WebAction, WebRole } from "@/lib/webos/access";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  matches: string[];
  visible: (roles: WebRole[], actions: Set<WebAction>) => boolean;
};

function hasAny(actions: Set<WebAction>, required: WebAction[]): boolean {
  return required.some((action) => actions.has(action));
}

const ITEMS: NavItem[] = [
  {
    href: "/home",
    label: "Home",
    icon: "🏠",
    matches: ["/home", "/daily"],
    visible: () => true,
  },
  {
    href: "/finance",
    label: "Finance",
    icon: "💰",
    matches: ["/finance", "/operations"],
    visible: (_roles, actions) =>
      hasAny(actions, [
        "payment.read_amount",
        "payment.create",
        "payment.void",
        "report.read_financial",
        "expense.request",
        "expense.approve",
        "expense.pay",
        "cash.request",
        "cash.accept",
        "salary.read",
        "salary.pay",
      ]),
  },
  {
    href: "/patients",
    label: "Patients",
    icon: "🩺",
    matches: ["/patients", "/appointments"],
    visible: (_roles, actions) =>
      hasAny(actions, [
        "patient.read",
        "patient.create",
        "patient.update",
        "appointment.read",
        "appointment.create",
        "appointment.update",
        "clinical.read",
        "clinical.write",
      ]),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: "📊",
    matches: ["/reports"],
    visible: (_roles, actions) =>
      hasAny(actions, [
        "report.read_operational",
        "report.read_financial",
        "audit.read",
      ]),
  },
  {
    href: "/more",
    label: "More",
    icon: "☰",
    matches: ["/more"],
    visible: (roles) => roles.includes("Owner"),
  },
];

function isActive(pathname: string, matches: string[]): boolean {
  return matches.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export default function BottomNav({
  roles,
  actions,
}: {
  roles: WebRole[];
  actions: WebAction[];
}) {
  const pathname = usePathname();
  const actionSet = new Set(actions);
  const visibleItems = ITEMS.filter((item) => item.visible(roles, actionSet));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur">
      <ul className="flex">
        {visibleItems.map((item) => {
          const active = isActive(pathname, item.matches);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[60px] select-none flex-col items-center justify-center gap-1 px-1 text-xs transition duration-100 active:scale-[0.96] ${
                  active ? "text-emerald-600" : "text-slate-500 active:text-slate-800"
                }`}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                <span className={active ? "font-semibold" : "font-medium"}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
