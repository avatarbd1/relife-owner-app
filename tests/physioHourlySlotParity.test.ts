import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const bookingUi = source("components/AppointmentFormMultiDate.tsx");
const bookingDomain = source("lib/domain/appointments/create.ts");
const chamberFixedHour = source("lib/webos/chamberFixedHour.ts");

describe("Physio fixed-hour appointment parity", () => {
  it("shows Physio starts on full hours while leaving Dental cadence independent", () => {
    const physioSlots = bookingUi.match(/const PHYSIO_TIME_SLOTS = \[([\s\S]*?)\];/)?.[1] || "";
    ok(physioSlots.includes('"09:00"'));
    ok(physioSlots.includes('"10:00"'));
    ok(physioSlots.includes('"17:00"'));
    equal(physioSlots.includes('"09:30"'), false);
    equal(physioSlots.includes('"10:30"'), false);
    ok(bookingUi.includes('selectedPatient?.department === "Physio" ? PHYSIO_TIME_SLOTS : DENTAL_TIME_SLOTS'));
    ok(bookingUi.includes("Physio Chamber uses fixed 60-minute slots."));
  });

  it("rejects non-hour Physio starts in the canonical appointment domain", () => {
    ok(bookingDomain.includes("const FIXED_HOUR_MINUTES = 60"));
    ok(bookingDomain.includes("startMinute % FIXED_HOUR_MINUTES !== 0"));
    ok(bookingDomain.includes('throw new Error("INVALID_SLOT")'));
    ok(bookingDomain.includes("withTherapist.suggestions.filter"));
    ok(bookingDomain.includes("isFixedHourStart(item.time)"));
  });

  it("stays aligned with the existing Chamber 60-minute rule", () => {
    ok(chamberFixedHour.includes("const SESSION_MINUTES = 60"));
    ok(chamberFixedHour.includes("slotStartMinute % 60 !== 0"));
    ok(chamberFixedHour.includes("slotEndMinute = slotStartMinute + SESSION_MINUTES"));
  });
});
