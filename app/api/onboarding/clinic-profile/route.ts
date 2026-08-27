import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { writeClinicProfile, writeOperatingHours } from "@/lib/data/clinicConfiguration";
import { isValidTimezone, validateOperatingHours } from "@/lib/domain/tenancy/configurationCore";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

interface ClinicProfileInput {
  clinicName: string;
  clinicType: "physiotherapy" | "dental" | "doctor_chamber" | "other";
  branchName: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  currency: string;
  locale: string;
}

interface OperatingHoursInput {
  dayOfWeek: number;
  isOpen: boolean;
  opensAt?: string;
  closesAt?: string;
}

interface OnboardingProfileRequest {
  profile: ClinicProfileInput;
  operatingHours: OperatingHoursInput[];
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    validateTenantScope(access, tenant, "clinic.manage");
    if (!canPerform(access, "settings.manage", "Physio") && !canPerform(access, "settings.manage", "Dental")) {
      return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<OnboardingProfileRequest>;
    if (!body.profile) return NextResponse.json({ ok: false, error: "profile missing" }, { status: 400 });
    const profile = body.profile as ClinicProfileInput;
    const problems: string[] = [];

    if (!profile.clinicName?.trim()) problems.push("clinic name required");
    if (!["physiotherapy", "dental", "doctor_chamber", "other"].includes(profile.clinicType)) problems.push("valid clinic type required");
    if (!isValidTimezone(profile.timezone || "")) problems.push("valid timezone required");
    if (!profile.currency?.trim()) problems.push("currency required");
    if (!Array.isArray(body.operatingHours) || body.operatingHours.length !== 7) problems.push("all seven weekdays must be configured");

    const hours = Array.isArray(body.operatingHours)
      ? body.operatingHours.map((h) => ({
          organizationId: tenant.organizationId,
          clinicId: tenant.clinicId,
          dayOfWeek: h.dayOfWeek,
          isOpen: h.isOpen,
          opensAt: h.isOpen && h.opensAt ? h.opensAt : null,
          closesAt: h.isOpen && h.closesAt ? h.closesAt : null,
        }))
      : [];
    if (hours.length) problems.push(...validateOperatingHours(hours));
    if (problems.length) return NextResponse.json({ ok: false, error: [...new Set(problems)].join("; ") }, { status: 400 });

    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) return NextResponse.json({ ok: false, error: "CONFIGURATION_STORE_UNAVAILABLE" }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    await writeClinicProfile(
      { organizationId: tenant.organizationId, clinicId: tenant.clinicId },
      {
        clinicName: profile.clinicName.trim(),
        clinicType: profile.clinicType,
        branchName: profile.branchName || "",
        address: profile.address || "",
        phone: profile.phone || "",
        email: profile.email || "",
        logoUrl: "",
        currency: profile.currency.trim(),
        locale: profile.locale || "en",
        timezone: profile.timezone,
      },
      access.staffId,
      client,
    );
    await writeOperatingHours({ organizationId: tenant.organizationId, clinicId: tenant.clinicId }, hours, client);

    return NextResponse.json({ ok: true, organizationId: tenant.organizationId, clinicId: tenant.clinicId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PROFILE_SAVE_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
