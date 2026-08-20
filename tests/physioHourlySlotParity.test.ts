import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const bookingUi = source("components/AppointmentFormMultiDate.tsx");
const bookingDomain = source("lib/domain/appointments/create.ts");
const scheduling = source("lib/webos/appointmentScheduling.ts");
const hours = source("lib/domain/chamber/hours.ts");
const chamberBoard = source("lib/domain/chamber/board.ts");
const chamberUi = source("components/ChamberHourlyBedBoard.tsx");
const chamberPage = source("app/(dashboard)/chamber/page.tsx");

describe("Physio Chamber schedule and four-bed capacity parity", () => {
  it("uses the same 9-1 and 3-9 hourly starts in appointment and Chamber UI", () => {
    for (const time of [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
      "20:00",
    ]) {
      ok(hours.includes(`\"${time}\"`), `missing Chamber start ${time}`);
    }
    equal(hours.includes('"13:00"'), false);
    equal(hours.includes('"14:00"'), false);
    ok(hours.includes("PHYSIO_CHAMBER_DAILY_CAPACITY"));
    ok(hours.includes("PHYSIO_CHAMBER_STARTS.length * PHYSIO_CHAMBER_BED_IDS.length"));
    ok(bookingUi.includes("PHYSIO_CHAMBER_STARTS"));
    ok(chamberBoard.includes("PHYSIO_CHAMBER_STARTS.map"));
    ok(bookingUi.includes('selectedPatient?.department === "Physio" ? PHYSIO_TIME_SLOTS : DENTAL_TIME_SLOTS'));
    ok(bookingUi.includes("9 AM–1 PM & 3–9 PM"));
  });

  it("rejects every Physio start outside the canonical Chamber schedule", () => {
    ok(bookingDomain.includes("assertPhysioChamberStart"));
    ok(bookingDomain.includes("isPhysioChamberStart(value)"));
    ok(bookingDomain.includes('throw new Error("INVALID_SLOT")'));
    ok(bookingDomain.includes("withTherapist.suggestions.filter"));
    ok(bookingDomain.includes("isPhysioChamberStart(item.time)"));
    ok(scheduling.includes("if (!isPhysioChamberStart(input.time)) throw new Error(\"INVALID_SLOT\")"));
  });

  it("keeps Traction out of the four general-bed booking capacity", () => {
    ok(hours.includes('"BED-1"'));
    ok(hours.includes('"BED-4"'));
    equal(hours.includes('"TRACTION-BED"'), false);
    equal(chamberUi.includes("renderBedCell(TRACTION"), false);
    ok(scheduling.includes("overlappingAppointments.length >= 4"));
    ok(scheduling.includes('message: "All 4 treatment beds are already booked for this hour."'));
    ok(scheduling.includes('station: needsTraction ? "Traction" : "Treatment"'));
    equal(
      scheduling.includes('return { bedId: "TRACTION-BED", roomId: "Traction Room", station: "Traction" }'),
      false
    );
    ok(chamberPage.includes("Booking capacity"));
    ok(chamberPage.includes("10 hourly windows · 4 general beds · 60 ± 5 min"));
    ok(chamberPage.includes("Booking plans capacity. Live operation records what actually happens."));
  });

  it("holds legacy fixed-hour scheduling records for at least the full 60-minute booking hour", () => {
    ok(scheduling.includes("startMinute + Math.max(60, durationMin)"));
    ok(scheduling.includes("existingStart + Math.max(60, item.expectedDurationMin)"));
  });

  it("preserves the existing explicit Supabase cutover boundary", () => {
    ok(bookingDomain.includes('chamberDbMode() !== "supabase"'));
    ok(bookingDomain.includes("SUPABASE_EDGE_SECRET_MISSING"));
  });
});
