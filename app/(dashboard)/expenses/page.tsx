import { redirect } from "next/navigation";

export default function ExpensesPage() {
  redirect("/operations?tab=expenses");
}
