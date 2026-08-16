import ChamberNav from "@/components/ChamberNav";
import ChamberPatientEditPanel from "@/components/ChamberPatientEditPanel";
import ChamberReservationPanel from "@/components/ChamberReservationPanel";
import LiveChamberBoard from "@/components/LiveChamberBoard";
import { ProgressBar, StatusBadge } from "@/components/FeedbackUI";
import { canPerform } from "@/lib/webos/access";
import { getChamberBookingPlans } from "@/lib/webos/appointmentScheduling";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { getChamberCommsSnapshot } from "@/lib/webos/chamberComms";
import { enrichChamberSnapshotWithPatientProfiles } from "@/lib/webos/chamberPatientProfile";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

export default async function ChamberPage() {
  const context = await requireCurrentAccessContext();
  const [rawSnapshot, staffDirectory, comms] = await Promise.all([
    getChamberSnapshot(context),
    getWebStaffDirectory(),
    getChamberCommsSnapshot(context),
  ]);
  const [snapshot, bookingPlan] = await Promise.all([
    enrichChamberSnapshotWithPatientProfiles(context, rawSnapshot),
    getChamberBookingPlans(context, rawSnapshot.date),
  ]);
  const canEditPatient = canPerform(context, "patient.update", "Physio");
  const canAssignTherapist = canPerform(context, "chamber.run", "Physio");
  const therapists = staffDirectory
    .filter(
      (staff) =>
        staff.status === "Active" &&
        staff.roles.includes("Therapist") &&
        (staff.departmentAccess.includes("Physio") || staff.departmentAccess.includes("All"))
    )
    .map((staff) => ({ staffId: staff.staffId, fullName: staff.fullName }));

  const occupiedStations = snapshot.stations.filter((item) => Boolean(item.session)).length;
  const totalStations = snapshot.stations.length;
  const stationUtilization = totalStations > 0 ? (occupiedStations / totalStations) * 100 : 0;
  const busyMachines = snapshot.machines.filter((item) => Boolean(item.session)).length;
  const warnings = snapshot.queue.filter((item) => Boolean(item.allocationWarning));
  const mixedRooms = snapshot.stations.filter((item) => item.roomGender === "Mixed");
  const conflictCount = warnings.length + mixedRooms.length;

  const correctionItems = [
    ...snapshot.queue.map((item) => {
      const raw = rawSnapshot.queue.find((row) => row.appointmentId === item.appointmentId);
      return {
        appointmentId: item.appointmentId,
        patientId: item.patientId,
        patientName: item.patientName,
        therapist: item.therapist,
        gender: item.gender,
        chamberGender: raw?.gender || "" as const,
        state: "Waiting" as const,
        station: item.recommendedStationId,
        warning: item.allocationWarning,
      };
    }),
    ...snapshot.stations.flatMap((station) => {
      if (!station.session) return [];
      const raw = rawSnapshot.stations.find(
        (row) => row.resource.resourceId === station.resource.resourceId
      )?.session;
      return [{
        appointmentId: station.session.appointmentId,
        patientId: station.session.patientId,
        patientName: station.session.patientName,
        therapist: station.session.therapist,
        gender: station.session.gender,
        chamberGender: raw?.gender || "" as const,
        state: "In Treatment" as const,
        station: station.resource.resourceName,
        warning: raw?.gender && raw.gender !== station.session.gender
          ? "Patient master gender differs from the active chamber session."
          : "",
      }];
    }),
  ];

  const uniqueCorrectionItems = [...new Map(
    correctionItems.map((item) => [item.patientId, item])
  ).values()];

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Physio operations</p>
            <h1 className="mt-1 text-2xl font-bold">Live chamber</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Beds, patient flow, machines, team chat and treatment safety in one workspace.</p>
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

      <ChamberNav pending={comms.pendingUrgentCount} />

      <div id="beds" className="scroll-mt-28">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-base font-semibold text-slate-950">Beds now</h2><p className="mt-0.5 text-xs text-slate-500">Bed 1–4 + traction live status</p></div>
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
      </div>

      <div id="waiting" className="scroll-mt-28">
        <ChamberPatientEditPanel
          initialItems={uniqueCorrectionItems}
          canEdit={canEditPatient}
          canAssignTherapist={canAssignTherapist}
          therapists={therapists}
        />
      </div>

      <div id="machines" className="scroll-mt-28">
        <ChamberReservationPanel plans={bookingPlan.plans} reservations={bookingPlan.reservations} />
      </div>

      <div id="conflicts" className="scroll-mt-28">
        {conflictCount > 0 ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-amber-950">Allocation warnings</h2><p className="mt-0.5 text-xs text-amber-800">Resolve before assigning a station or resource.</p></div><StatusBadge tone="warning">{conflictCount}</StatusBadge></div>
            <div className="mt-3 space-y-2">
              {mixedRooms.map((station) => <div key={`mixed-${station.resource.resourceId}`} className="rounded-lg bg-white/70 p-3 text-xs font-medium text-red-800 ring-1 ring-red-100">{station.resource.resourceName}: mixed-gender occupancy conflict detected.</div>)}
              {warnings.map((item) => <div key={`warning-${item.appointmentId}`} className="rounded-lg bg-white/70 p-3 text-xs text-amber-900 ring-1 ring-amber-100"><strong>{item.patientName || item.patientId}</strong> · {item.allocationWarning}</div>)}
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 shadow-sm">
            <strong>No active allocation conflict.</strong> Gender and station safety checks are healthy.
          </section>
        )}
      </div>

      <LiveChamberBoard initial={snapshot} />
    </div>
  );
}
