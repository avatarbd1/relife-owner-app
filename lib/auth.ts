import crypto from "crypto";

export const SESSION_COOKIE = "relife_owner_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const OWNER_STAFF_ID = "ST001";

export interface SessionClaims {
  version: 2;
  exp: number;
  staffId: string;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (isProduction()) {
    throw new Error("SESSION_SECRET_NOT_CONFIGURED");
  }
  return "relife-dev-secret-change-me";
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

function signaturesMatch(payload: string, signature: string): boolean {
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

/**
 * Build a signed v2 staff session token.
 *
 * Only stable identity is stored in the cookie. Roles and department access are
 * intentionally resolved from the live staff directory on protected actions so
 * permission changes do not wait for a 30-day cookie to expire.
 */
export function createSessionToken(staffId: string = OWNER_STAFF_ID): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const claims: SessionClaims = {
    version: 2,
    exp,
    staffId: staffId.trim(),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `v2.${payload}.${sign(payload)}`;
}

function readV2SessionToken(token: string): SessionClaims | null {
  const [version, payload, signature] = token.split(".");
  if (version !== "v2" || !payload || !signature) return null;
  if (!signaturesMatch(payload, signature)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<SessionClaims>;
    if (
      parsed.version !== 2 ||
      !parsed.staffId ||
      !Number.isFinite(parsed.exp) ||
      Number(parsed.exp) <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      version: 2,
      exp: Number(parsed.exp),
      staffId: String(parsed.staffId).trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Legacy owner sessions were `<expiry>.<signature>`. Keep accepting them during
 * migration and resolve them explicitly to ST001 so an existing installed PWA
 * is not logged out by the W1 rollout.
 */
function readLegacyOwnerSession(token: string): SessionClaims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || token.split(".").length !== 2) return null;
  if (!signaturesMatch(payload, signature)) return null;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  return { version: 2, exp, staffId: OWNER_STAFF_ID };
}

export function readSessionClaims(
  token: string | undefined | null
): SessionClaims | null {
  if (!token) return null;
  return readV2SessionToken(token) || readLegacyOwnerSession(token);
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return readSessionClaims(token) !== null;
}

export function getSessionStaffId(
  token: string | undefined | null
): string | null {
  return readSessionClaims(token)?.staffId || null;
}

export function checkOwnerPin(pin: string): boolean {
  const expected = process.env.OWNER_PIN?.trim();
  if (!expected) {
    if (isProduction()) return false;
    return pin === "1234";
  }
  if (pin.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(expected));
}

export const SESSION_MAX_AGE = SESSION_MAX_AGE_SECONDS;
