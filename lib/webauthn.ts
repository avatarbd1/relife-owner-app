import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  appendSheetValues,
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
} from "@/lib/data/googleSheets";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import type { WebStaffIdentity } from "@/lib/webos/staffDirectory";

export const WEBAUTHN_CHALLENGE_COOKIE = "relife_webauthn_challenge";
export const WEBAUTHN_CHALLENGE_MAX_AGE = 5 * 60;
const PASSKEY_SHEET = "WebAuthn_Credentials";
const RP_NAME = "Relife Clinic";

type ChallengeType = "register" | "authenticate";

type ChallengeState = {
  v: 1;
  type: ChallengeType;
  challenge: string;
  staffId?: string;
  exp: number;
};

export type PasskeyMetadata = {
  credentialId: string;
  displayName: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string;
};

type StoredPasskey = PasskeyMetadata & {
  rowNumber: number;
  staffId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  status: string;
  webauthnUserId: string;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => normalized(header) === name.toLowerCase());
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function numberValue(value: unknown): number {
  const parsed = Number(normalize(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function booleanValue(value: unknown): boolean {
  return ["true", "1", "yes"].includes(normalized(value));
}

function rowForHeaders(
  headers: string[],
  values: Record<string, string | number | boolean>
): Array<string | number | boolean> {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function safeTransports(value: string): AuthenticatorTransportFuture[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AuthenticatorTransportFuture =>
      typeof item === "string"
    );
  } catch {
    return [];
  }
}

function authSecret(): string {
  return process.env.SESSION_SECRET || "relife-dev-secret-change-me";
}

function signState(payload: string): string {
  return createHmac("sha256", `${authSecret()}:webauthn`).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createChallengeState(
  type: ChallengeType,
  challenge: string,
  staffId?: string
): string {
  const state: ChallengeState = {
    v: 1,
    type,
    challenge,
    staffId: staffId?.trim() || undefined,
    exp: Math.floor(Date.now() / 1000) + WEBAUTHN_CHALLENGE_MAX_AGE,
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signState(payload)}`;
}

export function readChallengeState(
  token: string | undefined | null,
  expectedType: ChallengeType
): ChallengeState | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !constantTimeEqual(signState(payload), signature)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ChallengeState>;
    if (
      state.v !== 1 ||
      state.type !== expectedType ||
      !state.challenge ||
      !Number.isFinite(state.exp) ||
      Number(state.exp) <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      v: 1,
      type: expectedType,
      challenge: String(state.challenge),
      staffId: state.staffId ? String(state.staffId) : undefined,
      exp: Number(state.exp),
    };
  } catch {
    return null;
  }
}

export function webauthnConfig(): { rpID: string; origin: string } {
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN?.trim().replace(/\/$/, "");
  const origin =
    configuredOrigin ||
    (process.env.NODE_ENV === "production"
      ? "https://relife-owner-app.onrender.com"
      : "http://localhost:3000");
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    throw new Error("WEBAUTHN_ORIGIN_INVALID");
  }
  return {
    rpID: process.env.WEBAUTHN_RP_ID?.trim() || hostname,
    origin,
  };
}

function webauthnUserId(staffId: string): { bytes: Uint8Array<ArrayBuffer>; encoded: string } {
  const digest = createHash("sha256")
    .update(`relife-webauthn-user:${staffId.trim()}`)
    .digest();
  const bytes = new Uint8Array(Array.from(digest));
  return { bytes, encoded: Buffer.from(bytes).toString("base64url") };
}

async function readStoredPasskeys(): Promise<StoredPasskey[]> {
  const snapshot = await fetchSheetRanges("physio", [PASSKEY_SHEET]);
  const rows = snapshot[PASSKEY_SHEET] || [];
  if (rows.length < 1) throw new Error("WEBAUTHN_SCHEMA_MISSING");
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  const required = [
    "Credential_ID",
    "Staff_ID",
    "Public_Key",
    "Counter",
    "Status",
    "WebAuthn_User_ID",
  ];
  if (required.some((name) => idx(name) < 0)) throw new Error("WEBAUTHN_SCHEMA_MISMATCH");

  return rows.slice(1).flatMap((row, offset) => {
    const credentialId = at(row, idx("Credential_ID"));
    const staffId = at(row, idx("Staff_ID"));
    const publicKey = at(row, idx("Public_Key"));
    if (!credentialId || !staffId || !publicKey) return [];
    return [{
      rowNumber: offset + 2,
      credentialId,
      staffId,
      publicKey,
      counter: numberValue(at(row, idx("Counter"))),
      transports: safeTransports(at(row, idx("Transports_JSON"))),
      deviceType: at(row, idx("Device_Type")),
      backedUp: booleanValue(at(row, idx("Backed_Up"))),
      createdAt: at(row, idx("Created_At")),
      lastUsedAt: at(row, idx("Last_Used_At")),
      displayName: at(row, idx("Display_Name")) || "This device",
      status: at(row, idx("Status")) || "Active",
      webauthnUserId: at(row, idx("WebAuthn_User_ID")),
    }];
  });
}

function isActive(passkey: StoredPasskey): boolean {
  return normalized(passkey.status) === "active";
}

export async function listPasskeysForStaff(staffId: string): Promise<PasskeyMetadata[]> {
  return (await readStoredPasskeys())
    .filter((item) => item.staffId === staffId.trim() && isActive(item))
    .map(({ credentialId, displayName, deviceType, backedUp, createdAt, lastUsedAt }) => ({
      credentialId,
      displayName,
      deviceType,
      backedUp,
      createdAt,
      lastUsedAt,
    }));
}

export async function hasAnyActivePasskeys(): Promise<boolean> {
  return (await readStoredPasskeys()).some(isActive);
}

async function getActivePasskeyById(credentialId: string): Promise<StoredPasskey | null> {
  return (
    (await readStoredPasskeys()).find(
      (item) => item.credentialId === credentialId && isActive(item)
    ) || null
  );
}

async function passkeySheetId(): Promise<number> {
  const property = (await getSheetProperties("physio")).find((item) => item.title === PASSKEY_SHEET);
  if (!property) throw new Error("WEBAUTHN_SCHEMA_MISSING");
  return property.sheetId;
}

function cellValue(value: string | number | boolean) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value } };
}

async function updatePasskeyUsage(passkey: StoredPasskey, counter: number): Promise<void> {
  const sheetId = await passkeySheetId();
  const now = new Date().toISOString();
  await batchUpdateSpreadsheet("physio", [
    {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: passkey.rowNumber - 1,
          endRowIndex: passkey.rowNumber,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        rows: [{ values: [cellValue(counter)] }],
        fields: "userEnteredValue",
      },
    },
    {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: passkey.rowNumber - 1,
          endRowIndex: passkey.rowNumber,
          startColumnIndex: 8,
          endColumnIndex: 9,
        },
        rows: [{ values: [cellValue(now)] }],
        fields: "userEnteredValue",
      },
    },
  ]);
}

export async function revokePasskey(staffId: string, credentialId: string): Promise<void> {
  const passkey = (await readStoredPasskeys()).find(
    (item) => item.staffId === staffId.trim() && item.credentialId === credentialId && isActive(item)
  );
  if (!passkey) throw new Error("PASSKEY_NOT_FOUND");
  const sheetId = await passkeySheetId();
  await batchUpdateSpreadsheet("physio", [
    {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: passkey.rowNumber - 1,
          endRowIndex: passkey.rowNumber,
          startColumnIndex: 10,
          endColumnIndex: 11,
        },
        rows: [{ values: [cellValue("Revoked")] }],
        fields: "userEnteredValue",
      },
    },
  ]);
}

export async function beginPasskeyRegistration(
  staffId: string,
  fullName: string,
  authorizedIdentity?: WebStaffIdentity,
): Promise<{ options: Awaited<ReturnType<typeof generateRegistrationOptions>>; stateToken: string }> {
  const activeStaff = authorizedIdentity?.staffId === staffId && authorizedIdentity.status === "Active"
    ? authorizedIdentity
    : await getActiveWebStaffById(staffId);
  if (!activeStaff) throw new Error("STAFF_NOT_FOUND");
  const existing = (await readStoredPasskeys()).filter(
    (item) => item.staffId === staffId && isActive(item)
  );
  const { rpID } = webauthnConfig();
  const user = webauthnUserId(staffId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: user.bytes,
    userName: staffId,
    userDisplayName: fullName || staffId,
    timeout: WEBAUTHN_CHALLENGE_MAX_AGE * 1000,
    attestationType: "none",
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
  });
  return {
    options,
    stateToken: createChallengeState("register", options.challenge, staffId),
  };
}

export async function finishPasskeyRegistration(
  staffId: string,
  state: ChallengeState,
  response: RegistrationResponseJSON,
  displayNameInput?: string,
  authorizedIdentity?: WebStaffIdentity,
): Promise<PasskeyMetadata> {
  if (state.type !== "register" || state.staffId !== staffId) throw new Error("WEBAUTHN_CHALLENGE_INVALID");
  const activeStaff = authorizedIdentity?.staffId === staffId && authorizedIdentity.status === "Active"
    ? authorizedIdentity
    : await getActiveWebStaffById(staffId);
  if (!activeStaff) throw new Error("STAFF_NOT_FOUND");
  const { rpID, origin } = webauthnConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: state.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("WEBAUTHN_REGISTRATION_FAILED");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const duplicate = (await readStoredPasskeys()).find((item) => item.credentialId === credential.id);
  if (duplicate) throw new Error("PASSKEY_ALREADY_REGISTERED");

  const snapshot = await fetchSheetRanges("physio", [PASSKEY_SHEET]);
  const rows = snapshot[PASSKEY_SHEET] || [];
  if (rows.length < 1) throw new Error("WEBAUTHN_SCHEMA_MISSING");
  const headers = rows[0];
  const createdAt = new Date().toISOString();
  const displayName = normalize(displayNameInput).slice(0, 80) || "Fingerprint / Face ID";
  const user = webauthnUserId(staffId);
  await appendSheetValues("physio", `'${PASSKEY_SHEET}'!A:L`, [
    rowForHeaders(headers, {
      Credential_ID: credential.id,
      Staff_ID: staffId,
      Public_Key: Buffer.from(credential.publicKey).toString("base64url"),
      Counter: credential.counter,
      Transports_JSON: JSON.stringify(credential.transports || []),
      Device_Type: credentialDeviceType,
      Backed_Up: credentialBackedUp,
      Created_At: createdAt,
      Last_Used_At: "",
      Display_Name: displayName,
      Status: "Active",
      WebAuthn_User_ID: user.encoded,
    }),
  ]);

  return {
    credentialId: credential.id,
    displayName,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    createdAt,
    lastUsedAt: "",
  };
}

export async function beginPasskeyAuthentication(): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  stateToken: string;
}> {
  if (!(await hasAnyActivePasskeys())) throw new Error("NO_PASSKEYS_REGISTERED");
  const { rpID } = webauthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: WEBAUTHN_CHALLENGE_MAX_AGE * 1000,
    userVerification: "required",
  });
  return {
    options,
    stateToken: createChallengeState("authenticate", options.challenge),
  };
}

export async function finishPasskeyAuthentication(
  state: ChallengeState,
  response: AuthenticationResponseJSON
): Promise<{ staffId: string }> {
  if (state.type !== "authenticate") throw new Error("WEBAUTHN_CHALLENGE_INVALID");
  const passkey = await getActivePasskeyById(response.id);
  if (!passkey) throw new Error("PASSKEY_NOT_FOUND");
  if (
    response.response.userHandle &&
    passkey.webauthnUserId &&
    response.response.userHandle !== passkey.webauthnUserId
  ) {
    throw new Error("PASSKEY_USER_MISMATCH");
  }
  const activeStaff = await getActiveWebStaffById(passkey.staffId);
  if (!activeStaff) throw new Error("STAFF_NOT_FOUND");
  const { rpID, origin } = webauthnConfig();
  const credential: WebAuthnCredential = {
    id: passkey.credentialId,
    publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
    counter: passkey.counter,
    transports: passkey.transports,
  };
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: state.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential,
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error("WEBAUTHN_AUTHENTICATION_FAILED");
  await updatePasskeyUsage(passkey, verification.authenticationInfo.newCounter);
  return { staffId: passkey.staffId };
}

export function createPasskeyAuditId(): string {
  return `WAA-${randomUUID()}`;
}
