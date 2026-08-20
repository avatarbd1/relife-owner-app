import Link from "next/link";
import ChamberCapacityBoard from "@/components/ChamberCapacityBoard";
import ChamberCommsClient from "@/components/ChamberCommsClient";
import ChamberDirectCall from "@/components/ChamberDirectCall";
import ChamberWorkspaceTabs from "@/components/ChamberWorkspaceTabs";
import LiveChamberBoard from "@/components/LiveChamberBoard";
import { StatusBadge } from "@/components/FeedbackUI";
import { chamberHourSlots, getHourlyBedBoard } from "@/lib/domain/chamber/board";
import { canPerform } from "@/lib/webos/access";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { getChamberCommsSnapshot } from "@/lib/webos/chamberComms";
import { enrichChamberSnapshotWithPatientProfiles } from "@/lib/webos/chamberPatientProfile";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getVisiblePatients, todayDhaka } from "@/lib/webos/reception";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

type ChamberTab = "schedule" | "live" | "team";

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function chamberTab(value: string | undefined): ChamberTab {
  if (value === "live" || value === "team") return value;
  return "schedule";
}

export default async function ChamberPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; tab?: string; team?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const params = searchParams ? await searchParams : {};
  const today = todayDhaka();
  const selectedDate = validDate(params.date) ? params.date : today;
  const activeTab = chamberTab(params.tab);

  let panel: React.ReactNode;
  let pendingTeam = 0;
  let statusLabel = "Capacity plan";
  let statusTone: "info" | "success" | "warning" = "info";

  if (activeTab === "schedule") {
    const [hourlyAppointments, visiblePatients] = await Promise.all([
      getHourlyBedBoard(context, selectedDate),
      getVisiblePatients(context, "physio"),
    ]);
    const canBook = canPerform(context, "appointment.create", "Physio");
    const patientGender = visiblePatients
      .filter((patient) => patient.department === "Physio" && patient.status !== "Inactive")
      .map((patient) => ({ patientId: patient.patientId, gender: patient.gender }));

    panel = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <div>
            <h2 className="text-base font-bold text-slate-950">Booking capacity</h2>
            <p className="mt-0.5 text-xs text-slate-500">10 hourly windows · 4 general beds · 60 ± 5 min</p>
          </div>
          <StatusBadge tone="info">{selectedDate === today ? "Today" : selectedDate}</StatusBadge>
        </div>
        <ChamberCapacityBoard
          date={selectedDate}
          appointments={hourlyAppointments}
          slots={chamberHourSlots()}
          patients={patientGender}
          canBook={canBook}
        />
      </div>
    );
  } else if (activeTab === "live") {
    const rawSnapshot = await getChamberSnapshot(context);
    const snapshot = await enrichChamberSnapshotWithPatientProfiles(context, rawSnapshot);
    const generalStations = snapshot.stations.filter((item) => /^BED-[1-4]$/.test(item.resource.resourceId));
    const occupiedStations = generalStations.filter((item) => item.session).length;
    const waiting = snapshot.queue.length;
    const warnings = snapshot.queue.filter((item) => Boolean(item.allocationWarning) && !/Receive patient first/i.test(item.allocationWarning));
    const mixedRooms = generalStations.filter((item) => item.roomGender === "Mixed");
    const conflictCount = warnings.length + mixedRooms.length;
    statusLabel = conflictCount ? `${conflictCount} alert` : "Live healthy";
    statusTone = conflictCount ? "warning" : "success";

    panel = (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-center">
            <p className="text-lg font-bold text-blue-950">{occupiedStations}/4</p>
            <p className="text-[10px] text-blue-700">General beds in use</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-center">
            <p className="text-lg font-bold text-amber-950">{waiting}</p>
            <p className="text-[10px] text-amber-700">Arrivals / waiting</p>
          </div>
        </div>

        {conflictCount > 0 ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-amber-950">{conflictCount} item{conflictCount === 1 ? "" : "s"} need attention</p>
                <p className="mt-0.5 text-[10px] text-amber-800">Only real room/gender conflicts need correction.</p>
              </div>
              <StatusBadge tone="warning">Check</StatusBadge>
            </div>
            <div className="mt-2 space-y-1.5">
              {warnings.slice(0, 3).map((item) => (
                <Link
                  key={item.appointmentId}
                  href={`/patients/${encodeURIComponent(item.patientId)}?edit=1`}
                  className="block rounded-lg bg-white/80 px-3 py-2 text-[11px] font-medium text-amber-900 ring-1 ring-amber-100"
                >
                  {item.patientName || item.patientId} · {item.allocationWarning}
                </Link>
              ))}
              {mixedRooms.slice(0, 2).map((station) => (
                <div key={station.resource.resourceId} className="rounded-lg bg-white/80 px-3 py-2 text-[11px] font-medium text-red-800 ring-1 ring-red-100">
                  {station.resource.roomId} · mixed-gender room conflict
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <LiveChamberBoard initial={snapshot} />
      </div>
    );
  } else {
    const [comms, chamber, staffDirectory] = await Promise.all([
      getChamberCommsSnapshot(context),
      getChamberSnapshot(context),
      getWebStaffDirectory(),
    ]);
    pendingTeam = comms.pendingUrgentCount;
    statusLabel = pendingTeam ? `${pendingTeam} urgent` : "Team ready";
    statusTone = pendingTeam ? "warning" : "success";

    const activePatients = [
      ...chamber.queue.map((item) => ({
        appointmentId: item.appointmentId,
        patientId: item.patientId,
        patientName: item.patientName,
        bedId: item.recommendedStationId,
        roomId: "",
      })),
      ...chamber.stations.flatMap((station) => {
        if (!station.session || !/^BED-[1-4]$/.test(station.resource.resourceId)) return [];
        return [{
          appointmentId: station.session.appointmentId,
          patientId: station.session.patientId,
          patientName: station.session.patientName,
          bedId: station.resource.resourceName,
          roomId: station.resource.roomId,
        }];
      }),
    ];
    const uniquePatients = [...new Map(activePatients.map((item) => [item.appointmentId, item])).values()];
    const callTargets = staffDirectory
      .filter(
        (staff) =>
          staff.status === "Active" &&
          staff.staffId !== context.staffId &&
          (staff.departmentAccess.includes("Physio") || staff.departmentAccess.includes("All")) &&
          staff.roles.some((role) => ["Owner", "Manager", "Receptionist", "Therapist"].includes(role))
      )
      .map((staff) => ({ staffId: staff.staffId, fullName: staff.fullName, roles: staff.roles }));
    const canBroadcast = context.roles.some((role) => role === "Owner" || role === "Manager");

    panel = (
      <div className="space-y-4">
        <ChamberDirectCall targets={callTargets} canBroadcast={canBroadcast} />
        <ChamberCommsClient
          initial={comms}
          activePatients={uniquePatients}
          defaultTab={params.team === "equipment" ? "equipment" : "messages"}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 p-4 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">Physio operations</p>
            <h1 className="mt-1 text-xl font-bold">Live Chamber</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Booking plans capacity. Live operation records what actually happens.</p>
          </div>
          <StatusBadge tone={statusTone} className="border-white/10">{statusLabel}</StatusBadge>
        </div>
      </section>

      <ChamberWorkspaceTabs activeTab={activeTab} date={selectedDate} panel={panel} pendingTeam={pendingTeam} />
    </div>
  );
}
