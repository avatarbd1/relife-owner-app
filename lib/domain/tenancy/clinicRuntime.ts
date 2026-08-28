import type { ClinicProfileConfiguration } from "./configurationCore.ts";
import type { Scope } from "../../types.ts";
import type { AccessContext } from "../../webos/access.ts";
import { allowedScopesForContext, parseScope } from "../../webos/scope.ts";

export type ClinicRuntimeDepartment = "Physio" | "Dental";

export function clinicRuntimeDepartments(
  clinicType: ClinicProfileConfiguration["clinicType"] | undefined,
): ClinicRuntimeDepartment[] {
  if (clinicType === "physiotherapy") return ["Physio"];
  if (clinicType === "dental") return ["Dental"];
  return [];
}

export function clinicRuntimeScopes(
  context: AccessContext,
  departments: readonly ClinicRuntimeDepartment[],
): Scope[] {
  const authorized = new Set(allowedScopesForContext(context));
  if (departments.length === 1) {
    const only = departments[0] === "Physio" ? "physio" : "dental";
    return authorized.has(only) || authorized.has("combined") ? [only] : [];
  }
  return allowedScopesForContext(context);
}

export function resolveClinicRuntimeScope(
  allowed: readonly Scope[],
  requested: unknown,
): Scope {
  const parsed = parseScope(requested);
  if (parsed && allowed.includes(parsed)) return parsed;
  if (allowed.includes("combined")) return "combined";
  if (allowed[0]) return allowed[0];
  throw new Error("ACCESS_DENIED");
}
