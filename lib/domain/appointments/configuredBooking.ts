import type { OperatingHourConfiguration } from "../tenancy/configurationCore.ts";
import { assertTenantOwned, scopeToTenant, validateBookingConfig, type ClinicBookingConfig, type ClinicResource } from "../tenancy/clinicConfiguration.ts";
import { requireTenantScope, type TenantScope } from "../tenancy/policy.ts";

export interface ConfiguredBookingRequest {
  date: string;
  startMinute: number;
  patientId: string;
  providerId?: string;
  resourceCode?: string;
  gender?: "Male" | "Female" | "";
}

export interface ExistingConfiguredBooking extends TenantScope {
  patientId: string;
  date: string;
  startMinute: number;
  durationMin: number;
  resourceCode: string | null;
  active: boolean;
}

export type ConfiguredBookingDecision =
  | { ok: true; durationMin: number; resource: ClinicResource | null }
  | { ok: false; reason: "not_configured" | "invalid" | "capacity" | "duplicate" | "resource_unavailable"; detail: string };

function overlaps(a: number, durationA: number, b: number, durationB: number) {
  return a < b + durationB && a + durationA > b;
}

function weekday(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function resolveConfiguredBooking(scope: TenantScope, configuration: { booking: ClinicBookingConfig | null; hours: readonly OperatingHourConfiguration[]; resources: readonly ClinicResource[] }, request: ConfiguredBookingRequest, existing: readonly ExistingConfiguredBooking[]): ConfiguredBookingDecision {
  const tenant = requireTenantScope(scope);
  if (!configuration.booking) return { ok: false, reason: "not_configured", detail: "booking configuration missing" };
  try { assertTenantOwned(tenant, configuration.booking, "booking.resolve"); } catch { return { ok: false, reason: "invalid", detail: "booking configuration tenant mismatch" }; }
  const validation = validateBookingConfig(configuration.booking);
  if (!validation.valid) return { ok: false, reason: "invalid", detail: validation.problems.join("; ") };
  if (configuration.hours.some((row) => row.organizationId !== tenant.organizationId || row.clinicId !== tenant.clinicId)) return { ok: false, reason: "invalid", detail: "operating hours tenant mismatch" };
  const hour = configuration.hours.find((row) => row.dayOfWeek === weekday(request.date));
  const toMinute = (value: string | null) => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : -1;
  const durationMin = configuration.booking.defaultDurationMin;
  if (!hour?.isOpen || request.startMinute < toMinute(hour.opensAt) || request.startMinute + durationMin > toMinute(hour.closesAt)) return { ok: false, reason: "invalid", detail: "slot is outside configured operating hours" };
  if (request.startMinute % configuration.booking.slotIntervalMin !== 0) return { ok: false, reason: "invalid", detail: "slot does not match configured interval" };
  if (configuration.booking.providerRequired && !request.providerId?.trim()) return { ok: false, reason: "invalid", detail: "provider is required" };
  const active = scopeToTenant(tenant, existing).filter((row) => row.active && row.date === request.date && overlaps(request.startMinute, durationMin, row.startMinute, row.durationMin));
  if (configuration.booking.blockDuplicatePatientOverlap && active.some((row) => row.patientId === request.patientId)) return { ok: false, reason: "duplicate", detail: "patient already has an overlapping booking" };
  if (configuration.booking.bookingMode === "simple") return { ok: true, durationMin, resource: null };
  if (configuration.booking.bookingMode === "capacity") return active.length >= (configuration.booking.maxSimultaneous || 0) ? { ok: false, reason: "capacity", detail: "configured simultaneous capacity is full" } : { ok: true, durationMin, resource: null };
  const resources = scopeToTenant(tenant, configuration.resources).filter((row) => row.isActive && row.isBookable && !row.isRuntimeOnly);
  const selected = resources.find((row) => row.resourceCode === request.resourceCode);
  if (!selected) return { ok: false, reason: "resource_unavailable", detail: "configured resource is required and unavailable" };
  if (selected.genderRestriction && selected.genderRestriction !== request.gender) return { ok: false, reason: "resource_unavailable", detail: "resource restriction does not match patient" };
  const used = active.filter((row) => row.resourceCode === selected.resourceCode).length;
  return used >= selected.capacity ? { ok: false, reason: "resource_unavailable", detail: "configured resource capacity is full" } : { ok: true, durationMin, resource: selected };
}
