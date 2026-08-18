import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Chamber chat is a dedicated screen backed by the bounded workspace", () => {
  const page = source("app/(dashboard)/chamber/chat/page.tsx");

  assert.match(page, /ChamberContextChatClient/);
  assert.match(page, /getChamberChatWorkspace/);
  assert.match(page, /Room · patient · session communication/);
  assert.doesNotMatch(page, /redirect\(/);
});

test("Home Live chat opens the dedicated chat screen while tabs remain tap-only", () => {
  const actionSlide = source("components/HomeActionSlide.tsx");
  const workspaceUi = source("components/WorkspaceUI.tsx");
  const bottomNav = source("components/BottomNav.tsx");

  assert.match(actionSlide, /label === "Live chat" \? "\/chamber\/chat" : href/);
  assert.match(workspaceUi, /label === "Live chat" \? "\/chamber\/chat" : href/);
  assert.doesNotMatch(bottomNav, /useSwipeNavigation/);
  assert.match(bottomNav, /<Link/);
});

test("Context chat reuses canonical Chamber data and existing comms storage", () => {
  const workspace = source("lib/webos/chamberChat.ts");

  assert.match(workspace, /getChamberSnapshot/);
  assert.match(workspace, /getChamberCommsSnapshot/);
  assert.match(workspace, /getAppointmentsForContext\(context, "physio", today\)/);
  assert.match(workspace, /const CHAT_ROLES = new Set\(\["Owner", "Manager", "Receptionist", "Therapist"\]\)/);
  assert.doesNotMatch(workspace, /16_ChatMessages/);
});

test("Context chat API enforces active context and operational-only messages", () => {
  const route = source("app/api/chamber/context-chat/route.ts");

  assert.match(route, /isAllowedRequestOrigin/);
  assert.match(route, /CHAT_CONTEXT_REQUIRED/);
  assert.match(route, /CHAT_CONTEXT_NOT_FOUND/);
  assert.match(route, /CHAT_CONTEXT_CLOSED/);
  assert.match(route, /NON_OPERATIONAL_MESSAGE/);
  assert.match(route, /withMutationLock/);
  assert.match(route, /sendChamberMessage/);
});

test("Chat client provides quick messages, search, mute, polling and session archive presentation", () => {
  const client = source("components/ChamberContextChatClient.tsx");

  for (const label of [
    "Help needed — Jan/Asen counter",
    "Patient arrived",
    "Session starting",
    "Session completed",
    "Room cleanup needed",
    "Assessment done",
    "Can't proceed — Need approval",
    "Staff needed — Call receptionist",
    "Emergency — assistance required",
    "Call required",
  ]) {
    assert.equal(client.includes(label), true, `${label} preset should exist`);
  }

  assert.match(client, /Search messages or staff/);
  assert.match(client, /relife_chamber_context_mute/);
  assert.match(client, /Notification\.requestPermission/);
  assert.match(client, /window\.setInterval\(\(\) => void refresh\(\), 8_000\)/);
  assert.match(client, /const ARCHIVE_DELAY_MS = 5 \* 60 \* 1000/);
  assert.match(client, /data-home-swipe-ignore/);
});
