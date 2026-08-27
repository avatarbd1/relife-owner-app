import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const appointmentPage = source("app/(dashboard)/appointments/new/page.tsx");
const booking = source("components/AppointmentFormMultiDate.tsx");
const clinical = source("components/ClinicalWorkspaceClient.tsx");
const registrationForm = source("components/PatientRegistrationForm.tsx");
const photo = source("components/PhotoCaptureRegistration.tsx");
const extractionRoute = source("app/api/patients/extract-registration/route.ts");
const extractionDomain = source("lib/webos/registrationAi.ts");
const inventory = source("lib/webos/inventory.ts");
const inventoryPage = source("app/(dashboard)/inventory/page.tsx");
const morePage = source("app/(dashboard)/more/page.tsx");

describe("App-primary A1-A5 architecture", () => {
  it("A1 wires the reviewed multi-date booking UI to canonical appointment APIs", () => {
    ok(appointmentPage.includes("AppointmentFormMultiDate"));
    equal(appointmentPage.includes("<AppointmentForm\n"), false);
    ok(booking.includes('fetch("/api/appointments/validate"'));
    ok(booking.includes("Boolean(validation.isValid)"));
    ok(booking.includes('fetch("/api/appointments"'));
    ok(booking.includes("times.size >= 2"));
    ok(booking.includes("Retry failed only"));
    ok(booking.includes("requestIdsRef"));
    equal(booking.includes("setSelectedSlots"), false);
  });

  it("A3 keeps treatment writes canonical while adding editable same-as-last and stale pain follow-up", () => {
    ok(clinical.includes("✓ Same as last"));
    ok(clinical.includes("Pain before · 0–10"));
    ok(clinical.includes("painAgeDays >= 7"));
    ok(clinical.includes("Pain values are never copied"));
    ok(clinical.includes('post("/api/clinical/session"'));
  });

  it("A4 extracts only an AI draft and leaves final registration on the existing patient API", () => {
    ok(extractionDomain.includes('assertCanPerform(context, "patient.create", input.department)'));
    ok(extractionDomain.includes("openrouter.ai/api/v1/chat/completions"));
    ok(extractionRoute.includes("requireCurrentTenantAccessContext"));
    ok(photo.includes('fetch("/api/patients/extract-registration"'));
    equal(photo.includes('fetch("/api/patients"'), false);
    ok(registrationForm.includes('fetch("/api/patients"'));
    ok(registrationForm.includes("AI draft applied — review required"));
    ok(registrationForm.includes("(optional)"));
  });

  it("A5 serializes inventory read-modify-write and exposes the dedicated Physio workspace", () => {
    ok(inventory.includes("withMutationLock(inventoryLockKey(itemName)"));
    ok(inventory.includes("INVENTORY_INSUFFICIENT_STOCK"));
    ok(inventoryPage.includes('canPerform(context, "inventory.read", "Physio")'));
    ok(morePage.includes('href="/inventory"'));
  });
});
