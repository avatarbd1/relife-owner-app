"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/home", label: "Home", icon: "🏠" },
  { href: "/finance", label: "Finance", icon: "💰" },
  { href: "/patients", label: "Patients", icon: "🩺" },
  { href: "/reports", label: "Reports", icon: "📊" },
  { href: "/more", label: "More", icon: "☰" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-xs ${
                  active ? "text-emerald-600" : "text-slate-500"
                }`}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                <span className={active ? "font-semibold" : ""}>
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
