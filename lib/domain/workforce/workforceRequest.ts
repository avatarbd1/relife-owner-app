const WORKFORCE_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Same shape as sessionRequestMarker (lib/domain/clinical/sessionRequest.ts)
 * and the WEBREQ/DENTALREQ request-id patterns already proven in
 * lib/domain/finance/salary.ts and lib/webos/dentalClinical.ts. Staff_Shifts
 * and Leave_Requests carry a dedicated Request_ID column (per issue #153),
 * so no marker-in-text encoding is needed here — only ID validation.
 */
export function validateWorkforceRequestId(value: unknown): string {
  const requestId = String(value ?? "").trim();
  if (!WORKFORCE_REQUEST_ID.test(requestId)) {
    throw new Error("WORKFORCE_REQUEST_ID_INVALID");
  }
  return requestId;
}

export interface WorkforceRequestLedgerEntry {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  requestId: string;
  status: string;
}

function normalizedHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function column(headers: string[], name: string): number {
  const needle = normalizedHeader(name);
  return headers.findIndex((header) => normalizedHeader(header) === needle);
}

/**
 * Request_ID on a domain row is the immutable create-request marker. Later
 * transition request IDs live in the atomic 20_Data_Audit row so a retry is
 * still recognizable even after another valid transition has happened.
 */
export function workforceRequestLedger(
  headers: string[],
  rows: string[][]
): WorkforceRequestLedgerEntry[] {
  const actionIndex = column(headers, "Action");
  const entityTypeIndex = column(headers, "Entity_Type");
  const entityIdIndex = column(headers, "Entity_ID");
  const actorIdIndex = column(headers, "Actor_ID");
  const afterValueIndex = column(headers, "After_Value");
  if ([actionIndex, entityTypeIndex, entityIdIndex, actorIdIndex, afterValueIndex].some((index) => index < 0)) {
    throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  }

  return rows.flatMap((row) => {
    const action = String(row[actionIndex] ?? "").trim();
    const isWorkforceAction = action.startsWith("shift.") || action.startsWith("leave.");
    const raw = String(row[afterValueIndex] ?? "").trim();
    if (!raw) {
      if (isWorkforceAction) throw new Error("WORKFORCE_DATA_INVALID");
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const requestId = String(parsed.requestId ?? "").trim();
      if (!requestId) {
        if (isWorkforceAction) throw new Error("WORKFORCE_DATA_INVALID");
        return [];
      }
      validateWorkforceRequestId(requestId);
      return [{
        action,
        entityType: String(row[entityTypeIndex] ?? "").trim(),
        entityId: String(row[entityIdIndex] ?? "").trim(),
        actorId: String(row[actorIdIndex] ?? "").trim(),
        requestId,
        status: String(parsed.status ?? "").trim(),
      }];
    } catch {
      // Older non-workforce audit payloads may not be JSON. They cannot be a
      // workforce request marker and are ignored without weakening new writes.
      if (isWorkforceAction) throw new Error("WORKFORCE_DATA_INVALID");
      return [];
    }
  });
}

export function findWorkforceRequest(
  entries: WorkforceRequestLedgerEntry[],
  requestId: string
): WorkforceRequestLedgerEntry | null {
  const matches = entries.filter((entry) => entry.requestId === requestId);
  if (matches.length > 1) throw new Error("WORKFORCE_DATA_INVALID");
  return matches[0] ?? null;
}
