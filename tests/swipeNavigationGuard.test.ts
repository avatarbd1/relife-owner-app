// Swipe interaction regression contract for PR #118.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("BottomNav is tap-only and no longer owns swipe route navigation", () => {
  const nav = source("components/BottomNav.tsx");

  assert.doesNotMatch(nav, /useSwipeNavigation/);
  assert.doesNotMatch(nav, /swipeRoutes/);
  assert.doesNotMatch(nav, /swipeProgress/);
  assert.match(nav, /<Link/);
  assert.match(nav, /onClick=\{\(\) =>/);
});

test("Home swipe requires a deliberate horizontal gesture and loops in place", () => {
  const loop = source("components/HomeSwipeLoop.tsx");

  assert.match(loop, /const SWIPE_THRESHOLD = 72/);
  assert.match(loop, /const HORIZONTAL_DOMINANCE = 1\.35/);
  assert.match(loop, /absX < SWIPE_THRESHOLD/);
  assert.match(loop, /absX < absY \* HORIZONTAL_DOMINANCE/);
  assert.match(loop, /\(currentIndex \+ 1\) % items\.length/);
  assert.match(loop, /\(currentIndex - 1 \+ items\.length\) % items\.length/);
  assert.match(loop, /window\.scrollTo/);
  assert.doesNotMatch(loop, /router\.push/);
});

test("vertical intent and controls do not trigger Home swipe", () => {
  const loop = source("components/HomeSwipeLoop.tsx");

  assert.match(loop, /type GestureAxis = "pending" \| "horizontal" \| "vertical"/);
  assert.match(loop, /start\.axis = "vertical"/);
  for (const target of ["button", "input", "textarea", "select", "form", "[role='dialog']"]) {
    assert.equal(loop.includes(target), true, `${target} should block Home swipe`);
  }
  assert.match(loop, /isHorizontallyScrollable/);
});

test("Owner and staff Home keep their existing role content as swipe items", () => {
  const owner = source("app/(dashboard)/home/page.tsx");
  const staff = source("components/StaffHomeWorkspace.tsx");

  assert.match(owner, /HomeSwipeLoop/);
  assert.match(staff, /HomeSwipeLoop/);
  assert.match(owner, /data-home-swipe-item/);
  assert.match(staff, /data-home-swipe-item/);

  assert.match(owner, /Collected today/);
  assert.match(owner, /Quick actions/);
  assert.match(owner, /Cash custody/);
  assert.match(staff, /Today’s queue/);
  assert.match(staff, /My patients today/);
  assert.match(staff, /Quick actions/);
});
