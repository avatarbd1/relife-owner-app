import { NextRequest, NextResponse } from "next/server";
import {
  activatePlatformClinic,
  assignPlatformClinicOwner,
  listPlatformOwnerSnapshot,
  provisionPlatformClinic,
  setPlatformClinicCommercial,
  suspendPlatformClinic,
} from "@/lib/data/platformOwner";
import { patchPlatformClinicProfile } from "@/lib/data/platformClinicProfile";
import {
  isPlatformPlanCode,
  normalizePlatformClinicProvisioningInput,
  type ClinicType,
  type PlatformClinicProvisioningInput,
} from "@/lib/domain/platform/platformOwnerMvp";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import { requireCurrentPlatformOwner } from "@/lib/platform/currentPlatformOwner";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "PLATFORM_OPERATION_FAILED";
  const status = /ACCESS_DENIED|NOT_AUTHORIZED/.test(message)
    ? 403
    : /ALREADY_MANAGED/.test(message)
      ? 409
      : /INVALID|REQUIRED|UNKNOWN|SLUG|TRIAL|FEATURE|SHA/.test(message)
        ? 400
        : /NOT_FOUND/.test(message)
          ? 404
          : /NOT_CONFIGURED|UNAVAILABLE/.test(message)
            ? 503
            : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

function originAllowed(request: NextRequest) {
  return isAllowedRequestOrigin(request)
    ? null
    : NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
}

export async function GET() {
  try {
    await requireCurrentPlatformOwner();
    return NextResponse.json({ ok: true, snapshot: await listPlatformOwnerSnapshot() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const rejected = originAllowed(request);
  if (rejected) return rejected;
  try {
    const owner = await requireCurrentPlatformOwner();
    const raw = await request.json() as PlatformClinicProvisioningInput;
    const input = normalizePlatformClinicProvisioningInput(raw);
    const before = await listPlatformOwnerSnapshot();
    const existing = before.clinics.find((clinic) =>
      clinic.organizationSlug === input.organizationSlug && clinic.clinicSlug === input.clinicSlug
    );
    if (existing && ["active", "suspended"].includes(existing.clinicStatus)) {
      throw new Error("PLATFORM_CLINIC_ALREADY_MANAGED");
    }
    const scope = await provisionPlatformClinic(input, owner.staffId);
    return NextResponse.json({ ok: true, scope, snapshot: await listPlatformOwnerSnapshot() });
  } catch (error) {
    return fail(error);
  }
}

type PatchBody = {
  action?: "profile" | "owner" | "commercial" | "activate" | "suspend";
  organizationId?: string;
  clinicId?: string;
  profile?: {
    clinicName?: string;
    clinicType?: ClinicType;
    branchName?: string;
    address?: string;
    phone?: string;
    email?: string;
    logoUrl?: string;
    currency?: string;
    locale?: string;
    timezone?: string;
  };
  ownerStaffId?: string;
  planCode?: string;
  trialDays?: number;
  featureKeys?: string[];
  releaseSha?: string;
};

export async function PATCH(request: NextRequest) {
  const rejected = originAllowed(request);
  if (rejected) return rejected;
  try {
    const owner = await requireCurrentPlatformOwner();
    const body = await request.json() as PatchBody;
    const scope = requireTenantScope({ organizationId: body.organizationId, clinicId: body.clinicId });
    switch (body.action) {
      case "profile": {
        const profile = body.profile || {};
        const clinicName = String(profile.clinicName || "").trim();
        if (!clinicName) throw new Error("PLATFORM_CLINIC_NAME_REQUIRED");
        await patchPlatformClinicProfile(scope, { ...profile, clinicName }, owner.staffId);
        break;
      }
      case "owner":
        await assignPlatformClinicOwner(scope, String(body.ownerStaffId || ""), owner.staffId);
        break;
      case "commercial":
        if (!isPlatformPlanCode(body.planCode)) throw new Error("PLATFORM_PLAN_INVALID");
        await setPlatformClinicCommercial(scope, {
          planCode: body.planCode,
          trialDays: Number(body.trialDays || 30),
          featureKeys: Array.isArray(body.featureKeys) ? body.featureKeys : [],
        }, owner.staffId);
        break;
      case "activate":
        await activatePlatformClinic(scope, String(body.releaseSha || ""), owner.staffId);
        break;
      case "suspend":
        await suspendPlatformClinic(scope, owner.staffId);
        break;
      default:
        throw new Error("PLATFORM_ACTION_INVALID");
    }
    return NextResponse.json({ ok: true, snapshot: await listPlatformOwnerSnapshot() });
  } catch (error) {
    return fail(error);
  }
}
