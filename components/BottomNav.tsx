"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import AppIcon, { type AppIconName } from "@/components/AppIcon";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import type { WebAction, WebRole } from "@/lib/webos/access";

type NavItem = {
  href: string;
  label: string;
  icon: AppIconName;
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
    icon: "home",
    matches: ["/home", "/daily"],
    visible: () => true,
  },
  {
    href: "/finance",
    label: "Finance",
    icon: "finance",
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
    icon: "patients",
    matches: ["/patients", "/appointments", "/register"],
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
    icon: "reports",
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
    icon: "more",
    matches: ["/more", "/menu", "/tools", "/security", "/corrections"],
    visible: () => true,
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
  hasPhysioAccess?: boolean;
}) {
  const pathname = usePathname();
  const visibleItems = useMemo(() => {
    const actionSet = new Set(actions);
    return ITEMS.filter((item) => item.visible(roles, actionSet));
  }, [actions, roles]);
  const swipeRoutes = useMemo(
    () => visibleItems.map((item) => ({ href: item.href, matches: item.matches })),
    [visibleItems]
  );
  const { isNavigating, setIsNavigating } = useSwipeNavigation({
    pathname,
    routes: swipeRoutes,
    threshold: 56,
  });

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-emerald-500 transition-[opacity,transform] duration-300 ${
          isNavigating ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-[19] bg-white transition-opacity duration-200 ${
          isNavigating ? "opacity-[0.08]" : "opacity-0"
        }`}
      />

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(15,23,42,0.05)] backdrop-blur">
        <ul className="flex">
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.matches);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (!active) setIsNavigating(true);
                  }}
                  className={`relative flex min-h-[62px] select-none flex-col items-center justify-center gap-1 px-1 text-[11px] transition duration-100 active:scale-[0.97] ${
                    active
                      ? "text-emerald-700"
                      : "text-slate-500 active:text-slate-800"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0 h-0.5 w-8 rounded-full bg-emerald-500 transition-all duration-200 ${
                      active ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
                    }`}
                  />
                  <AppIcon
                    name={item.icon}
                    className={`h-[21px] w-[21px] ${active ? "stroke-[2]" : ""}`}
                  />
                  <span className={active ? "font-semibold" : "font-medium"}>
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
