"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AppIcon, { type AppIconName } from "@/components/AppIcon";
import type { WebAction, WebRole } from "@/lib/webos/access";

type NavItem = {
  href: string;
  label: string;
  icon: AppIconName;
  matches: string[];
  visible: (
    roles: WebRole[],
    actions: Set<WebAction>,
    hasPhysioAccess: boolean
  ) => boolean;
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
        "clinical.read",
        "clinical.write",
      ]),
  },
  {
    href: "/chamber",
    label: "Chamber",
    icon: "chamber",
    matches: ["/chamber"],
    visible: (_roles, actions, hasPhysioAccess) =>
      hasPhysioAccess && actions.has("chamber.read"),
  },
  {
    href: "/finance",
    label: "Finance",
    icon: "finance",
    matches: [
      "/finance",
      "/payments",
      "/salary",
      "/expenses",
      "/operations",
    ],
    visible: (roles) => roles.includes("Owner"),
  },
  {
    href: "/payments",
    label: "Payments",
    icon: "payment",
    matches: ["/payments"],
    visible: (roles, actions) =>
      !roles.includes("Owner") &&
      hasAny(actions, ["payment.read_amount", "payment.create", "payment.void"]),
  },
  {
    href: "/more",
    label: "More",
    icon: "more",
    matches: [
      "/more",
      "/menu",
      "/security",
      "/reports",
      "/pwa",
      "/audit",
      "/settings",
    ],
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
  hasPhysioAccess = false,
}: {
  roles: WebRole[];
  actions: WebAction[];
  hasPhysioAccess?: boolean;
}) {
  const pathname = usePathname();
  const [chamberPending, setChamberPending] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const visibleItems = useMemo(() => {
    const actionSet = new Set(actions);
    return ITEMS.filter((item) =>
      item.visible(roles, actionSet, hasPhysioAccess)
    );
  }, [actions, hasPhysioAccess, roles]);

  useEffect(() => {
    setIsNavigating(false);
  }, [pathname]);

  useEffect(() => {
    function onPending(event: Event) {
      const next = Number((event as CustomEvent<number>).detail || 0);
      setChamberPending(Number.isFinite(next) ? Math.max(0, next) : 0);
    }
    window.addEventListener("relife-chamber-pending", onPending);
    return () => window.removeEventListener("relife-chamber-pending", onPending);
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed left-1/2 top-0 z-50 h-0.5 w-full max-w-[430px] -translate-x-1/2 origin-left bg-blue-700 transition-[opacity,transform] duration-200 ease-out ${
          isNavigating
            ? "scale-x-100 opacity-100"
            : "scale-x-0 opacity-0"
        }`}
      />

      <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-5px_18px_rgba(15,23,42,0.045)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/90">
        <ul className="flex w-full">
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.matches);
            const pending = item.href === "/chamber" ? chamberPending : 0;
            const href =
              item.href === "/chamber" && pending > 0
                ? "/chamber?tab=team&team=messages#chamber-team-panel"
                : item.href;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (!active || href !== item.href) setIsNavigating(true);
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
                      active
                        ? "scale-x-100 opacity-100"
                        : "scale-x-[0.22] opacity-0"
                    }`}
                  />
                  <span
                    className={`relative transition-transform duration-100 ease-out ${
                      active
                        ? "-translate-y-0.5 scale-[1.07]"
                        : "translate-y-0 scale-100"
                    }`}
                  >
                    <AppIcon
                      name={item.icon}
                      className={`h-5 w-5 ${active ? "stroke-[2]" : ""}`}
                    />
                    {pending > 0 && (
                      <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[8px] font-bold leading-4 text-white ring-2 ring-white">
                        {pending > 9 ? "9+" : pending}
                      </span>
                    )}
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
