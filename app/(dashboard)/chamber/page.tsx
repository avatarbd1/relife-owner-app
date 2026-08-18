import Link from "next/link";
import ChamberCommsClient from "@/components/ChamberCommsClient";
import ChamberDirectCall from "@/components/ChamberDirectCall";
import ChamberHourlyBedBoard from "@/components/ChamberHourlyBedBoard";
import ChamberWorkspaceTabs from "@/components/ChamberWorkspaceTabs";
import LiveChamberBoard from "@/components/LiveChamberBoard";
import { StatusBadge } from "@/components/FeedbackUI";
import {
  chamberHourSlots,
  getHourlyBedBoard,
} from "@/lib/domain/chamber/board";
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
  searchParams?: Promise<{
    date?: string;
    tab?: string;
    team?: string;
  }>;
}) {
  const context = await requireCurrentAccessContext();
  const params = searchParams ? await searchParams : {};
  const today = todayDhaka();
  const selectedDate = validDate(params.date) ? params.date : today;
  const activeTab = chamberTab(params.tab);

  let panel: React.ReactNode;
  let pendingTeam = 0;
  let statusLabel = "Schedule";
  let statusTone: "info" | "success" | "warning" = "info";

  if (activeTab === "schedule") {
    const [staffDirectory, hourlyAppointments, visiblePatients] =
      await Promise.all([
        getWebStaffDirectory(),
        getHourlyBedBoard(context, selectedDate),
        getVisiblePatients(context, "physio"),
      ]);
    const canBook = canPerform(context, "appointment.create", "Physio");
    const therapists = staffDirectory
      .filter(
        (staff) =>
          staff.status === "Active" &&
          staff.roles.includes("Therapist") &&
          (staff.departmentAccess.includes("Physio") ||
            staff.departmentAccess.includes("All"))
      )
      .map((staff) => ({ staffId: staff.staffId, fullName: staff.fullName }));
    const bookingPatients = visiblePatients
      .filter(
        (patient) =>
          patient.department === "Physio" && patient.status !== "Inactive"
      )
      .map((patient) => ({
        patientId: patient.patientId,
        fullName: patient.fullName,
        gender: patient.gender,
        defaultTherapist: patient.therapist,
      }));

    panel = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <div>
            <h2 className="text-base font-bold text-slate-950">Bed schedule</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              10 hourly slots · Bed 1–4 · max 40 patients/day
            </p>
          </div>
          <StatusBadge tone="info">
            {selectedDate === today ? "Today" : selectedDate}
          </StatusBadge>
        </div>
        <ChamberHourlyBedBoard
          date={selectedDate}
          today={today}
          appointments={hourlyAppointments}
          slots={chamberHourSlots()}
          patients={bookingPatients}
          clinicians={therapists}
          canBook={canBook}
        />
        <p className="px-1 text-[10px] leading-4 text-slate-400">
          Bed, therapist, room-gender and machine conflicts are checked by the
          scheduling engine before a booking is saved.
        </p>
      </div>
    );
  } else if (activeTab === "live") {
    const rawSnapshot = await getChamberSnapshot(context);
    const snapshot = await enrichChamberSnapshotWithPatientProfiles(
      context,
      rawSnapshot
    );
    const occupiedStations = snapshot.stations.filter((item) => item.session).length;
    const busyMachines = snapshot.machines.filter((item) => item.session).length;
    const waiting = snapshot.queue.length;
    const warnings = snapshot.queue.filter((item) =>
      Boolean(item.allocationWarning)
    );
    const mixedRooms = snapshot.stations.filter(
      (item) => item.roomGender === "Mixed"
    );
    const conflictCount = warnings.length + mixedRooms.length;
    statusLabel = conflictCount ? `${conflictCount} alert` : "Live healthy";
    statusTone = conflictCount ? "warning" : "success";

    panel = (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-center">
            <p className="text-lg font-bold text-blue-950">{occupiedStations}</p>
            <p className="text-[10px] text-blue-700">In beds</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-center">
            <p className="text-lg font-bold text-amber-950">{waiting}</p>
            <p className="text-[10px] text-amber-700">Waiting</p>
          </div>
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-3 text-center">
            <p className="text-lg font-bold text-violet-950">{busyMachines}</p>
            <p className="text-[10px] text-violet-700">Machines</p>
          </div>
        </div>

        {conflictCount > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-amber-950">
                  {conflictCount} item{conflictCount === 1 ? "" : "s"} need attention
                </p>
                <p className="mt-0.5 text-[10px] text-amber-800">
                  Resolve patient or room allocation before the next move.
                </p>
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
                <div
                  key={station.resource.resourceId}
                  className="rounded-lg bg-white/80 px-3 py-2 text-[11px] font-medium text-red-800 ring-1 ring-red-100"
                >
                  {station.resource.resourceName} · mixed-gender room conflict
                </div>
              ))}
            </div>
          </section>
        )}

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
        if (!station.session) return [];
        return [
          {
            appointmentId: station.session.appointmentId,
            patientId: station.session.patientId,
            patientName: station.session.patientName,
            bedId: station.resource.resourceName,
            roomId: station.resource.roomId,
          },
        ];
      }),
    ];
    const uniquePatients = [
      ...new Map(
        activePatients.map((item) => [item.appointmentId, item])
      ).values(),
    ];
    const callTargets = staffDirectory
      .filter(
        (staff) =>
          staff.status === "Active" &&
          staff.staffId !== context.staffId &&
          (staff.departmentAccess.includes("Physio") || staff.departmentAccess.includes("All")) &&
          staff.roles.some((role) =>
            ["Owner", "Manager", "Receptionist", "Therapist"].includes(role)
          )
      )
      .map((staff) => ({
        staffId: staff.staffId,
        fullName: staff.fullName,
        roles: staff.roles,
      }));
    const canBroadcast = context.roles.some(
      (role) => role === "Owner" || role === "Manager"
    );

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
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">
              Physio operations
            </p>
            <h1 className="mt-1 text-xl font-bold">Live Chamber</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              Schedule the hour, run the patient, call the team — one workspace.
            </p>
          </div>
          <StatusBadge tone={statusTone} className="border-white/10">
            {statusLabel}
          </StatusBadge>
        </div>
      </section>

      <ChamberWorkspaceTabs
        activeTab={activeTab}
        date={selectedDate}
        panel={panel}
        pendingTeam={pendingTeam}
      />
    </div>
  );
}
