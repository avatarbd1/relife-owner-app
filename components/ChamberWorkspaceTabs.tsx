import Link from "next/link";
import ChamberBookingAssist from "@/components/ChamberBookingAssist";

type Tab = "schedule" | "live" | "team";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "schedule", label: "Schedule", hint: "Beds & booking" },
  { id: "live", label: "Live", hint: "Now treating" },
  { id: "team", label: "Team", hint: "Chat & equipment" },
];

export default function ChamberWorkspaceTabs({
  activeTab,
  date,
  panel,
  pendingTeam = 0,
}: {
  activeTab: Tab;
  date: string;
  panel: React.ReactNode;
  pendingTeam?: number;
}) {
  return (
    <div className="space-y-4">
      <ChamberBookingAssist />
      <nav
        className="sticky top-[58px] z-10 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur"
        aria-label="Live Chamber workspace"
      >
        {TABS.map((item) => {
          const active = activeTab === item.id;
          const badge = item.id === "team" ? pendingTeam : 0;
          const params = new URLSearchParams({ tab: item.id, date });
          return (
            <Link
              key={item.id}
              href={`/chamber?${params.toString()}#chamber-${item.id}-panel`}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[54px] flex-col items-center justify-center rounded-lg px-2 py-2 text-center transition ${
                active
                  ? "bg-blue-800 text-white shadow-sm"
                  : "text-slate-600 active:bg-slate-100"
              }`}
            >
              <span className="block text-xs font-bold">{item.label}</span>
              <span
                className={`mt-0.5 block text-[9px] ${
                  active ? "text-blue-100" : "text-slate-400"
                }`}
              >
                {item.hint}
              </span>
              {badge > 0 && (
                <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-red-600 px-1 text-[8px] font-bold leading-4 text-white ring-2 ring-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div
        id={`chamber-${activeTab}-panel`}
        className="scroll-mt-32"
      >
        {panel}
      </div>
    </div>
  );
}
