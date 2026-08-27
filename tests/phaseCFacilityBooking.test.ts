import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfiguredBooking, type ExistingConfiguredBooking } from "../lib/domain/appointments/configuredBooking.ts";
import type { ClinicBookingConfig, ClinicResource } from "../lib/domain/tenancy/clinicConfiguration.ts";
import type { OperatingHourConfiguration } from "../lib/domain/tenancy/configurationCore.ts";
import { createBulkFacilityPlan } from "../lib/domain/tenancy/facilityConfiguration.ts";

const A = { organizationId: "11111111-1111-4111-8111-111111111111", clinicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const B = { organizationId: "22222222-2222-4222-8222-222222222222", clinicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const DATE = "2026-08-31"; // Monday
const hours = (scope = A): OperatingHourConfiguration[] => Array.from({ length: 7 }, (_, index) => ({ ...scope, dayOfWeek: index + 1, isOpen: index < 5, opensAt: index < 5 ? "09:00:00" : null, closesAt: index < 5 ? "18:00:00" : null }));
const booking = (mode: ClinicBookingConfig["bookingMode"], scope = A, extra: Partial<ClinicBookingConfig> = {}): ClinicBookingConfig => ({ ...scope, bookingMode: mode, defaultDurationMin: 30, slotIntervalMin: 30, maxSimultaneous: mode === "capacity" ? 2 : null, providerRequired: false, resourceRequired: mode === "specific_resource", blockDuplicatePatientOverlap: true, allowWalkIn: true, cancellationNoticeMin: 0, lateArrivalGraceMin: 0, capacityRules: {}, ...extra });
const resource = (code: string, scope = A, extra: Partial<ClinicResource> = {}): ClinicResource => ({ ...scope, resourceCode: code, displayName: code, resourceType: "BED", roomCode: "ROOM-1", capacity: 1, genderRestriction: null, isBookable: true, isRuntimeOnly: false, isActive: true, ...extra });
const existing = (patientId: string, scope = A, extra: Partial<ExistingConfiguredBooking> = {}): ExistingConfiguredBooking => ({ ...scope, patientId, date: DATE, startMinute: 600, durationMin: 30, resourceCode: null, active: true, ...extra });
const request = { date: DATE, startMinute: 600, patientId: "P-NEW", providerId: "DR-1" };

test("simple booking needs no room or resource", () => assert.deepEqual(resolveConfiguredBooking(A, { booking: booking("simple"), hours: hours(), resources: [] }, request, []), { ok: true, durationMin: 30, resource: null }));
test("capacity booking uses the clinic ceiling", () => {
  assert.equal(resolveConfiguredBooking(A, { booking: booking("capacity"), hours: hours(), resources: [] }, request, [existing("P1")]).ok, true);
  assert.equal(resolveConfiguredBooking(A, { booking: booking("capacity"), hours: hours(), resources: [] }, request, [existing("P1"), existing("P2")]).ok, false);
});
test("one-room clinic may use its own resource", () => assert.equal(resolveConfiguredBooking(A, { booking: booking("specific_resource"), hours: hours(), resources: [resource("BED-A")] }, { ...request, resourceCode: "BED-A" }, []).ok, true));
test("six-room twelve-bed clinic resolves all configured resources", () => {
  const resources = Array.from({ length: 12 }, (_, index) => resource(`BED-${index + 1}`, A, { roomCode: `ROOM-${Math.floor(index / 2) + 1}` }));
  const result = resolveConfiguredBooking(A, { booking: booking("specific_resource"), hours: hours(), resources }, { ...request, resourceCode: "BED-12" }, []);
  assert.equal(result.ok && result.resource?.roomCode, "ROOM-6");
});
test("bulk facility creation expands six rooms into twelve tenant-scoped beds", () => {
  const plan = createBulkFacilityPlan(A, { roomCount: 6, resourcesPerRoom: 2, resourceType: "BED" });
  assert.equal(plan.rooms.length, 6);
  assert.equal(plan.resources.length, 12);
  assert.equal(plan.resources[11].roomCode, "ROOM-6");
  assert.ok(plan.resources.every((row) => row.organizationId === A.organizationId && row.clinicId === A.clinicId));
});
test("the same clinic-local resource code safely coexists across tenants", () => {
  const result = resolveConfiguredBooking(A, { booking: booking("specific_resource"), hours: hours(), resources: [resource("BED-1"), resource("BED-1", B)] }, { ...request, resourceCode: "BED-1" }, []);
  assert.equal(result.ok && result.resource?.organizationId, A.organizationId);
});
test("same clinic id under another organization cannot consume capacity", () => assert.equal(resolveConfiguredBooking(A, { booking: booking("capacity"), hours: hours(), resources: [] }, request, [existing("P1", B), existing("P2", B)]).ok, true));
test("foreign booking configuration fails closed", () => assert.deepEqual(resolveConfiguredBooking(A, { booking: booking("simple", B), hours: hours(), resources: [] }, request, []), { ok: false, reason: "invalid", detail: "booking configuration tenant mismatch" }));
test("foreign operating hours fail closed", () => assert.equal(resolveConfiguredBooking(A, { booking: booking("simple"), hours: hours(B), resources: [] }, request, []).ok, false));
test("missing booking configuration fails closed", () => assert.equal(resolveConfiguredBooking(A, { booking: null, hours: hours(), resources: [] }, request, []).ok, false));
test("closed and outside-hours slots fail predictably", () => {
  assert.equal(resolveConfiguredBooking(A, { booking: booking("simple"), hours: hours(), resources: [] }, { ...request, date: "2026-09-05" }, []).ok, false);
  assert.equal(resolveConfiguredBooking(A, { booking: booking("simple"), hours: hours(), resources: [] }, { ...request, startMinute: 500 }, []).ok, false);
});
test("configured slot interval is enforced", () => assert.equal(resolveConfiguredBooking(A, { booking: booking("simple"), hours: hours(), resources: [] }, { ...request, startMinute: 615 }, []).ok, false));
test("duplicate overlap policy is independent of capacity", () => assert.equal(resolveConfiguredBooking(A, { booking: booking("capacity", A, { maxSimultaneous: 5 }), hours: hours(), resources: [] }, request, [existing("P-NEW")]).ok, false));
test("provider requirement fails separately", () => assert.equal(resolveConfiguredBooking(A, { booking: booking("simple", A, { providerRequired: true }), hours: hours(), resources: [] }, { ...request, providerId: "" }, []).ok, false));
test("inactive and runtime-only resources cannot be booked", () => {
  assert.equal(resolveConfiguredBooking(A, { booking: booking("specific_resource"), hours: hours(), resources: [resource("BED-A", A, { isActive: false })] }, { ...request, resourceCode: "BED-A" }, []).ok, false);
  assert.equal(resolveConfiguredBooking(A, { booking: booking("specific_resource"), hours: hours(), resources: [resource("BED-A", A, { isRuntimeOnly: true })] }, { ...request, resourceCode: "BED-A" }, []).ok, false);
});
test("specific resource capacity and gender restriction are enforced", () => {
  const configured = { booking: booking("specific_resource"), hours: hours(), resources: [resource("BED-A", A, { genderRestriction: "Female" })] };
  assert.equal(resolveConfiguredBooking(A, configured, { ...request, resourceCode: "BED-A", gender: "Male" }, []).ok, false);
  assert.equal(resolveConfiguredBooking(A, configured, { ...request, resourceCode: "BED-A", gender: "Female" }, [existing("P1", A, { resourceCode: "BED-A" })]).ok, false);
});
test("missing and partial tenant identity reject", () => {
  assert.throws(() => resolveConfiguredBooking({ organizationId: "", clinicId: A.clinicId }, { booking: booking("simple"), hours: hours(), resources: [] }, request, []), /TENANT_SCOPE_REQUIRED/);
  assert.throws(() => resolveConfiguredBooking({ organizationId: A.organizationId, clinicId: "" }, { booking: booking("simple"), hours: hours(), resources: [] }, request, []), /TENANT_SCOPE_REQUIRED/);
});
