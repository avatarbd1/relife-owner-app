import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { shouldUseSupabaseValidation, syncSupabaseChamberCache } from "@/lib/data/supabaseChamber";
import { createFixedHourBooking, validateFixedHourBooking, type FixedHourInput, type FixedHourValidation } from "@/lib/webos/chamberFixedHour";
import { validateFixedHourBookingWithSupabase } from "@/lib/webos/chamberSupabaseValidation";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getPatientForContext } from "@/lib/webos/reception";
import { withMutationLock } from "@/lib/webos/mutationLock";
import type { AccessContext } from "@/lib/webos/access";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "CHAMBER_FIXED_HOUR_FAILED";
  const validation = (error as Error & { validation?: unknown })?.validation;
  if (message === "ACCESS_DENIED") return NextResponse.json({ ok: false, error: message }, { status: 403 });
  if (message === "PATIENT_NOT_FOUND") return NextResponse.json({ ok: false, error: message }, { status: 404 });
  if (message.startsWith("APPOINTMENT_CONFLICT:")) {
    return NextResponse.json({ ok: false, error: "APPOINTMENT_CONFLICT", detail: message.split(":").slice(2).join(":"), validation }, { status: 409 });
  }
  if (["INVALID_DATE", "INVALID_TIME", "INVALID_SLOT", "INVALID_BED", "INVALID_THERAPIST"].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  if (message === "SCHEMA_MISMATCH") return NextResponse.json({ ok: false, error: message }, { status: 503 });
  console.error("Fixed-hour Chamber booking failed", error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

async function warmSupabaseReference(
  context: AccessContext,
  input: FixedHourInput,
  validation: FixedHourValidation
): Promise<void> {
  try {
    const patient = await getPatientForContext(context, input.patientId);
    if (!patient || patient.department !== "Physio") return;
    const suggestedLabels = validation.suggestedModalities.flatMap((value) => {
      const option = validation.modalityOptions.find((item) => item.value === value);
      return option ? [option.label] : [];
    });
    if (validation.needsTraction) suggestedLabels.push("Traction");
    await syncSupabaseChamberCache({
      patients: [{
        patientId: patient.patientId,
        fullName: patient.fullName,
        gender: patient.gender,
        therapist: patient.therapist,
        status: patient.status,
        department: "Physio",
      }],
      plans: [{
        patientId: patient.patientId,
        electrotherapyPlan: suggestedLabels.join(" "),
        manualTherapyPlan: validation.suggestedModalities.includes("MANUAL") ? "Manual Therapy" : "",
        exercisePlan: "",
        status: "Active",
      }],
    });
  } catch (error) {
    console.warn("Supabase Chamber cache warm failed", error);
  }
}

async function validateBooking(context: AccessContext, input: FixedHourInput) {
  if (!shouldUseSupabaseValidation()) return validateFixedHourBooking(context, input);
  try {
    return await validateFixedHourBookingWithSupabase(context, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPABASE_VALIDATION_FAILED";
    if (["INVALID_DATE", "INVALID_TIME", "INVALID_SLOT", "INVALID_BED", "INVALID_THERAPIST", "ACCESS_DENIED"].includes(message)) {
      throw error;
    }
    // Shadow mode must never make clinic booking unavailable. If Supabase is
    // temporarily unavailable or its cache is not ready, validate once from
    // Sheets, then warm the selected patient into Supabase for later taps.
    console.warn("Supabase Chamber validation fallback to Sheets:", message);
    const validation = await validateFixedHourBooking(context, input);
    void warmSupabaseReference(context, input, validation);
    return validation;
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const action = String(body.action || "validate");
    const input: FixedHourInput = {
      patientId: String(body.patientId || ""),
      date: String(body.date || ""),
      time: String(body.time || ""),
      therapist: String(body.therapist || ""),
      requestedBedId: String(body.requestedBedId || ""),
      modalities: Array.isArray(body.modalities) ? body.modalities.map(String) : [],
      remarks: String(body.remarks || ""),
    };
    if (action === "validate") {
      const validation = await validateBooking(context, input);
      return NextResponse.json({ ok: true, validation });
    }
    if (action === "create") {
      // Writes remain on the proven Sheets transaction while the Supabase
      // migration runs in shadow mode. The final write still revalidates.
      const result = await withMutationLock(`appointment-create:${input.date}`, () => createFixedHourBooking(context, input));
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
