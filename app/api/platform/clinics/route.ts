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
import {
  STAFF_ENROLL_MAX_AGE,
  createStaffEnrollmentToken,
} from "@/lib/staffEnrollment";
import { listPasskeysForStaff } from "@/lib/webauthn";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

type OwnerSetupResponse = {
  ownerStaffId: string;
  setupPath: string;
  expiresInSeconds: number;
  clinicStatus: string;
};

type ControlResponse = {
  ok: true;
  snapshot: PlatformOwnerSnapshot;
  scope?: { organizationId: string; clinicId: string };
  ownerSetup?: OwnerSetupResponse;
};

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "PLATFORM_OPERATION_FAILED";
  const status = /ACCESS_DENIED|NOT_AUTHORIZED/.test(message)
    ? 403
    : /ALREADY_MANAGED|AMBIGUOUS/.test(message)
      ? 409
      : /INVALID|REQUIRED|UNKNOWN|SLUG|TRIAL|FEATURE|SHA|CANNOT_BE|SUSPENDED/.test(message)
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
    const explicitOwnerStaffId = String(raw.ownerStaffId || "").trim();
    if (explicitOwnerStaffId && input.ownerStaffId === owner.staffId) {
      throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
    }

    // Preserve omission of generated identity fields across the protected
    // server-to-server hop. The Edge control plane owns collision-safe final
    // allocation because only it can see all existing tenant identities.
    const controlInput = {
      ...input,
      organizationSlug: String(raw.organizationSlug || "").trim() || undefined,
      clinicSlug: String(raw.clinicSlug || "").trim() || undefined,
      ownerStaffId: explicitOwnerStaffId || undefined,
    };
    const result = await callPlatformControl<ControlResponse>({
      action: "provision",
      actorStaffId: owner.staffId,
      input: controlInput,
    });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

type PatchBody = {
  action?: "profile" | "owner" | "commercial" | "activate" | "suspend" | "owner_setup_link";
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

async function issueOwnerSetupLink(
  actorStaffId: string,
  scope: { organizationId: string; clinicId: string },
): Promise<ControlResponse> {
  const snapshotResult = await callPlatformControl<ControlResponse>({
    action: "snapshot",
    actorStaffId,
  });
  const clinic = snapshotResult.snapshot.clinics.find(
    (row) => row.organizationId === scope.organizationId && row.clinicId === scope.clinicId,
  );
  if (!clinic) throw new Error("PLATFORM_CLINIC_NOT_FOUND");
  if (clinic.clinicStatus === "suspended") {
    throw new Error("PLATFORM_OWNER_SETUP_SUSPENDED_CLINIC");
  }
  if (clinic.ownerStaffIds.length === 0) {
    throw new Error("PLATFORM_OWNER_ASSIGNMENT_REQUIRED");
  }
  if (clinic.ownerStaffIds.length !== 1) {
    throw new Error("PLATFORM_OWNER_ASSIGNMENT_AMBIGUOUS");
  }
  const ownerStaffId = clinic.ownerStaffIds[0];
  if (ownerStaffId === actorStaffId) {
    throw new Error("PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER");
  }
  const passkeys = await listPasskeysForStaff(ownerStaffId);
  const token = createStaffEnrollmentToken(ownerStaffId, passkeys.length);
  return {
    ...snapshotResult,
    ownerSetup: {
      ownerStaffId,
      setupPath: `/staff-setup?token=${encodeURIComponent(token)}`,
      expiresInSeconds: STAFF_ENROLL_MAX_AGE,
      clinicStatus: clinic.clinicStatus,
    },
  };
}

export async function PATCH(request: NextRequest) {
  const rejected = originAllowed(request);
  if (rejected) return rejected;
  try {
    const owner = await requireCurrentPlatformOwner();
    const body = await request.json() as PatchBody;
    const scope = requireTenantScope({ organizationId: body.organizationId, clinicId: body.clinicId });
    if (!body.action) throw new Error("PLATFORM_ACTION_INVALID");
    if (body.action === "owner_setup_link") {
      return NextResponse.json(await issueOwnerSetupLink(owner.staffId, scope));
    }
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
