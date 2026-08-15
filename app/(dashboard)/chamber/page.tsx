import LiveChamberBoard from "@/components/LiveChamberBoard";
import { PageHeading } from "@/components/WorkspaceUI";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function ChamberPage() {
  const context = await requireCurrentAccessContext();
  const snapshot = await getChamberSnapshot(context);

  return (
    <div>
      <PageHeading
        title="Live chamber"
        subtitle="Beds, traction, machine locks and live patient timing"
      />
      <LiveChamberBoard initial={snapshot} />
    </div>
  );
}
