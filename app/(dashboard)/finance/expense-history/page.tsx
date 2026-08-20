import FinanceLedgerPage from "@/components/FinanceLedgerPage";

export default function ExpenseHistoryPage() {
  return <FinanceLedgerPage kind="expense-history" title="Expense history" subtitle="Requested, approved, paid and rejected expenses stay in one expense ledger with status and date filters." />;
}
