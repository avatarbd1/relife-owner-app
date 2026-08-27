import type { Scope } from "@/lib/types";
import type { AccessContext } from "@/lib/webos/access";

const KNOWN_SCOPES: Scope[] = ["combined", "physio", "dental"];

export function parseScope(value: unknown): Scope | null {
  const scope = String(value ?? "").trim() as Scope;
  return KNOWN_SCOPES.includes(scope) ? scope : null;
}

export function allowedScopesForContext(context: AccessContext): Scope[] {
  const access = new Set(context.departmentAccess);
  const all = access.has("All");
  const physio = all || access.has("Physio");
  const dental = all || access.has("Dental");

  if (physio && dental) return ["combined", "physio", "dental"];
  if (physio) return ["physio"];
  if (dental) return ["dental"];
  return [];
}

export function resolveAuthorizedScope(
  context: AccessContext,
  requested: unknown
): Scope {
  const allowed = allowedScopesForContext(context);
  if (allowed.length === 0) throw new Error("ACCESS_DENIED");

  const parsed = parseScope(requested);
  if (parsed && allowed.includes(parsed)) return parsed;
  if (allowed.includes("combined")) return "combined";
  return allowed[0];
}

export function isScopeAllowed(context: AccessContext, scope: Scope): boolean {
  return allowedScopesForContext(context).includes(scope);
}
