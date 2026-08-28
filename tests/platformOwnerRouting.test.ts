import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("root routes platform authority before clinic workspace", async () => {
  const root = await source("app/page.tsx");
  const platformCheck = root.indexOf("if (await isCurrentPlatformOwner())");
  const platformRedirect = root.indexOf('redirect("/platform")');
  const tenantRedirect = root.indexOf('redirect("/home")');

  assert.ok(platformCheck >= 0, "root must check platform authority");
  assert.ok(platformRedirect > platformCheck, "platform authority must route to /platform");
  assert.ok(tenantRedirect > platformRedirect, "tenant fallback must happen after platform routing");
});

test("tenant dashboard never resolves a platform owner as clinic staff", async () => {
  const layout = await source("app/(dashboard)/layout.tsx");
  const platformCheck = layout.indexOf("if (await isCurrentPlatformOwner())");
  const platformRedirect = layout.indexOf('redirect("/platform")');
  const tenantResolution = layout.indexOf("const current = await requireCurrentTenantAccessContext()");

  assert.ok(platformCheck >= 0, "dashboard must check platform authority");
  assert.ok(platformRedirect > platformCheck, "platform authority must leave the tenant dashboard");
  assert.ok(tenantResolution > platformRedirect, "tenant resolution must happen only after platform owner redirect");
  assert.equal(layout.includes("Promise.all([\n    requireCurrentTenantAccessContext()"), false);
});

test("platform workspace does not present the platform owner as clinic staff", async () => {
  const page = await source("app/platform/page.tsx");
  assert.match(page, /Global platform authority · no clinic tenant binding/);
  assert.equal(page.includes("Signed in as {owner.staffId}"), false);
});
