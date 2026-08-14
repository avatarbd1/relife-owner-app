import { redirect } from "next/navigation";
import { Suspense } from "react";
import PasskeyManager from "@/components/PasskeyManager";
import { getCurrentStaffIdentity } from "@/lib/webos/currentUser";
import { listPasskeysForStaff } from "@/lib/webauthn";

export default async function PasskeysPage() {
  const identity = await getCurrentStaffIdentity();
  if (!identity) redirect("/login");
  const passkeys = await listPasskeysForStaff(identity.staffId);

  return (
    <Suspense fallback={<div className="rounded-2xl bg-white p-4 text-sm text-slate-500">Loading security settings...</div>}>
      <PasskeyManager staffName={identity.fullName || identity.staffId} initialPasskeys={passkeys} />
    </Suspense>
  );
}
