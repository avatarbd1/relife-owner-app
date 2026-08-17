import { PageHeading } from "@/components/WorkspaceUI";
import InventoryClient from "@/components/InventoryClient";
import { getPhysioInventorySnapshot } from "@/lib/webos/inventory";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function InventoryPage() {
  const context = await requireCurrentAccessContext();
  const inventory = await getPhysioInventorySnapshot(context);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeading
        title="📦 Inventory"
        subtitle="Stock tracking, reorder points, expiry dates · Physio only"
      />
      <InventoryClient
        items={inventory.items}
        recentLog={inventory.recentLog}
        canWrite={inventory.canWrite}
      />
    </div>
  );
}
