import { NextRequest, NextResponse } from "next/server";
import { callPlatformControl } from "@/lib/data/platformControlClient";
import type { PlatformOwnerSnapshot } from "@/lib/data/platformOwner";
import {
  isPlatformPlanCode,
  normalizePlatformClinicProvisioningInput,
  type ClinicType,
  type PlatformClinicProvisioningInput,
} from "@/lib/domain/platform/platformOwnerMvp";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import { requireCurrentPlatformOwner } from "@/lib/platform/currentPlatformOwner";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

type ControlResponse = {
  ok: true;
  snapshot: PlatformOwnerSnapshot;
  scope?: { organizationId: string; clinicId: string };
};

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "PLATFORM_OPERATION_FAILED";
  const status = /ACCESS_DENIED|NOT_AUTHORIZED/.test(message)
    ? 403
    : /ALREADY_MANAGED/.test(message)
      ? 409
      : /INVALID|REQUIRED|UNKNOWN|SLUG|TRIAL|FEATURE|SHA|CANNOT_BE/.test(message)
        ? 400
        : /NOT_FOUND/.test(message)
          ? 404
          : /NOT_CONFIGURED|UNAVAILABLE|TIMEOUT|SECRET_MISSING|HTTP_5/.test(message)
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
    const owner = await requireCurrentPlatformOwner();
    const result = await callPlatformControl<ControlResponse>({
      action: "snapshot",
      actorStaffId: owner.staffId,
    });
    return NextResponse.json(result);
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
    if (input.ownerStaffId === owner.staffId) {
      throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
    }
    const result = await callPlatformControl<ControlResponse>({
      action: "provision",
      actorStaffId: owner.staffId,
      input,
    });
    return NextResponse.json(result);
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
    if (!body.action) throw new Error("PLATFORM_ACTION_INVALID");
    if (body.action === "profile") {
      const clinicName = String(body.profile?.clinicName || "").trim();
      if (!clinicName) throw new Error("PLATFORM_CLINIC_NAME_REQUIRED");
    }
    if (body.action === "owner") {
      const ownerStaffId = String(body.ownerStaffId || "").trim();
      if (ownerStaffId === owner.staffId) throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
    }
    if (body.action === "commercial" && !isPlatformPlanCode(body.planCode)) {
      throw new Error("PLATFORM_PLAN_INVALID");
    }
    const result = await callPlatformControl<ControlResponse>({
      ...body,
      ...scope,
      actorStaffId: owner.staffId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}
