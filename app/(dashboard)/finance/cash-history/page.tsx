import FinanceLedgerPage from "@/components/FinanceLedgerPage";

export default function CashHistoryPage() {
  return <FinanceLedgerPage kind="cash-history" title="Cash handover history" subtitle="Internal Reception → Treasury → Bank movements remain separate from expenses, with status and discrepancy evidence." />;
}
