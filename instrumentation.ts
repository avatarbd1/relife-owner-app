type Department = "Physio" | "Dental";

type MigrationPayload = {
  ok?: boolean;
  migrated?: number;
  failed?: number;
  results?: Array<{ status?: string; detail?: string }>;
};

async function runMigrationBatch(
  POST: (request: Request) => Promise<Response>,
  key: string,
  department: Department,
  limit: number
): Promise<{ response: Response; payload: MigrationPayload; text: string }> {
  const request = new Request("http://internal/legacy-media-migration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relife-migration-key": key,
    },
    body: JSON.stringify({ department, limit }),
  });
  const response = await POST(request);
  const text = await response.text();
  let payload: MigrationPayload = {};
  try {
    payload = JSON.parse(text) as MigrationPayload;
  } catch {
    // Keep the raw response for fail-closed logging below.
  }
  return { response, payload, text };
}

async function runBulkDepartment(
  POST: (request: Request) => Promise<Response>,
  key: string,
  department: Department
): Promise<void> {
  const MAX_BATCHES = 100;
  for (let batch = 1; batch <= MAX_BATCHES; batch += 1) {
    const { response, payload, text } = await runMigrationBatch(
      POST,
      key,
      department,
      10
    );
    const migrated = Number(payload.migrated || 0);
    const failed = Number(payload.failed || 0);
    console.log(
      "LEGACY_MEDIA_BULK_BATCH_RESULT",
      JSON.stringify({ department, batch, status: response.status, migrated, failed })
    );

    if (!response.ok || failed > 0) {
      console.error(
        "LEGACY_MEDIA_BULK_STOPPED",
        department,
        batch,
        text.slice(0, 2000)
      );
      return;
    }
    if (migrated === 0) {
      console.log("LEGACY_MEDIA_BULK_COMPLETE", department, batch - 1);
      return;
    }
  }
  console.error("LEGACY_MEDIA_BULK_STOPPED_MAX_BATCHES", department, MAX_BATCHES);
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const mode = process.env.LEGACY_MEDIA_MIGRATION_RUN_ON_BOOT?.trim();
  if (mode !== "physio-smoke" && mode !== "all-bulk") return;

  const tokenEnvNames = Object.keys(process.env)
    .filter((name) => /telegram|bot.*token|token.*bot/i.test(name))
    .sort();
  console.log("LEGACY_MEDIA_TOKEN_ENV_NAMES", JSON.stringify(tokenEnvNames));

  const key = process.env.LEGACY_MEDIA_MIGRATION_KEY?.trim();
  if (!key) {
    console.error("Legacy media startup migration skipped: migration key missing");
    return;
  }

  const { POST } = await import(
    "./app/api/internal/legacy-media-migration/route"
  );

  try {
    if (mode === "physio-smoke") {
      const { response, text } = await runMigrationBatch(POST, key, "Physio", 1);
      console.log(
        "LEGACY_MEDIA_STARTUP_SMOKE_RESULT",
        response.status,
        text.slice(0, 2000)
      );
      return;
    }

    // Owner-approved legacy migration scope: Physio only. Dental must not run.
    await runBulkDepartment(POST, key, "Physio");
  } catch (error) {
    console.error("LEGACY_MEDIA_STARTUP_MIGRATION_FAILED", error);
  }
}
