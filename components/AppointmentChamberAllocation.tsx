"use client";

interface ChamberAllocation {
  roomId: string;
  bedId: string;
  bedLabel: string;
  station: "Treatment" | "Traction";
  gender: "Male" | "Female" | "";
  confirmed: boolean;
}

interface AppointmentChamberAllocationProps {
  allocation?: ChamberAllocation;
  loading?: boolean;
}

function bedColor(bedLabel: string): string {
  if (bedLabel.includes("Traction")) return "bg-amber-50 border-amber-200 text-amber-700";
  if (bedLabel.includes("1") || bedLabel.includes("3")) return "bg-sky-50 border-sky-200 text-sky-700";
  if (bedLabel.includes("2") || bedLabel.includes("4")) return "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700";
  return "bg-slate-50 border-slate-200 text-slate-600";
}

function genderIcon(gender: string): string {
  if (gender === "Male") return "👨";
  if (gender === "Female") return "👩";
  return "•";
}

export default function AppointmentChamberAllocation({
  allocation,
  loading,
}: AppointmentChamberAllocationProps) {
  if (!allocation && !loading) {
    return null;
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-600">Chamber allocation</p>
        <p className="mt-1 text-[10px] text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!allocation) {
    return null;
  }

  return (
    <div className={`rounded-lg border p-3 ${bedColor(allocation.bedLabel)}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">
            {allocation.bedLabel} · {allocation.station}
          </p>
          <p className="mt-0.5 text-[10px]">{allocation.roomId}</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-lg">{genderIcon(allocation.gender)}</span>
          {allocation.confirmed ? (
            <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">✓ Reserved</span>
          ) : (
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">Pending</span>
          )}
        </div>
      </div>
      <p className="mt-2 text-[9px] text-opacity-75">
        Pre-allocated resource. Confirmed at booking. Bed must match gender & availability at arrival.
      </p>
    </div>
  );
}
