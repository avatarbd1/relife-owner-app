import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "app/api/internal/legacy-media-migration/route.ts",
  "utf8"
);

test("legacy media migration is bounded and guarded", () => {
  assert.match(source, /const MAX_BATCH = 10/);
  assert.match(source, /LEGACY_MEDIA_MIGRATION_KEY/);
  assert.match(source, /x-relife-migration-key/);
  assert.match(source, /export async function POST/);
  assert.doesNotMatch(source, /export async function GET/);
});

test("legacy media migration preserves Telegram source and verifies storage before sheet mutation", () => {
  assert.match(source, /File_Telegram_ID/);
  assert.match(source, /REPORT_STORAGE_VERIFY_SIZE_MISMATCH/);
  const verifyPosition = source.indexOf("REPORT_STORAGE_VERIFY_SIZE_MISMATCH");
  const sheetWritePosition = source.indexOf("await updateSheetValues(");
  assert.ok(verifyPosition >= 0);
  assert.ok(sheetWritePosition > verifyPosition);
  assert.doesNotMatch(source, /File_Telegram_ID[^\n]*updateSheetValues/);
});

test("legacy media migration does not overwrite an existing drive or external link", () => {
  assert.match(source, /const driveLink = normalize\(row\[driveLinkIdx\]\)/);
  assert.match(source, /return Boolean\(reportId && fileId && !driveLink\)/);
  assert.match(source, /Never overwrite an existing external\/Drive link/);
});

test("legacy media destination remains canonical private storage", () => {
  assert.match(source, /relife-patient-reports/);
  assert.match(source, /supabase:\/\//);
  assert.match(source, /REPORT_STORAGE_EDGE_SECRET/);
  assert.match(source, /LEGACY_MEDIA_MIGRATION_ORGANIZATION_ID/);
  assert.match(source, /LEGACY_MEDIA_MIGRATION_CLINIC_ID/);
});

test("migration route does not hardcode Tenant 1 UUIDs", () => {
  assert.doesNotMatch(source, /9673c610-1369-4825-b6e9-5a22cb4ba138/);
  assert.doesNotMatch(source, /5a1793b4-b3f9-41b5-84a4-1920be5dc1b8/);
});
