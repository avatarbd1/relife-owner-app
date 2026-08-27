import { InlineNotice } from "@/components/FeedbackUI";
import InventoryClient from "@/components/InventoryClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { canPerform } from "@/lib/webos/access";
import { getPhysioInventorySnapshot } from "@/lib/webos/inventory";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function InventoryPage() {
  const context = await requireCurrentAccessContext();
  if (!canPerform(context, "inventory.read", "Physio")) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeading title="Inventory" subtitle="Physio stock workspace" />
        <InlineNotice tone="warning">এই account-এর Physio inventory access নেই।</InlineNotice>
      </div>
    );
  }

  const inventory = await getPhysioInventorySnapshot(context);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeading
        title="Inventory"
        subtitle="Physio stock, low-stock alerts, movement log and audited adjustments"
      />
      <InventoryClient
        items={inventory.items}
        recentLog={inventory.recentLog}
        canWrite={inventory.canWrite}
      />
    </div>
  );
}
