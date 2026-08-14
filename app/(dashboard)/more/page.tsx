import { cookies } from "next/headers";
import OwnerControlsClient from "@/components/OwnerControlsClient";
import { getOwnerControlSnapshot } from "@/lib/controls";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") {
    return value;
  }
  return "combined";
}

export default async function MorePage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const snapshot = await getOwnerControlSnapshot();

  const scopedSnapshot =
    scope === "combined"
      ? snapshot
      : {
          ...snapshot,
          pendingExpenses: snapshot.pendingExpenses.filter(
            (item) => item.workbook === scope
          ),
          pendingCashMovements: snapshot.pendingCashMovements.filter(
            (item) => item.workbook === scope
          ),
        };

  return <OwnerControlsClient snapshot={scopedSnapshot} />;
}
