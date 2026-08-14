"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/home", label: "Home", icon: "🏠", matches: ["/home", "/daily"] },
  {
    href: "/finance",
    label: "Finance",
    icon: "💰",
    matches: ["/finance", "/operations"],
  },
  {
    href: "/patients",
    label: "Patients",
    icon: "🩺",
    matches: ["/patients", "/appointments"],
  },
  { href: "/reports", label: "Reports", icon: "📊", matches: ["/reports"] },
  { href: "/more", label: "More", icon: "☰", matches: ["/more"] },
];

function isActive(pathname: string, matches: string[]): boolean {
  return matches.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur">
      <ul className="flex">
        {ITEMS.map((item) => {
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
