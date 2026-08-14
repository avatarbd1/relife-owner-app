import crypto from "crypto";

export const SESSION_COOKIE = "relife_owner_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Fallback so local `npm run dev` still works out of the box.
    // Set SESSION_SECRET in your real deployment env.
    return "relife-dev-secret-change-me";
  }
  return secret;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

/** Build a signed session token: `<expiryEpochSeconds>.<hmacSignature>` */
export function createSessionToken(): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = String(exp);
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const valid =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!valid) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp)) return false;
  return exp > Math.floor(Date.now() / 1000);
}

export function checkOwnerPin(pin: string): boolean {
  const expected = process.env.OWNER_PIN || "1234";
  if (pin.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(expected));
}

export const SESSION_MAX_AGE = SESSION_MAX_AGE_SECONDS;
