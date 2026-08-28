import "server-only";

import { cookies } from "next/headers";
import { getSessionStaffId, SESSION_COOKIE } from "@/lib/auth";
import { isPlatformOwnerStaffId } from "@/lib/domain/platform/authority";

export interface PlatformOwnerSession {
  staffId: string;
  authority: "platform_owner";
}

function configuredPlatformOwners(): string {
  return String(process.env.PLATFORM_OWNER_STAFF_IDS || "").trim();
}

export async function getCurrentPlatformOwner(): Promise<PlatformOwnerSession | null> {
  const cookieStore = await cookies();
  const staffId = getSessionStaffId(cookieStore.get(SESSION_COOKIE)?.value);
  if (!staffId || !isPlatformOwnerStaffId(staffId, configuredPlatformOwners())) return null;
  return { staffId, authority: "platform_owner" };
}

export async function isCurrentPlatformOwner(): Promise<boolean> {
  return Boolean(await getCurrentPlatformOwner());
}

export async function requireCurrentPlatformOwner(): Promise<PlatformOwnerSession> {
  const owner = await getCurrentPlatformOwner();
  if (!owner) throw new Error("PLATFORM_ACCESS_DENIED");
  return owner;
}
