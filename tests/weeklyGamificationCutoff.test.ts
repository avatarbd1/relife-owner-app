import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const edge = source("supabase/functions/relife-weekly-gamification-finalizer/index.ts");

test("weekly scoring and XP use source event time inside the Dhaka week and cutoff", () => {
  assert.match(edge, /event_at at time zone 'Asia\/Dhaka'/);
  assert.match(edge, /between \$\{weekStart\}::date and \$\{weekEnd\}::date/);
  assert.match(edge, /event_at <= \$\{cutoff\}::timestamptz/);
  assert.match(edge, /join relife\.performance_events e/);
  assert.match(edge, /e\.event_at <= \$\{cutoff\}::timestamptz/);
});

test("weekly config lookup includes archived historical versions but requires cutoff-time effectiveness", () => {
  assert.match(edge, /status in \('active','archived'\)/);
  assert.match(edge, /effective_from <= \$\{cutoff\}::timestamptz/);
  assert.match(edge, /effective_until is null or effective_until > \$\{cutoff\}::timestamptz/);
});
