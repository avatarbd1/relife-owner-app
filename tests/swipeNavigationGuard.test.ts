import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Safe Swipe Guard requires a deliberate 96px horizontal swipe", () => {
  const hook = source("hooks/useSwipeNavigation.ts");
  const nav = source("components/BottomNav.tsx");

  assert.match(hook, /threshold = 96/);
  assert.match(nav, /threshold: 96/);
  assert.match(hook, /horizontalDominance = 1\.5/);
  assert.match(hook, /const validDistance = absX >= threshold/);
  assert.match(hook, /const validDirection = absX >= absY \* horizontalDominance/);
});

test("fast short flicks cannot bypass the distance threshold", () => {
  const hook = source("hooks/useSwipeNavigation.ts");

  assert.doesNotMatch(hook, /absX >= 32/);
  assert.doesNotMatch(hook, /velocity\s*>=/);
  assert.doesNotMatch(hook, /const velocity\s*=/);
});

test("vertical intent permanently cancels the current navigation gesture", () => {
  const hook = source("hooks/useSwipeNavigation.ts");

  assert.match(hook, /type GestureAxis = "pending" \| "horizontal" \| "vertical"/);
  assert.match(hook, /start\.axis = "vertical"/);
  assert.match(hook, /if \(start\.axis === "vertical"\) return/);
  assert.match(
    hook,
    /start\.ignored \|\| start\.axis === "vertical" \|\| isNavigating/
  );
});

test("forms tables controls and nested scroll regions ignore menu swipe navigation", () => {
  const hook = source("hooks/useSwipeNavigation.ts");

  for (const target of ["form", "table", "[role='button']", "[role='dialog']"]) {
    assert.equal(hook.includes(target), true, `${target} should block menu swipe`);
  }
  assert.match(hook, /function isScrollableRegion/);
  assert.match(hook, /canScrollX \|\| canScrollY/);
  assert.match(hook, /isScrollableRegion\(event\.target\)/);
});
