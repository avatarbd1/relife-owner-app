import { redirect } from "next/navigation";
import { isCurrentPlatformOwner } from "@/lib/platform/currentPlatformOwner";

export default async function RootPage() {
  if (await isCurrentPlatformOwner()) {
    redirect("/platform");
  }
  redirect("/home");
}
