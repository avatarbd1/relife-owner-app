import LiveChamberBoard from "@/components/LiveChamberBoard";
import { ProgressBar, StatusBadge } from "@/components/FeedbackUI";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function ChamberPage() {
  const context = await requireCurrentAccessContext();
  const snapshot = await getChamberSnapshot(context);
  const occupiedStations = snapshot.stations.filter((item) => Boolean(item.session)).length;
  const totalStations = snapshot.stations.length;
  const stationUtilization = totalStations > 0 ? (occupiedStations / totalStations) * 100 : 0;
  const busyMachines = snapshot.machines.filter((item) => Boolean(item.session)).length;
  const warnings = snapshot.queue.filter((item) => Boolean(item.allocationWarning));
  const mixedRooms = snapshot.stations.filter((item) => item.roomGender === "Mixed");
  const conflictCount = warnings.length + mixedRooms.length;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Physio operations</p>
            <h1 className="mt-1 text-2xl font-bold">Live chamber</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Beds, traction, patient timing, machine locks and allocation safety.</p>
          </div>
          <StatusBadge tone={conflictCount ? "warning" : "success"} className="border-white/10">
            {conflictCount ? `${conflictCount} warnings` : "Live healthy"}
          </StatusBadge>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg bg-white/10 p-2"><p className="text-[10px] text-slate-300">Occupied</p><p className="mt-1 text-lg font-bold">{occupiedStations}/{totalStations}</p></div>
          <div className="rounded-lg bg-amber-400/10 p-2"><p className="text-[10px] text-amber-200">Waiting</p><p className="mt-1 text-lg font-bold text-amber-100">{snapshot.queue.length}</p></div>
          <div className="rounded-lg bg-blue-400/10 p-2"><p className="text-[10px] text-blue-200">Machines busy</p><p className="mt-1 text-lg font-bold text-blue-100">{busyMachines}</p></div>
          <div className={`rounded-lg p-2 ${conflictCount ? "bg-red-400/10" : "bg-emerald-400/10"}`}><p className={`text-[10px] ${conflictCount ? "text-red-200" : "text-emerald-200"}`}>Conflicts</p><p className={`mt-1 text-lg font-bold ${conflictCount ? "text-red-100" : "text-emerald-100"}`}>{conflictCount}</p></div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-slate-950">Station utilization</h2><p className="mt-0.5 text-xs text-slate-500">Current occupied treatment stations</p></div>
          <StatusBadge tone={stationUtilization >= 100 ? "warning" : stationUtilization >= 50 ? "info" : "success"}>{Math.round(stationUtilization)}%</StatusBadge>
        </div>
        <ProgressBar value={stationUtilization} label={`${occupiedStations} occupied · ${Math.max(0, totalStations - occupiedStations)} free`} className="mt-4" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {snapshot.stations.map((station) => (
            <div key={station.resource.resourceId} className={`rounded-lg border p-3 ${station.session ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}>
              <p className="truncate text-xs font-semibold text-slate-900">{station.resource.resourceName}</p>
              <p className={`mt-1 text-[10px] font-semibold ${station.session ? "text-blue-700" : "text-emerald-700"}`}>{station.session ? `In use · ${station.session.patientName}` : "Free"}</p>
              {station.roomGender && <p className={`mt-1 text-[10px] ${station.roomGender === "Mixed" ? "font-semibold text-red-700" : "text-slate-500"}`}>{station.roomGender} room</p>}
            </div>
          ))}
        </div>
      </section>

      {conflictCount > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-amber-950">Allocation warnings</h2><p className="mt-0.5 text-xs text-amber-800">Resolve before assigning a station or resource.</p></div><StatusBadge tone="warning">{conflictCount}</StatusBadge></div>
          <div className="mt-3 space-y-2">
            {mixedRooms.map((station) => <div key={`mixed-${station.resource.resourceId}`} className="rounded-lg bg-white/70 p-3 text-xs font-medium text-red-800 ring-1 ring-red-100">{station.resource.resourceName}: mixed-gender occupancy conflict detected.</div>)}
            {warnings.map((item) => <div key={`warning-${item.appointmentId}`} className="rounded-lg bg-white/70 p-3 text-xs text-amber-900 ring-1 ring-amber-100"><strong>{item.patientName || item.patientId}</strong> · {item.allocationWarning}</div>)}
          </div>
        </section>
      )}

      <LiveChamberBoard initial={snapshot} />
    </div>
  );
}
