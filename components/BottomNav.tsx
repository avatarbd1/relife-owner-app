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
  const {
    isNavigating,
    setIsNavigating,
    swipeProgress,
    swipeDirection,
  } = useSwipeNavigation({
    pathname,
    routes: swipeRoutes,
    threshold: 52,
  });

  const activeIndex = visibleItems.findIndex((item) =>
    isActive(pathname, item.matches)
  );
  const swipeTarget =
    swipeDirection === "next"
      ? visibleItems[activeIndex + 1]
      : swipeDirection === "previous"
        ? visibleItems[activeIndex - 1]
        : undefined;
  const cueOpacity = Math.max(0, Math.min(1, (swipeProgress - 0.08) / 0.92));
  const cueShift = 10 * (1 - swipeProgress);

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-blue-700 transition-[opacity,transform] duration-200 ease-out ${
          isNavigating ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
        }`}
      />

      {swipeTarget && swipeProgress > 0.08 && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed top-1/2 z-50 -translate-y-1/2 rounded-full bg-slate-900/92 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur ${
            swipeDirection === "next" ? "right-3" : "left-3"
          }`}
          style={{
            opacity: cueOpacity,
            transform: `translateY(-50%) translateX(${swipeDirection === "next" ? cueShift : -cueShift}px) scale(${0.96 + swipeProgress * 0.04})`,
          }}
        >
          {swipeDirection === "previous" ? "‹ " : ""}
          {swipeTarget.label}
          {swipeDirection === "next" ? " ›" : ""}
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-5px_18px_rgba(15,23,42,0.045)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/90">
        <ul className="mx-auto flex w-full max-w-3xl">
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
                  className={`relative flex min-h-[60px] select-none flex-col items-center justify-center gap-0.5 px-1 text-[10.5px] transition-[color,transform] duration-100 ease-out ${
                    active
                      ? "text-blue-800"
                      : "text-slate-500 active:text-slate-800"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0 h-0.5 w-9 origin-center rounded-full bg-blue-700 transition-[opacity,transform] duration-100 ease-out ${
                      active ? "scale-x-100 opacity-100" : "scale-x-[0.22] opacity-0"
                    }`}
                  />
                  <span
                    className={`transition-transform duration-100 ease-out ${
                      active ? "-translate-y-0.5 scale-[1.07]" : "translate-y-0 scale-100"
                    }`}
                  >
                    <AppIcon
                      name={item.icon}
                      className={`h-5 w-5 ${active ? "stroke-[2]" : ""}`}
                    />
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
    </>
  );
}
