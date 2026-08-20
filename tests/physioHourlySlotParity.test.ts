import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const bookingUi = source("components/AppointmentCapacityForm.tsx");
const bookingDomain = source("lib/domain/appointments/capacityBooking.ts");
const hours = source("lib/domain/chamber/hours.ts");
const chamberBoard = source("lib/domain/chamber/board.ts");
const chamberCapacityUi = source("components/ChamberCapacityBoard.tsx");
const chamberPage = source("app/(dashboard)/chamber/page.tsx");

describe("Physio booking hour and four-patient capacity parity", () => {
  it("uses the same 9-1 and 3-9 hourly starts in booking and Chamber schedule views", () => {
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
  });

  it("rejects Physio starts outside the canonical Chamber schedule", () => {
    ok(bookingDomain.includes("isPhysioChamberStart(input.time)"));
    ok(bookingDomain.includes('throw new Error("INVALID_SLOT")'));
  });

  it("counts four general-treatment places without pre-assigning a bed", () => {
    ok(hours.includes('"BED-1"'));
    ok(hours.includes('"BED-4"'));
    equal(hours.includes('"TRACTION-BED"'), false);
    ok(bookingDomain.includes("overlapping.length >= 4"));
    ok(bookingDomain.includes('message: "Physio treatment capacity is full for this hour."'));
    ok(bookingDomain.includes('Assigned_Bed_ID: ""'));
    ok(bookingDomain.includes('Timeline_ID: ""'));
    ok(chamberCapacityUi.includes("Hard block happens only when gender/room capacity or duplicate-patient conflict is unsafe"));
    ok(chamberPage.includes("Booking capacity"));
    ok(chamberPage.includes("10 hourly windows · 4 general beds · 60 ± 5 min"));
    ok(chamberPage.includes("Booking plans capacity. Live operation records what actually happens."));
  });

  it("keeps machine and therapist demand outside booking hard-block policy", () => {
    ok(bookingDomain.includes('type: "therapist_load"'));
    ok(bookingDomain.includes("Booking is still allowed"));
    ok(bookingDomain.includes('type: "machine_demand"'));
    ok(bookingDomain.includes("advisory only; no machine time is reserved"));
    ok(bookingDomain.includes("machineReservationsCreated: false"));
    equal(bookingDomain.includes("25_Machine_Reservations"), false);
    equal(bookingDomain.includes("26_Treatment_Timeline"), false);
  });
});
