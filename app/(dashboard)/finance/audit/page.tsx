import { redirect } from "next/navigation";
import FinanceLedgerPage from "@/components/FinanceLedgerPage";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function FinanceAuditPage() {
  const context = await requireCurrentAccessContext();
  if (!context.roles.some((role) => role === "Owner" || role === "Auditor")) {
    redirect("/finance/records");
  }
  return <FinanceLedgerPage kind="audit" title="Finance audit" subtitle="Owner/Auditor cross-ledger investigation view. Collections, expenses, cash handovers and salary evidence remain distinguishable by ledger type." />;
}
