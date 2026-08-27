import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVER_KEY_HASH =
  "efbaa7cde590048b656a566db1e0a8b09c8ad4d3b251c62116949de8eabf3027";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_LOCK_CONFIG_MISSING");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const METHODS = new Set([
  "acquire_distributed_lock",
  "renew_distributed_lock",
  "release_distributed_lock",
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(request: Request): Promise<boolean> {
  const key = request.headers.get("x-relife-lock-key")?.trim() || "";
  if (!key) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key)
  );
  return hex(digest) === SERVER_KEY_HASH;
}

function paramsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ data: null, error: { message: "METHOD_NOT_ALLOWED" } }, 405);
  }
  if (!(await authorized(request))) {
    return json({ data: null, error: { message: "ACCESS_DENIED" } }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const method = String(body.method || "").trim();
    if (!METHODS.has(method)) {
      return json({ data: null, error: { message: "INVALID_LOCK_METHOD" } }, 400);
    }

    const params = paramsObject(body.params);
    const { data, error } = await supabase.rpc(method, params);
    if (error) {
      console.error("relife-mutation-lock RPC failed", method, error.message);
      return json({ data: null, error: { message: error.message } }, 502);
    }

    return json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LOCK_EDGE_FAILED";
    console.error("relife-mutation-lock", message);
    return json({ data: null, error: { message } }, 500);
  }
});
