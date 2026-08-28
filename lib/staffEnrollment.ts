import crypto from "crypto";
import type { TenantScope } from "@/lib/domain/tenancy/policy";

export const STAFF_ENROLL_COOKIE = "relife_staff_enroll";
export const STAFF_ENROLL_MAX_AGE = 10 * 60;

export interface StaffEnrollmentClaims {
  version: 1;
  staffId: string;
  organizationId?: string;
  clinicId?: string;
  passkeyCount: number;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.STAFF_ENROLL_SECRET || process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("STAFF_ENROLL_SECRET_MISSING");
  }
  return "relife-dev-staff-enroll-secret";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function signaturesMatch(payload: string, signature: string): boolean {
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function createStaffEnrollmentToken(
  staffId: string,
  passkeyCount: number,
  scope?: TenantScope | null,
): string {
  const organizationId = scope?.organizationId?.trim() || "";
  const clinicId = scope?.clinicId?.trim() || "";
  if (Boolean(organizationId) !== Boolean(clinicId)) {
    throw new Error("STAFF_ENROLLMENT_TENANT_SCOPE_INVALID");
  }
  const claims: StaffEnrollmentClaims = {
    version: 1,
    staffId: staffId.trim(),
    ...(organizationId && clinicId ? { organizationId, clinicId } : {}),
    passkeyCount: Math.max(0, Math.trunc(passkeyCount)),
    exp: Math.floor(Date.now() / 1000) + STAFF_ENROLL_MAX_AGE,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `v1.${payload}.${sign(payload)}`;
}

export function readStaffEnrollmentToken(
  token: string | undefined | null
): StaffEnrollmentClaims | null {
  if (!token) return null;
  const [version, payload, signature] = token.split(".");
  if (version !== "v1" || !payload || !signature) return null;
  if (!signaturesMatch(payload, signature)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<StaffEnrollmentClaims>;
    const exp = Number(parsed.exp);
    const passkeyCount = Number(parsed.passkeyCount);
    const organizationId = String(parsed.organizationId || "").trim();
    const clinicId = String(parsed.clinicId || "").trim();
    if (
      parsed.version !== 1 ||
      !parsed.staffId ||
      !Number.isFinite(exp) ||
      exp <= Math.floor(Date.now() / 1000) ||
      !Number.isInteger(passkeyCount) ||
      passkeyCount < 0 ||
      Boolean(organizationId) !== Boolean(clinicId)
    ) {
      return null;
    }
    return {
      version: 1,
      staffId: String(parsed.staffId).trim(),
      ...(organizationId && clinicId ? { organizationId, clinicId } : {}),
      passkeyCount,
      exp,
    };
  } catch {
    return null;
  }
}

export function enrollmentCookieMaxAge(claims: StaffEnrollmentClaims): number {
  return Math.max(1, claims.exp - Math.floor(Date.now() / 1000));
}
