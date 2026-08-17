import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "relife-patient-reports";
// Fingerprint only. The actual report-storage key stays in Render secrets.
const SERVER_KEY_HASH = "f5ca72581718d3bab445289f606e373eb1c6129b3dd276e5c2eb8bc7c9adbac8";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_STORAGE_CONFIG_MISSING");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(request: Request) {
  const key = request.headers.get("x-relife-report-key")?.trim() || "";
  if (!key) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key)
  );
  return hex(digest) === SERVER_KEY_HASH;
}

function validPath(value: unknown): string {
  const path = String(value ?? "").trim();
  if (!path || path.length > 500 || path.includes("\\") || path.includes("..")) {
    throw new Error("INVALID_STORAGE_PATH");
  }
  const parts = path.split("/");
  if (
    parts.length < 4 ||
    parts.some((part) => !/^[A-Za-z0-9._-]{1,180}$/.test(part))
  ) {
    throw new Error("INVALID_STORAGE_PATH");
  }
  if (parts[0] !== "RELIFE-PHYSIO" && parts[0] !== "RELIFE-DENTAL") {
    throw new Error("INVALID_STORAGE_PATH");
  }
  return path;
}

Deno.serve(async (request: Request) => {
  if (!(await authorized(request))) {
    return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const path = validPath(url.searchParams.get("path"));
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) {
        console.error(
          "Report storage download failed",
          path,
          error?.message || "missing"
        );
        return json({ ok: false, error: "REPORT_OBJECT_NOT_FOUND" }, 404);
      }
      return new Response(await data.arrayBuffer(), {
        status: 200,
        headers: {
          "content-type": data.type || "application/octet-stream",
          "content-length": String(data.size),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const path = validPath(form.get("path"));
      const file = form.get("file");
      if (!(file instanceof File)) {
        return json({ ok: false, error: "REPORT_FILE_REQUIRED" }, 400);
      }
      if (file.size < 1 || file.size > MAX_BYTES) {
        return json({ ok: false, error: "REPORT_FILE_SIZE_INVALID" }, 400);
      }
      const mime = String(file.type || "application/octet-stream").toLowerCase();
      if (!ALLOWED_MIME.has(mime)) {
        return json({ ok: false, error: "REPORT_FILE_TYPE_INVALID" }, 400);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const { data, error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: mime,
        upsert: false,
      });
      if (error) {
        console.error("Report storage upload failed", path, error.message);
        return json({ ok: false, error: "REPORT_STORAGE_UPLOAD_FAILED" }, 502);
      }
      return json({ ok: true, path: data.path });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (String(body.action || "") !== "delete") {
      return json({ ok: false, error: "INVALID_ACTION" }, 400);
    }
    const path = validPath(body.path);
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      console.error("Report storage delete failed", path, error.message);
      return json({ ok: false, error: "REPORT_STORAGE_DELETE_FAILED" }, 502);
    }
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPORT_STORAGE_FAILED";
    const status = message === "INVALID_STORAGE_PATH" ? 400 : 500;
    console.error("Report storage edge failed", message);
    return json({ ok: false, error: message }, status);
  }
});
