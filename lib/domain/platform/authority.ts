export function parsePlatformOwnerStaffIds(raw: unknown): string[] {
  return [...new Set(String(raw ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
}

export function isPlatformOwnerStaffId(staffId: unknown, allowlist: unknown): boolean {
  const candidate = String(staffId ?? "").trim();
  if (!candidate) return false;
  return parsePlatformOwnerStaffIds(allowlist).includes(candidate);
}
