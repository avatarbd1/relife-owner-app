import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Keep this regression suite tied to the Settings/admin impact contract used by CI.
function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("settings page is available to every authenticated role", () => {
  const page = source("app/(dashboard)/settings/page.tsx");
  assert.match(page, /requireCurrentAccessContext/);
  assert.match(page, /getCurrentStaffIdentity/);
  assert.match(page, /V1SettingsClient/);
  assert.doesNotMatch(page, /roles\.includes\("System Admin"\)/);
  assert.doesNotMatch(page, /redirect\("\/more"\)/);
});

test("minimal settings expose only real current workflows", () => {
  const client = source("components/V1SettingsClient.tsx");
  assert.match(client, /\/api\/settings\/profile/);
  assert.match(client, /\/security\/passkeys/);
  assert.match(client, /\/security\/staff-access/);
  assert.match(client, /isOwner \?/);
  assert.match(client, /9 AM–1 PM · 3 PM–9 PM/);
  assert.match(client, /No fake email switches/);
  assert.doesNotMatch(client, /Change password/);
  assert.doesNotMatch(client, /Profile picture/);
});

test("self profile endpoint is same-origin, scoped to current staff and audited", () => {
  const route = source("app/api/settings/profile/route.ts");
  const writer = source("lib/webos/profileSettings.ts");

  assert.match(route, /isAllowedRequestOrigin/);
  assert.match(route, /requireCurrentAccessContext/);
  assert.match(route, /updateOwnProfile/);

  assert.match(writer, /withMutationLock\(`staff-profile:\$\{staffId\}`/);
  assert.match(writer, /Full_Name/);
  assert.match(writer, /Phone/);
  assert.match(writer, /profile\.update_self/);
  assert.match(writer, /20_Data_Audit/);
  assert.match(writer, /PROFILE_PHONE_DUPLICATE/);
  assert.doesNotMatch(writer, /Salary:/);
  assert.doesNotMatch(writer, /Role:/);
  assert.doesNotMatch(writer, /Department_Access:/);
});

test("account entry points link directly to settings", () => {
  const more = source("app/(dashboard)/more/page.tsx");
  const menu = source("components/ProfileMenu.tsx");
  assert.match(more, /href="\/settings"/);
  assert.match(menu, /href="\/settings"/);
});
