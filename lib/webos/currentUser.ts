import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionStaffId } from "@/lib/auth";
import type { AccessContext } from "@/lib/webos/access";
import {
  getActiveWebStaffById,
  toAccessContext,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";

export async function getCurrentStaffIdentity(): Promise<WebStaffIdentity | null> {
  const cookieStore = await cookies();
  const staffId = getSessionStaffId(cookieStore.get(SESSION_COOKIE)?.value);
  if (!staffId) return null;
  return getActiveWebStaffById(staffId);
}

export async function getCurrentAccessContext(): Promise<AccessContext | null> {
  const identity = await getCurrentStaffIdentity();
  return identity ? toAccessContext(identity) : null;
}

export async function requireCurrentAccessContext(): Promise<AccessContext> {
  const context = await getCurrentAccessContext();
  if (!context) throw new Error("ACCESS_DENIED");
  return context;
}
