"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/chamber#beds", label: "Beds" },
  { href: "/chamber#waiting", label: "Waiting" },
  { href: "/chamber#machines", label: "Machines" },
  { href: "/chamber/chat", label: "Chat" },
  { href: "/chamber#conflicts", label: "Conflicts" },
];

export default function ChamberNav({ pending = 0 }: { pending?: number }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 overflow-x-auto pb-1" aria-label="Chamber sections">
      <div className="flex min-w-max gap-2 px-1">
        {ITEMS.map((item) => {
          const active = item.href.startsWith("/chamber/chat")
            ? pathname.startsWith("/chamber/chat")
            : item.label === "Beds" && pathname === "/chamber";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relife-interactive relative flex min-h-10 items-center rounded-xl border px-3 text-xs font-semibold ${
                active
                  ? "border-blue-700 bg-blue-800 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              {item.label}
              {item.label === "Chat" && pending > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? "bg-white text-blue-800" : "bg-red-600 text-white"}`}>
                  {pending > 99 ? "99+" : pending}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
