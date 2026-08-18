import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new appointment flow uses explicit gender-safe bed selection", () => {
  const gate = source("components/AppointmentBookingGate.tsx");
  const form = source("components/AppointmentFormGenderBed.tsx");

  assert.match(gate, /AppointmentFormGenderBed/);
  assert.match(gate, /Gender missing/);
  assert.match(form, /PHYSIO_CHAMBER_STARTS/);
  assert.match(form, /BED-1/);
  assert.match(form, /BED-2/);
  assert.match(form, /BED-3/);
  assert.match(form, /BED-4/);
  assert.match(form, /Gender-safe bed/);
  assert.match(form, /requestedBedId/);
  assert.match(form, /\/api\/chamber\/schedule/);
  assert.match(form, /action: "create"/);
});

test("Physio schedule cards and capacity are hour-based and gender-aware", () => {
  const page = source("app/(dashboard)/appointments/page.tsx");
  const workspace = source("components/AppointmentsWorkspaceClientV2.tsx");

  assert.match(page, /AppointmentsWorkspaceClientV2/);
  assert.match(workspace, /item\.department === "Physio" \? 60 : 30/);
  assert.match(workspace, /Physio capacity · gender-wise/);
  assert.match(workspace, /Capacity is calculated per appointment hour/);
  assert.match(workspace, /Room 1/);
  assert.match(workspace, /Room 2/);
  assert.match(workspace, /roomGenderLabel/);
  assert.match(workspace, /4 treatment beds/);
});

test("fixed-bed API enforces configured Physio chamber hours", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  assert.match(handler, /isPhysioChamberStart/);
  assert.match(handler, /requestedBedId && !isPhysioChamberStart\(input\.time\)/);
  assert.match(handler, /INVALID_SLOT/);
});
