// Swipe interaction regression contract for the Home carousel.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("BottomNav stays tap-only and does not own swipe route navigation", () => {
  const nav = source("components/BottomNav.tsx");

  assert.doesNotMatch(nav, /useSwipeNavigation/);
  assert.doesNotMatch(nav, /swipeRoutes/);
  assert.doesNotMatch(nav, /swipeProgress/);
  assert.match(nav, /<Link/);
});

test("Home swipe stays horizontal and its touch zone reaches close to bottom navigation", () => {
  const loop = source("components/HomeSwipeLoop.tsx");

  assert.match(loop, /const SWIPE_THRESHOLD = 44/);
  assert.match(loop, /const HORIZONTAL_DOMINANCE = 1\.15/);
  assert.match(loop, /min-h-\[calc\(100dvh-15rem\)\]/);
  assert.match(loop, /translate3d\(calc\(-\$\{trackOffsetPercent\}% \+ \$\{dragX\}px\)/);
  assert.match(loop, /setPosition\(\(current\) => current \+ \(deltaX < 0 \? 1 : -1\)\)/);
  assert.match(loop, /transition-transform duration-300 ease-out/);
  assert.doesNotMatch(loop, /window\.scrollTo/);
  assert.doesNotMatch(loop, /router\.push/);
});

test("Home carousel loops seamlessly with first and last slide clones", () => {
  const loop = source("components/HomeSwipeLoop.tsx");

  assert.match(loop, /return \[slides\[slideCount - 1\], \.\.\.slides, slides\[0\]\]/);
  assert.match(loop, /if \(position === 0\)/);
  assert.match(loop, /setPosition\(slideCount\)/);
  assert.match(loop, /if \(position === slideCount \+ 1\)/);
  assert.match(loop, /setPosition\(1\)/);
});

test("vertical scrolling and form controls remain safe while card surfaces can swipe", () => {
  const loop = source("components/HomeSwipeLoop.tsx");

  assert.match(loop, /type GestureAxis = "pending" \| "horizontal" \| "vertical"/);
  assert.match(loop, /start\.axis = "vertical"/);
  assert.match(loop, /touchAction: "pan-y"/);
  for (const target of ["input", "textarea", "select", "[role='slider']"]) {
    assert.equal(loop.includes(target), true, `${target} should block Home swipe`);
  }
  assert.equal(loop.includes("button,input"), false, "buttons should not block card swipe gestures");
  assert.match(loop, /isHorizontallyScrollable/);
});

test("the first swipe page keeps the complete Home feed instead of splitting Home sections", () => {
  const owner = source("app/(dashboard)/home/page.tsx");
  const staff = source("components/StaffHomeWorkspace.tsx");

  assert.match(owner, /data-home-feed-slide/);
  assert.match(staff, /data-home-feed-slide/);

  assert.match(owner, /Collected today/);
  assert.match(owner, /Quick actions/);
  assert.match(owner, /Needs attention/);
  assert.match(owner, /Cash custody/);

  assert.match(staff, /Today’s queue/);
  assert.match(staff, /My patients today/);
  assert.match(staff, /Quick actions/);
  assert.match(staff, /Front desk/);
  assert.match(staff, /Clinic operations/);
  assert.match(staff, /Physio clinical/);
  assert.match(staff, /Dental clinical/);
});

test("each quick action gets a separate swipe page and Live chat is brought into Home", () => {
  const owner = source("app/(dashboard)/home/page.tsx");
  const staff = source("components/StaffHomeWorkspace.tsx");
  const actionSlide = source("components/HomeActionSlide.tsx");
  const icons = source("components/AppIcon.tsx");

  assert.match(owner, /HomeActionSlide/);
  assert.match(staff, /HomeActionSlide/);
  assert.match(actionSlide, /data-home-action-slide/);
  assert.match(actionSlide, /min-h-\[calc\(100dvh-15rem\)\]/);
  assert.match(owner, /\/chamber\?tab=team/);
  assert.match(staff, /\/chamber\?tab=team/);
  assert.match(staff, /capabilities\.chamberRead/);
  assert.match(owner, /label="Live chat"/);
  assert.match(staff, /label: "Live chat"/);
  assert.match(icons, /\| "chat"/);
});
