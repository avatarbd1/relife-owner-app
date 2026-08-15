import "server-only";
import { createSign } from "node:crypto";

export type Workbook = "physio" | "dental";

const PHYSIO_SHEET_ID =
  process.env.PHYSIO_GOOGLE_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  "1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0";

const DENTAL_SHEET_ID =
  process.env.DENTAL_GOOGLE_SHEET_ID ||
  "1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso";

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

const SHEET_READ_CACHE_TTL_MS = 4_000;
const SHEET_READ_MAX_RETRIES = 3;
const RETRYABLE_READ_STATUS = new Set([429, 500, 502, 503, 504]);

type RangeCacheEntry = { expiresAt: number; rows: string[][] };
const rangeReadCache = new Map<string, RangeCacheEntry>();
const rangeReadInFlight = new Map<string, Promise<string[][]>>();

function rangeCacheKey(workbook: Workbook, range: string): string {
  return `${workbook}:${range}`;
}

function invalidateWorkbookReadCache(workbook: Workbook): void {
  const prefix = `${workbook}:`;
  for (const key of rangeReadCache.keys()) {
    if (key.startsWith(prefix)) rangeReadCache.delete(key);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(5_000, retryAfter * 1_000);
  }
  return Math.min(2_000, 250 * 2 ** attempt);
}

function loadCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
          token_uri: parsed.token_uri,
        };
      }
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) return null;
  return {
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, "\n"),
  };
}

export function hasPrivateSheetsCredentials(): boolean {
  return loadCredentials() !== null;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error(
      "Google service-account credentials are not configured for private Sheets access"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error("Google OAuth token response did not contain access_token");
  }

  const expiresIn = Math.max(120, payload.expires_in || 3600);
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };
  return payload.access_token;
}

function sheetIdFor(workbook: Workbook): string {
  return workbook === "dental" ? DENTAL_SHEET_ID : PHYSIO_SHEET_ID;
}

async function fetchUncachedSheetRanges(
  workbook: Workbook,
  ranges: string[]
): Promise<Record<string, string[][]>> {
  const token = await getAccessToken();
  const sheetId = sheetIdFor(workbook);
  const params = new URLSearchParams();
  for (const range of ranges) params.append("ranges", `'${range}'`);
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "FORMATTED_VALUE");

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    sheetId
  )}/values:batchGet?${params.toString()}`;

  for (let attempt = 0; attempt <= SHEET_READ_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        valueRanges?: Array<{ range?: string; values?: unknown[][] }>;
      };
      const result: Record<string, string[][]> = {};
      ranges.forEach((name, index) => {
        const values = payload.valueRanges?.[index]?.values || [];
        result[name] = values.map((row) =>
          row.map((cell) => String(cell ?? ""))
        );
      });
      return result;
    }

    if (
      !RETRYABLE_READ_STATUS.has(response.status) ||
      attempt >= SHEET_READ_MAX_RETRIES
    ) {
      throw new Error(
        `Google Sheets batch read failed for ${workbook}: HTTP ${response.status}`
      );
    }

    await sleep(retryDelayMs(response, attempt));
  }

  throw new Error(`Google Sheets batch read failed for ${workbook}`);
}

export async function fetchSheetRanges(
  workbook: Workbook,
  ranges: string[]
): Promise<Record<string, string[][]>> {
  const result: Record<string, string[][]> = {};
  const waiters: Array<{ name: string; promise: Promise<string[][]> }> = [];
  const missing: string[] = [];
  const now = Date.now();

  for (const name of ranges) {
    const key = rangeCacheKey(workbook, name);
    const cached = rangeReadCache.get(key);
    if (cached && cached.expiresAt > now) {
      result[name] = cached.rows;
      continue;
    }
    if (cached) rangeReadCache.delete(key);

    const inFlight = rangeReadInFlight.get(key);
    if (inFlight) {
      waiters.push({ name, promise: inFlight });
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    const batchPromise = fetchUncachedSheetRanges(workbook, missing);
    for (const name of missing) {
      const key = rangeCacheKey(workbook, name);
      let rangePromise: Promise<string[][]>;
      rangePromise = batchPromise
        .then((snapshot) => {
          const rows = snapshot[name] || [];
          rangeReadCache.set(key, {
            expiresAt: Date.now() + SHEET_READ_CACHE_TTL_MS,
            rows,
          });
          return rows;
        })
        .finally(() => {
          if (rangeReadInFlight.get(key) === rangePromise) {
            rangeReadInFlight.delete(key);
          }
        });
      rangeReadInFlight.set(key, rangePromise);
      waiters.push({ name, promise: rangePromise });
    }
  }

  const resolved = await Promise.all(
    waiters.map(async ({ name, promise }) => ({ name, rows: await promise }))
  );
  for (const { name, rows } of resolved) result[name] = rows;

  for (const name of ranges) {
    if (!(name in result)) result[name] = [];
  }
  return result;
}

export async function updateSheetValues(
  workbook: Workbook,
  range: string,
  values: Array<Array<string | number | boolean>>
): Promise<void> {
  const token = await getAccessToken();
  const sheetId = sheetIdFor(workbook);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      sheetId
    )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets update failed for ${workbook}: HTTP ${response.status}`
    );
  }
  invalidateWorkbookReadCache(workbook);
}

export async function appendSheetValues(
  workbook: Workbook,
  range: string,
  values: Array<Array<string | number | boolean>>
): Promise<void> {
  const token = await getAccessToken();
  const sheetId = sheetIdFor(workbook);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      sheetId
    )}/values/${encodeURIComponent(
      range
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets append failed for ${workbook}: HTTP ${response.status}`
    );
  }
  invalidateWorkbookReadCache(workbook);
}

export type SpreadsheetBatchRequest = Record<string, unknown>;

type SheetProperties = { sheetId: number; title: string };

let sheetPropertiesCache = new Map<
  Workbook,
  { createdAt: number; values: SheetProperties[] }
>();

export async function getSheetProperties(
  workbook: Workbook
): Promise<SheetProperties[]> {
  const cached = sheetPropertiesCache.get(workbook);
  if (cached && Date.now() - cached.createdAt < 5 * 60_000) {
    return cached.values;
  }

  const token = await getAccessToken();
  const spreadsheetId = sheetIdFor(workbook);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=sheets.properties(sheetId,title)`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets metadata read failed for ${workbook}: HTTP ${response.status}`
    );
  }
  const payload = (await response.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const values = (payload.sheets || []).flatMap((sheet) => {
    const id = sheet.properties?.sheetId;
    const title = sheet.properties?.title;
    return typeof id === "number" && title ? [{ sheetId: id, title }] : [];
  });
  sheetPropertiesCache.set(workbook, { createdAt: Date.now(), values });
  return values;
}

export async function batchUpdateSpreadsheet(
  workbook: Workbook,
  requests: SpreadsheetBatchRequest[]
): Promise<void> {
  if (requests.length === 0) return;
  const token = await getAccessToken();
  const spreadsheetId = sheetIdFor(workbook);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ requests, includeSpreadsheetInResponse: false }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Google Sheets batch update failed for ${workbook}: HTTP ${response.status}${
        detail ? ` ${detail.slice(0, 300)}` : ""
      }`
    );
  }
  invalidateWorkbookReadCache(workbook);
}
