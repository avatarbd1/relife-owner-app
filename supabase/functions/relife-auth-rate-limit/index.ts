import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const SERVER_KEY_HASH =
  "efbaa7cde590048b656a566db1e0a8b09c8ad4d3b251c62116949de8eabf3027";
const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;

type Body = { action?: unknown; clientKey?: unknown };

type State = {
  allowed: boolean;
  blocked: boolean;
  retryAfterSeconds: number;
  remainingAttempts: number;
};

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

function validClientKey(value: unknown): string | null {
  const key = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(key) ? key : null;
}

function secondsUntil(value: unknown): number {
  if (!value) return 0;
  const target = new Date(String(value)).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

async function reserve(clientKey: string): Promise<State> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${clientKey}, 0))`;
    const rows = await tx`
      select attempt_count, window_started_at, locked_until
      from relife.owner_login_throttle
      where client_key = ${clientKey}
      for update
    `;
    const current = rows[0];
    const retryAfter = secondsUntil(current?.locked_until);
    if (retryAfter > 0) {
      return {
        allowed: false,
        blocked: true,
        retryAfterSeconds: retryAfter,
        remainingAttempts: 0,
      };
    }

    const now = Date.now();
    const windowStarted = current?.window_started_at
      ? new Date(String(current.window_started_at)).getTime()
      : 0;
    const windowExpired =
      !Number.isFinite(windowStarted) ||
      windowStarted <= 0 ||
      now - windowStarted >= WINDOW_SECONDS * 1000;
    const previousCount = windowExpired ? 0 : Number(current?.attempt_count || 0);

    if (previousCount >= MAX_ATTEMPTS) {
      const locked = new Date(now + LOCK_SECONDS * 1000).toISOString();
      await tx`
        insert into relife.owner_login_throttle(
          client_key, attempt_count, window_started_at, locked_until, updated_at
        ) values (
          ${clientKey}, ${previousCount}, now(), ${locked}::timestamptz, now()
        )
        on conflict (client_key) do update set
          locked_until = excluded.locked_until,
          updated_at = now()
      `;
      return {
        allowed: false,
        blocked: true,
        retryAfterSeconds: LOCK_SECONDS,
        remainingAttempts: 0,
      };
    }

    const nextCount = previousCount + 1;
    await tx`
      insert into relife.owner_login_throttle(
        client_key, attempt_count, window_started_at, locked_until, updated_at
      ) values (
        ${clientKey}, ${nextCount}, now(), null, now()
      )
      on conflict (client_key) do update set
        attempt_count = ${nextCount},
        window_started_at = case
          when ${windowExpired} then now()
          else relife.owner_login_throttle.window_started_at
        end,
        locked_until = null,
        updated_at = now()
    `;

    return {
      allowed: true,
      blocked: false,
      retryAfterSeconds: 0,
      remainingAttempts: Math.max(0, MAX_ATTEMPTS - nextCount),
    };
  });
}

async function recordFailure(clientKey: string): Promise<State> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${clientKey}, 0))`;
    const rows = await tx`
      select attempt_count, locked_until
      from relife.owner_login_throttle
      where client_key = ${clientKey}
      for update
    `;
    const current = rows[0];
    if (!current) {
      return {
        allowed: true,
        blocked: false,
        retryAfterSeconds: 0,
        remainingAttempts: MAX_ATTEMPTS,
      };
    }
    const existingRetry = secondsUntil(current.locked_until);
    if (existingRetry > 0) {
      return {
        allowed: false,
        blocked: true,
        retryAfterSeconds: existingRetry,
        remainingAttempts: 0,
      };
    }
    const count = Number(current.attempt_count || 0);
    if (count < MAX_ATTEMPTS) {
      return {
        allowed: true,
        blocked: false,
        retryAfterSeconds: 0,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - count),
      };
    }

    const locked = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
    await tx`
      update relife.owner_login_throttle
      set locked_until = ${locked}::timestamptz, updated_at = now()
      where client_key = ${clientKey}
    `;
    return {
      allowed: false,
      blocked: true,
      retryAfterSeconds: LOCK_SECONDS,
      remainingAttempts: 0,
    };
  });
}

async function clearSuccess(clientKey: string): Promise<State> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${clientKey}, 0))`;
    await tx`delete from relife.owner_login_throttle where client_key = ${clientKey}`;
    return {
      allowed: true,
      blocked: false,
      retryAfterSeconds: 0,
      remainingAttempts: MAX_ATTEMPTS,
    };
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!(await authorized(request))) {
    return json({ ok: false, error: "ACCESS_DENIED" }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const action = String(body.action ?? "").trim();
    const clientKey = validClientKey(body.clientKey);
    if (!clientKey || !["reserve", "failure", "success"].includes(action)) {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }

    const state =
      action === "reserve"
        ? await reserve(clientKey)
        : action === "failure"
          ? await recordFailure(clientKey)
          : await clearSuccess(clientKey);
    return json({ ok: true, ...state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUTH_RATE_LIMIT_FAILED";
    console.error("relife-auth-rate-limit", message);
    return json({ ok: false, error: "AUTH_RATE_LIMIT_FAILED" }, 500);
  }
});
