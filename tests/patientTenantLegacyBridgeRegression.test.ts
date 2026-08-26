import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const reception = source("lib/webos/reception.ts");
const mediaRoute = source(
  "app/api/patients/[patientId]/reports/[reportId]/media/route.ts"
);

test("legacy Relife patient bridge is bounded to the canonical Amtali tenant", () => {
  assert.match(
    reception,
    /tenant\.organizationSlug\?\.toLowerCase\(\) !== "relife"/[\s\S]*tenant\.clinicSlug\?\.toLowerCase\(\) !== "amtali-main"/[\s\S]*patient\.organizationId !== "RELIFE"/
  );
  assert.match(
    reception,
    /patient\.department === "Physio"[\s\S]*patient\.clinicId === "RELIFE-PHYSIO"/
  );
  assert.match(
    reception,
    /patient\.department === "Dental"[\s\S]*patient\.clinicId === "RELIFE-DENTAL"/
  );
  assert.match(
    reception,
    /patientMatchesTenant\(patient, tenant\)/
  );
  assert.match(
    reception,
    /patientMatchesTenant\(row, tenant\)/
  );
});

test("legacy tenant bridge does not replace canonical exact matching", () => {
  assert.match(
    reception,
    /patient\.organizationId === tenant\.organizationId[\s\S]*patient\.clinicId === tenant\.clinicId[\s\S]*return true/
  );
  assert.match(
    reception,
    /every other tenant remains[\s\S]*exact-match only/i
  );
});

test("legacy Photo media type gets an explicit image MIME fallback", () => {
  assert.match(
    mediaRoute,
    /declared === "photo" \|\| declared === "image"\) return "image\/jpeg"/
  );
  assert.match(mediaRoute, /X-Content-Type-Options": "nosniff"/);
});
