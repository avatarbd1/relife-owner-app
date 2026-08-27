import ChamberContextChatClient from "@/components/ChamberContextChatClient";
import { getChamberChatWorkspace } from "@/lib/webos/chamberChat";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function ChamberChatPage() {
  const context = await requireCurrentAccessContext();
  const workspace = await getChamberChatWorkspace(context);

  return (
    <div className="mx-auto w-full max-w-[430px]">
      <ChamberContextChatClient initial={workspace} />
    </div>
  );
}
