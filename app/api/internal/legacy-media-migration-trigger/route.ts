import "server-only";

import { POST as migrateLegacyMedia } from "../legacy-media-migration/route";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim() || "";
  const department = url.searchParams.get("department") || "All";
  const limit = Number(url.searchParams.get("limit") || "1");

  const proxy = new Request(
    new URL("../legacy-media-migration", request.url),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-migration-key": key,
      },
      body: JSON.stringify({ department, limit }),
    }
  );

  return migrateLegacyMedia(proxy);
}
