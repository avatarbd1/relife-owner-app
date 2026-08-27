import { redirect } from "next/navigation";

export default function ExpensesPage() {
  redirect("/finance/operations?tab=expenses");
}
