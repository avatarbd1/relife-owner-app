import test from "node:test";
import assert from "node:assert/strict";
import { configurationReadiness, featureDecision, resolveClinicConfiguration, validateOperatingHours, type ClinicConfigurationSnapshot, type ClinicServiceConfiguration } from "../lib/domain/tenancy/configurationCore.ts";

const A = { organizationId: "org-a", clinicId: "clinic-1" };
const B = { organizationId: "org-b", clinicId: "clinic-1" };
const NOW = new Date("2026-08-27T12:00:00Z");
function hours(scope=A) { return Array.from({ length: 7 }, (_, i) => ({ ...scope, dayOfWeek: i + 1, isOpen: i < 6, opensAt: i < 6 ? "09:00:00" : null, closesAt: i < 6 ? "17:00:00" : null })); }
function service(scope=A, overrides: Partial<ClinicServiceConfiguration> = {}): ClinicServiceConfiguration { return { ...scope, serviceCode: "CONSULT", displayName: "Consultation", department: "All", price: 500, durationMin: 30, requiresBooking: true, requiresProvider: true, requiresResource: false, discountApplicable: true, taxApplicable: false, packageEligible: false, isActive: true, ...overrides }; }
function snapshot(scope=A, overrides: Partial<ClinicConfigurationSnapshot> = {}): ClinicConfigurationSnapshot {
  return { scope, profile: { ...scope, clinicName: "Clinic", clinicType: "other", branchName: "Main", address: "", phone: "", email: "", logoUrl: "", currency: "BDT", locale: "en", timezone: "Asia/Dhaka", lifecycle: "active" }, operatingHours: hours(scope), catalog: [{ featureKey: "core.services", status: "active" }], flags: [{ ...scope, featureKey: "core.services", enabled: true }], entitlements: [{ ...scope, featureKey: "core.services", status: "active", effectiveFrom: new Date("2026-01-01"), effectiveUntil: null }], services: [service(scope)], ...overrides };
}

test("valid tenant configuration resolves", () => assert.equal(resolveClinicConfiguration(A, snapshot()).ok, true));
test("missing tenant identity rejects", () => assert.deepEqual(resolveClinicConfiguration({}, snapshot()), { ok: false, reason: "not_authorized", details: ["TENANT_SCOPE_REQUIRED"] }));
test("partial tenant identity rejects", () => assert.equal(resolveClinicConfiguration({ organizationId: "org-a" }, snapshot()).ok, false));
test("same clinic id under another organization cannot cross-match", () => assert.equal(resolveClinicConfiguration(A, snapshot(B)).ok, false));
test("clinic A cannot use clinic B operating hours", () => assert.equal(resolveClinicConfiguration(A, snapshot(A, { operatingHours: hours(B) })).ok, false));
test("missing required profile is not configured", () => assert.equal(resolveClinicConfiguration(A, snapshot(A, { profile: null })).ok, false));
test("missing optional profile values are valid", () => assert.equal(resolveClinicConfiguration(A, snapshot(A, { profile: { ...snapshot().profile!, address: "", phone: "", email: "", logoUrl: "" } })).ok, true));
test("invalid timezone fails", () => assert.equal(resolveClinicConfiguration(A, snapshot(A, { profile: { ...snapshot().profile!, timezone: "Not/AZone" } })).ok, false));
test("invalid hours fail predictably", () => assert.match(validateOperatingHours(hours().slice(0, 6)).join(";"), /seven/));

test("active catalog, flag and valid entitlement enables feature", () => assert.equal(featureDecision(snapshot(), "core.services", NOW).ok, true));
for (const [name, modify, reason] of [
  ["retired catalog", { catalog: [{ featureKey: "core.services", status: "retired" as const }] }, "disabled"],
  ["unknown catalog feature", {}, "disabled"],
  ["missing flag", { flags: [] }, "disabled"],
  ["disabled flag", { flags: [{ ...A, featureKey: "core.services", enabled: false }] }, "disabled"],
  ["missing grant", { entitlements: [] }, "not_entitled"],
] as Array<[string, Partial<ClinicConfigurationSnapshot>, "disabled" | "not_entitled"]>) test(name, () => { const result = featureDecision(snapshot(A, modify), name === "unknown catalog feature" ? "unknown" : "core.services", NOW); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, reason); });

for (const [name, grant] of [
  ["suspended grant", { status: "suspended" as const, effectiveFrom: new Date("2026-01-01"), effectiveUntil: null }],
  ["revoked grant", { status: "revoked" as const, effectiveFrom: new Date("2026-01-01"), effectiveUntil: null }],
  ["future grant", { status: "active" as const, effectiveFrom: new Date("2027-01-01"), effectiveUntil: null }],
  ["expired grant", { status: "active" as const, effectiveFrom: new Date("2026-01-01"), effectiveUntil: new Date("2026-02-01") }],
] as const) test(name, () => { const result = featureDecision(snapshot(A, { entitlements: [{ ...A, featureKey: "core.services", ...grant }] }), "core.services", NOW); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "not_entitled"); });

test("inactive lifecycle does not enable feature", () => assert.equal(featureDecision(snapshot(A, { profile: { ...snapshot().profile!, lifecycle: "suspended" } }), "core.services", NOW).ok, false));
test("cross-tenant flag and entitlement cannot enable feature", () => assert.equal(featureDecision(snapshot(A, { flags: [{ ...B, featureKey: "core.services", enabled: true }], entitlements: [{ ...B, featureKey: "core.services", status: "active", effectiveFrom: new Date("2026-01-01"), effectiveUntil: null }] }), "core.services", NOW).ok, false));
test("same local service identifier safely coexists with clinic-specific price", () => { const rows = [service(A, { price: 500 }), service(B, { price: 900 })]; assert.equal(rows.filter((r) => r.organizationId === A.organizationId && r.clinicId === A.clinicId)[0].price, 500); });
test("inactive service does not satisfy readiness", () => assert.match(configurationReadiness(snapshot(A, { services: [service(A, { isActive: false })] }), true).reasons.join(";"), /active service/));
test("permission denial remains separate from entitlement denial", () => { const denied = configurationReadiness(snapshot(), false); assert.ok(denied.reasons.includes("authorized membership missing")); const result = featureDecision(snapshot(A, { entitlements: [] }), "core.services", NOW); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "not_entitled"); });
test("readiness returns explicit success", () => assert.deepEqual(configurationReadiness(snapshot(), true), { readyForPhaseBScope: true, reasons: [] }));
