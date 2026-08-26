async function runMigrationBatch(
  POST: (request: Request) => Promise<Response>,
  key: string,
  limit: number
): Promise<{ response: Response; text: string }> {
  const request = new Request("http://internal/legacy-media-migration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relife-migration-key": key,
    },
    body: JSON.stringify({ department: "Physio", limit }),
  });
  const response = await POST(request);
  const text = await response.text();
  return { response, text };
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const mode = process.env.LEGACY_MEDIA_MIGRATION_RUN_ON_BOOT?.trim();

  // Startup instrumentation is diagnostic-only. Bulk legacy media migration
  // must be invoked outside the app boot path so it cannot delay readiness.
  if (mode !== "physio-smoke") return;

  const tokenEnvNames = Object.keys(process.env)
    .filter((name) => /telegram|bot.*token|token.*bot/i.test(name))
    .sort();
  console.log("LEGACY_MEDIA_TOKEN_ENV_NAMES", JSON.stringify(tokenEnvNames));

  const key = process.env.LEGACY_MEDIA_MIGRATION_KEY?.trim();
  if (!key) {
    console.error("Legacy media startup smoke skipped: migration key missing");
    return;
  }

  const { POST } = await import(
    "./app/api/internal/legacy-media-migration/route"
  );

  try {
    const { response, text } = await runMigrationBatch(POST, key, 1);
    console.log(
      "LEGACY_MEDIA_STARTUP_SMOKE_RESULT",
      response.status,
      text.slice(0, 2000)
    );
  } catch (error) {
    console.error("LEGACY_MEDIA_STARTUP_SMOKE_FAILED", error);
  }
}
