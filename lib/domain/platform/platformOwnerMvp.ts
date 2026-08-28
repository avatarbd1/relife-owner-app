export const CORE_FEATURE_KEYS = [
  "core.dashboard",
  "core.patients",
  "core.appointments",
  "core.staff",
  "core.services",
  "core.finance_basic",
  "core.reports",
  "core.settings",
] as const;

export const PLATFORM_PLAN_CODES = ["starter", "standard", "premium"] as const;
export type PlatformPlanCode = (typeof PLATFORM_PLAN_CODES)[number];

export interface PlatformPlanDefinition {
  code: PlatformPlanCode;
  label: string;
  priceBdt: number;
  defaultFeatureKeys: readonly string[];
}

const STANDARD_OPTIONAL = [
  "optional.clinical_notes",
  "optional.treatment_plans",
  "optional.files",
  "optional.attendance",
  "optional.inventory",
  "optional.notifications",
] as const;

const PREMIUM_OPTIONAL = [
  ...STANDARD_OPTIONAL,
  "optional.live_chamber",
  "optional.room_bed_runtime",
  "optional.machines",
  "optional.gamification",
  "optional.rewards",
  "optional.finance_advanced",
  "optional.salary",
  "optional.live_chat",
  "optional.packages",
  "optional.sms",
  "optional.audit_viewer",
] as const;

export const PLATFORM_PLANS: Record<PlatformPlanCode, PlatformPlanDefinition> = {
  starter: { code: "starter", label: "Starter", priceBdt: 499, defaultFeatureKeys: CORE_FEATURE_KEYS },
  standard: { code: "standard", label: "Standard", priceBdt: 999, defaultFeatureKeys: [...CORE_FEATURE_KEYS, ...STANDARD_OPTIONAL] },
  premium: { code: "premium", label: "Premium", priceBdt: 1499, defaultFeatureKeys: [...CORE_FEATURE_KEYS, ...PREMIUM_OPTIONAL] },
};

export type ClinicType = "physiotherapy" | "dental" | "doctor_chamber" | "other";

export interface PlatformClinicProvisioningInput {
  organizationName: string;
  organizationSlug: string;
  clinicName: string;
  clinicSlug: string;
  clinicType: ClinicType;
  timezone: string;
  branchName?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
  locale?: string;
  ownerStaffId: string;
  planCode: PlatformPlanCode;
  trialDays: number;
  featureKeys?: string[];
  openDays?: number[];
  opensAt?: string;
  closesAt?: string;
  firstServiceName?: string;
  firstServiceCode?: string;
  firstServicePrice?: number;
  firstServiceDurationMin?: number;
}

