import { redirect } from "next/navigation";

export default function LegacyFinanceHistoryPage() {
  redirect("/finance/records");
}
