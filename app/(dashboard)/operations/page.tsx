import { redirect } from "next/navigation";

const VALID_TABS = new Set(["payment", "expenses", "cash", "salary"]);

export default async function OperationsCompatibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = VALID_TABS.has(params.tab || "") ? params.tab : undefined;
  redirect(tab ? `/finance/operations?tab=${tab}` : "/finance/operations");
}
