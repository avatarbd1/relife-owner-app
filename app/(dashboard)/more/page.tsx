import OwnerControlsClient from "@/components/OwnerControlsClient";
import { getOwnerControlSnapshot } from "@/lib/controls";

export default async function MorePage() {
  const snapshot = await getOwnerControlSnapshot();
  return <OwnerControlsClient snapshot={snapshot} />;
}