export interface NormalizedPlatformClinicProvisioningInput extends PlatformClinicProvisioningInput {
  branchName: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  locale: string;
  featureKeys: string[];
  openDays: number[];
  opensAt: string;
  closesAt: string;
  firstServiceName: string;
  firstServiceCode: string;
  firstServicePrice: number;
  firstServiceDurationMin: number;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const STAFF_ID = /^[A-Za-z0-9_-]{2,64}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function serviceCode(value: string): string {
  const result = value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return result || "SERVICE_1";
}

export function isPlatformPlanCode(value: unknown): value is PlatformPlanCode {
  return typeof value === "string" && (PLATFORM_PLAN_CODES as readonly string[]).includes(value);
}

export function normalizePlatformClinicProvisioningInput(raw: PlatformClinicProvisioningInput): NormalizedPlatformClinicProvisioningInput {
  const organizationName = text(raw.organizationName);
  const organizationSlug = text(raw.organizationSlug).toLowerCase();
  const clinicName = text(raw.clinicName);
  const clinicSlug = text(raw.clinicSlug).toLowerCase();
  const ownerStaffId = text(raw.ownerStaffId);
  const timezone = text(raw.timezone || "Asia/Dhaka");
  if (!organizationName || !clinicName) throw new Error("PLATFORM_CLINIC_NAME_REQUIRED");
  if (!SLUG.test(organizationSlug) || !SLUG.test(clinicSlug)) throw new Error("PLATFORM_CLINIC_SLUG_INVALID");
  if (!STAFF_ID.test(ownerStaffId)) throw new Error("PLATFORM_OWNER_STAFF_ID_INVALID");
  if (!isPlatformPlanCode(raw.planCode)) throw new Error("PLATFORM_PLAN_INVALID");
  const trialDays = Number(raw.trialDays);
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) throw new Error("PLATFORM_TRIAL_DAYS_INVALID");
  const opensAt = text(raw.opensAt || "09:00");
  const closesAt = text(raw.closesAt || "18:00");
  if (!TIME.test(opensAt) || !TIME.test(closesAt) || opensAt >= closesAt) throw new Error("PLATFORM_HOURS_INVALID");
  const openDays = [...new Set((raw.openDays?.length ? raw.openDays : [1, 2, 3, 4, 5, 6]).map(Number))].sort((a, b) => a - b);
  if (openDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error("PLATFORM_OPEN_DAYS_INVALID");
  const requestedFeatures = raw.featureKeys?.length ? raw.featureKeys.map(text).filter(Boolean) : [...PLATFORM_PLANS[raw.planCode].defaultFeatureKeys];
  const featureKeys = [...new Set([...CORE_FEATURE_KEYS, ...requestedFeatures])];
  const firstServiceName = text(raw.firstServiceName || "Consultation");
  const firstServiceCode = text(raw.firstServiceCode) || serviceCode(firstServiceName);
  const firstServicePrice = Number(raw.firstServicePrice ?? 0);
  const firstServiceDurationMin = Number(raw.firstServiceDurationMin ?? 30);
  if (!firstServiceName || !firstServiceCode) throw new Error("PLATFORM_SERVICE_REQUIRED");
  if (!Number.isFinite(firstServicePrice) || firstServicePrice < 0) throw new Error("PLATFORM_SERVICE_PRICE_INVALID");
  if (!Number.isInteger(firstServiceDurationMin) || firstServiceDurationMin < 5 || firstServiceDurationMin > 480) throw new Error("PLATFORM_SERVICE_DURATION_INVALID");
  return {
    ...raw,
    organizationName,
    organizationSlug,
    clinicName,
    clinicSlug,
    clinicType: raw.clinicType || "other",
    timezone,
    branchName: text(raw.branchName) || clinicName,
    address: text(raw.address),
    phone: text(raw.phone),
    email: text(raw.email),
    currency: text(raw.currency || "BDT") || "BDT",
    locale: text(raw.locale || "en") || "en",
    ownerStaffId,
    planCode: raw.planCode,
    trialDays,
    featureKeys,
    openDays,
    opensAt,
    closesAt,
    firstServiceName,
    firstServiceCode,
    firstServicePrice,
    firstServiceDurationMin,
  };
}

export function buildProvisioningPayload(input: NormalizedPlatformClinicProvisioningInput) {
  const openDays = new Set(input.openDays);
  return {
    organization: { slug: input.organizationSlug, name: input.organizationName },
    clinic: {
      slug: input.clinicSlug,
      name: input.clinicName,
      type: input.clinicType,
      timezone: input.timezone,
      branchName: input.branchName,
      address: input.address,
      phone: input.phone,
      email: input.email,
      currency: input.currency,
      locale: input.locale,
    },
    owner: { staffId: input.ownerStaffId },
    commercial: { planCode: input.planCode },
    operatingHours: Array.from({ length: 7 }, (_, index) => {
      const dayOfWeek = index + 1;
      const isOpen = openDays.has(dayOfWeek);
      return { dayOfWeek, isOpen, opensAt: isOpen ? input.opensAt : null, closesAt: isOpen ? input.closesAt : null };
    }),
    features: input.featureKeys,
    services: [{
      serviceCode: input.firstServiceCode,
      displayName: input.firstServiceName,
      department: "All",
      price: input.firstServicePrice,
      durationMin: input.firstServiceDurationMin,
      requiresBooking: true,
      requiresProvider: true,
      requiresResource: false,
      discountApplicable: true,
      taxApplicable: false,
      packageEligible: false,
      isActive: true,
    }],
    rooms: [],
    resources: [],
    booking: {
      mode: "simple",
      defaultDurationMin: input.firstServiceDurationMin,
      slotIntervalMin: input.firstServiceDurationMin,
      maxSimultaneous: null,
      providerRequired: true,
      resourceRequired: false,
      blockDuplicatePatientOverlap: true,
      allowWalkIn: true,
      cancellationNoticeMin: 0,
      lateArrivalGraceMin: 0,
      capacityRules: {},
    },
  };
}

export function trialEndsAt(start: Date, trialDays: number): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + trialDays);
  return end;
}

export function requireReleaseSha(value: unknown): string {
  const sha = text(value).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("PLATFORM_RELEASE_SHA_INVALID");
  return sha;
}
