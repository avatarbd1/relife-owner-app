import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import ChamberContextChatClient from "@/components/ChamberContextChatClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { getChamberChatWorkspace } from "@/lib/webos/chamberChat";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function ChamberChatPage() {
  const context = await requireCurrentAccessContext();
  const workspace = await getChamberChatWorkspace(context);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        title="Chat"
        subtitle="Room · patient · session communication"
        action={
          <Link
            href="/chamber"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm active:scale-[0.98]"
          >
            <AppIcon name="chamber" className="h-4 w-4" />
            Chamber
          </Link>
        }
      />

      <ChamberContextChatClient initial={workspace} />
    </div>
  );
}
