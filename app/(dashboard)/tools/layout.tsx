import { redirect } from "next/navigation";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  const context = await requireCurrentAccessContext();
  const hasPhysioAccess =
    context.departmentAccess.includes("Physio") ||
    context.departmentAccess.includes("All");

  if (!hasPhysioAccess) redirect("/home");
  return children;
}
