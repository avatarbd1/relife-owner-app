const SESSION_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

export function sessionRequestMarker(value: unknown): string {
  const requestId = String(value ?? "").trim();
  if (!SESSION_REQUEST_ID.test(requestId)) {
    throw new Error("SESSION_REQUEST_ID_INVALID");
  }
  return `SESSIONREQ:${requestId}`;
}

export function remarksEndWithSessionRequest(
  remarks: unknown,
  marker: string
): boolean {
  const segments = String(remarks ?? "")
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.at(-1) === marker;
}
