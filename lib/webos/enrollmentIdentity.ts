import "server-only";

import { readStaffEnrollmentToken, type StaffEnrollmentClaims } from "@/lib/staffEnrollment";
import { listPasskeysForStaff } from "@/lib/webauthn";
import { getCanonicalEnrollmentWebStaffById } from "@/lib/webos/canonicalStaffIdentity";
import { getActiveWebStaffById, toAccessContext, type WebStaffIdentity } from "@/lib/webos/staffDirectory";

export interface EnrollmentIdentity {
  identity: WebStaffIdentity;
  claims: StaffEnrollmentClaims;
}

export async function getEnrollmentIdentity(
  token: string | undefined | null
): Promise<EnrollmentIdentity | null> {
  if (!token) return null;
  const claims = readStaffEnrollmentToken(token);
  if (!claims) throw new Error("STAFF_ENROLLMENT_INVALID");

  const identity =
    (await getActiveWebStaffById(claims.staffId)) ||
    (await getCanonicalEnrollmentWebStaffById(claims.staffId));
  if (!identity || !toAccessContext(identity)) {
    throw new Error("STAFF_ENROLLMENT_ACCESS_DENIED");
  }

  const passkeys = await listPasskeysForStaff(identity.staffId);
  if (passkeys.length !== claims.passkeyCount) {
    throw new Error("STAFF_ENROLLMENT_ALREADY_USED");
  }

  return { identity, claims };
}
