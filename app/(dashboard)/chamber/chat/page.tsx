import { redirect } from "next/navigation";

export default async function ChamberChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const team = params.tab === "equipment" ? "&team=equipment" : "";
  redirect(`/chamber?tab=team${team}`);
}
