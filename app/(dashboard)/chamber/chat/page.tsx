import ChamberCommsClient from "@/components/ChamberCommsClient";
import ChamberNav from "@/components/ChamberNav";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { getChamberCommsSnapshot } from "@/lib/webos/chamberComms";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function ChamberChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const params = searchParams ? await searchParams : {};
  const [comms, chamber] = await Promise.all([
    getChamberCommsSnapshot(context),
    getChamberSnapshot(context),
  ]);

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

  return (
    <div className="space-y-4">
      <ChamberNav pending={comms.pendingUrgentCount} />
      <ChamberCommsClient
        initial={comms}
        activePatients={uniquePatients}
        defaultTab={params.tab === "equipment" ? "equipment" : "messages"}
      />
    </div>
  );
}
