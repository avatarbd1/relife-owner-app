import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

// Same server-key fingerprint as the existing Chamber Edge boundary.
const SERVER_KEY_HASH = "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe";
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const BEDS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);
const ACTIVE_APPOINTMENTS = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);

type Tenant = { organizationId: string; clinicId: string };

type TxResult = {
  ok?: true;
  error?: string;
  status?: number;
  session?: Record<string, unknown>;
  duplicate?: boolean;
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function roomForBed(id: string): string {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  return "Traction Room";
}

function statusFor(message: string): number {
  if (["APPOINTMENT_NOT_FOUND", "CHAMBER_SESSION_NOT_FOUND", "STATION_NOT_FOUND", "RESOURCE_NOT_FOUND"].includes(message)) return 404;
  if (["INVALID_ACTION", "INVALID_STEP_DURATION", "CHAMBER_STEP_REQUIRED", "ACTOR_REQUIRED"].includes(message)) return 400;
  if (
    message.startsWith("CHAMBER_CAPACITY:") ||
    message.startsWith("RESOURCE_BUSY:") ||
    ["APPOINTMENT_NOT_ACTIVE", "PATIENT_GENDER_REQUIRED", "CHAMBER_SESSION_NOT_WAITING", "CHAMBER_SESSION_NOT_RUNNING", "CHAMBER_SESSION_COMPLETED"].includes(message)
  ) return 409;
  return 500;
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-relife-server-key") || "";
  if (!key) return false;
  return (await sha256Hex(key)) === SERVER_KEY_HASH;
}

async function resolveTenant(body: Record<string, unknown>): Promise<Tenant> {
  const organizationSlug = norm(body.organizationSlug || DEFAULT_ORGANIZATION_SLUG);
  const clinicSlug = norm(body.clinicSlug || DEFAULT_CLINIC_SLUG);
  const rows = await sql`
    select o.id::text as organization_id, c.id::text as clinic_id
    from relife.organizations o
    join relife.clinics c on c.organization_id=o.id
    where o.slug=${organizationSlug}
      and c.slug=${clinicSlug}
      and lower(o.status)='active'
      and lower(c.status)='active'
    limit 1
  `;
  if (!rows[0]) throw new Error("TENANT_NOT_FOUND");
  return { organizationId: norm(rows[0].organization_id), clinicId: norm(rows[0].clinic_id) };
}

function closeStep(row: Record<string, unknown>, endedAt: string): Array<Record<string, unknown>> {
  const current = Array.isArray(row.step_log) ? [...row.step_log] as Array<Record<string, unknown>> : [];
  const step = norm(row.current_step);
  const startedAt = norm(row.step_started_at);
  if (!step || !startedAt) return current;
  current.push({
    step,
    resourceId: norm(row.current_resource_id),
    startedAt,
    endedAt,
    plannedDurationMin: Number(row.step_duration_min || 0),
  });
  return current;
}

async function insertAudit(
  tx: postgres.TransactionSql<Record<string, unknown>>,
  tenant: Tenant,
  actorId: string,
  action: string,
  sessionId: string,
  patientId: string,
  payload: Record<string, unknown>
) {
  await tx`
    insert into relife.audit_events(
      organization_id, clinic_id, request_id, actor_id, action,
      entity_type, entity_id, patient_id, payload, created_at
    ) values(
      ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
      ${`CRT${crypto.randomUUID().replaceAll("-", "")}`}, ${actorId}, ${action},
      'ChamberSession', ${sessionId}, ${patientId}, ${JSON.stringify(payload)}::jsonb, now()
    )
  `;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!(await authorized(req))) return response({ ok: false, error: "ACCESS_DENIED" }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = norm(body.action || "health");
    const tenant = await resolveTenant(body);

    if (action === "health") {
      const rows = await sql`select now() as now`;
      return response({ ok: true, db: true, tenant, now: rows[0]?.now });
    }

    const actorId = norm(body.actorId);
    if (!actorId) return response({ ok: false, error: "ACTOR_REQUIRED" }, 400);

    if (action === "receive") {
      const appointmentId = norm(body.appointmentId);
      const result = await sql.begin(async (tx): Promise<TxResult> => {
        const appointments = await tx`
          select * from relife.appointments
          where clinic_id=${tenant.clinicId}::uuid and department='Physio' and id=${appointmentId}
          limit 1
        `;
        const appointment = appointments[0] as Record<string, unknown> | undefined;
        if (!appointment) return { error: "APPOINTMENT_NOT_FOUND", status: 404 };
        const date = norm(appointment.date).slice(0, 10);
        await tx`select pg_advisory_xact_lock(hashtext(${`relife-chamber-runtime:${tenant.clinicId}:${date}`}))`;

        const existing = await tx`
          select * from relife.chamber_sessions
          where clinic_id=${tenant.clinicId}::uuid and appointment_id=${appointmentId}
          limit 1
        `;
        if (existing[0]) return { ok: true, session: existing[0] as Record<string, unknown>, duplicate: true };
        if (!ACTIVE_APPOINTMENTS.has(norm(appointment.status).toLowerCase())) {
          return { error: "APPOINTMENT_NOT_ACTIVE", status: 409 };
        }

        const sessionId = `CHS${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
        const rows = await tx`
          insert into relife.chamber_sessions(
            id, appointment_id, date, patient_id, patient_name, gender, therapist,
            room_id, station_id, status, received_at, current_step,
            current_resource_id, step_duration_min, step_log, updated_by,
            organization_id, clinic_id, version, updated_at
          ) values(
            ${sessionId}, ${appointmentId}, ${appointment.date}::date,
            ${norm(appointment.patient_id)}, ${norm(appointment.patient_name)},
            ${norm(appointment.gender)}, ${norm(appointment.therapist)}, '', '',
            'Waiting', now(), '', '', 0, '[]'::jsonb, ${actorId},
            ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid, 1, now()
          ) returning *
        `;
        await tx`
          update relife.appointments
          set status='Arrived', updated_by=${actorId}, updated_at=now()
          where clinic_id=${tenant.clinicId}::uuid and id=${appointmentId}
        `;
        await insertAudit(tx, tenant, actorId, "chamber.receive", sessionId, norm(appointment.patient_id), { appointmentId, status: "Waiting" });
        return { ok: true, session: rows[0] as Record<string, unknown>, duplicate: false };
      });
      if (result.error) return response({ ok: false, error: result.error }, result.status || 500);
      return response({ ok: true, session: result.session, duplicate: result.duplicate });
    }

    if (action === "start") {
      const sessionId = norm(body.sessionId);
      const result = await sql.begin(async (tx): Promise<TxResult> => {
        const sessions = await tx`
          select s.*, a.bed_id as appointment_bed_id, a.status as appointment_status
          from relife.chamber_sessions s
          join relife.appointments a on a.id=s.appointment_id and a.clinic_id=s.clinic_id
          where s.clinic_id=${tenant.clinicId}::uuid and s.id=${sessionId}
          limit 1 for update
        `;
        const session = sessions[0] as Record<string, unknown> | undefined;
        if (!session) return { error: "CHAMBER_SESSION_NOT_FOUND", status: 404 };
        const date = norm(session.date).slice(0, 10);
        await tx`select pg_advisory_xact_lock(hashtext(${`relife-chamber-runtime:${tenant.clinicId}:${date}`}))`;
        if (norm(session.status) === "Completed") return { error: "CHAMBER_SESSION_COMPLETED", status: 409 };
        if (norm(session.status) === "In Treatment") return { ok: true, session, duplicate: true };
        if (norm(session.status) !== "Waiting") return { error: "CHAMBER_SESSION_NOT_WAITING", status: 409 };

        const gender = norm(session.gender);
        if (!gender) return { error: "PATIENT_GENDER_REQUIRED", status: 409 };
        const bedId = norm(session.appointment_bed_id);
        if (!BEDS.has(bedId)) return { error: "STATION_NOT_FOUND", status: 404 };
        const resources = await tx`
          select resource_id from relife.chamber_resources
          where clinic_id=${tenant.clinicId}::uuid and resource_type='Station'
            and enabled=true and resource_id=${bedId}
          limit 1
        `;
        if (!resources[0]) return { error: "STATION_NOT_FOUND", status: 404 };

        const occupied = await tx`
          select patient_name from relife.chamber_sessions
          where clinic_id=${tenant.clinicId}::uuid and date=${session.date}::date
            and status='In Treatment' and station_id=${bedId} and id<>${sessionId}
          limit 1
        `;
        if (occupied[0]) return { error: `CHAMBER_CAPACITY:STATION_BUSY:${bedId}`, status: 409 };

        const roomId = roomForBed(bedId);
        if (bedId !== "TRACTION-BED") {
          const roomConflict = await tx`
            select gender from relife.chamber_sessions
            where clinic_id=${tenant.clinicId}::uuid and date=${session.date}::date
              and status='In Treatment' and room_id=${roomId} and id<>${sessionId}
              and gender<>'' and lower(gender)<>${gender.toLowerCase()}
            limit 1
          `;
          if (roomConflict[0]) return { error: `CHAMBER_CAPACITY:ROOM_GENDER:${norm(roomConflict[0].gender)}`, status: 409 };
        }

        const rows = await tx`
          update relife.chamber_sessions
          set room_id=${roomId}, station_id=${bedId}, status='In Treatment',
              started_at=coalesce(started_at, now()),
              current_step=case when current_step='' then 'Treatment started' else current_step end,
              updated_by=${actorId}, updated_at=now(), version=version+1
          where clinic_id=${tenant.clinicId}::uuid and id=${sessionId}
          returning *
        `;
        await tx`
          update relife.appointments
          set status='In Treatment', updated_by=${actorId}, updated_at=now()
          where clinic_id=${tenant.clinicId}::uuid and id=${norm(session.appointment_id)}
        `;
        await insertAudit(tx, tenant, actorId, "chamber.start", sessionId, norm(session.patient_id), { stationId: bedId });
        return { ok: true, session: rows[0] as Record<string, unknown> };
      });
      if (result.error) return response({ ok: false, error: result.error }, result.status || 500);
      return response({ ok: true, session: result.session, duplicate: result.duplicate });
    }

    if (action === "step") {
      const sessionId = norm(body.sessionId);
      const step = norm(body.step);
      const resourceId = norm(body.resourceId);
      const requestedStationId = norm(body.stationId);
      const durationMin = Math.trunc(Number(body.durationMin || 0));
      if (!step) return response({ ok: false, error: "CHAMBER_STEP_REQUIRED" }, 400);
      if (!Number.isFinite(durationMin) || durationMin < 0 || durationMin > 180) {
        return response({ ok: false, error: "INVALID_STEP_DURATION" }, 400);
      }

      const result = await sql.begin(async (tx): Promise<TxResult> => {
        const sessions = await tx`
          select * from relife.chamber_sessions
          where clinic_id=${tenant.clinicId}::uuid and id=${sessionId}
          limit 1 for update
        `;
        const session = sessions[0] as Record<string, unknown> | undefined;
        if (!session) return { error: "CHAMBER_SESSION_NOT_FOUND", status: 404 };
        if (norm(session.status) !== "In Treatment") return { error: "CHAMBER_SESSION_NOT_RUNNING", status: 409 };
        const date = norm(session.date).slice(0, 10);
        await tx`select pg_advisory_xact_lock(hashtext(${`relife-chamber-runtime:${tenant.clinicId}:${date}`}))`;

        const stationId = requestedStationId || norm(session.station_id);
        if (!BEDS.has(stationId)) return { error: "STATION_NOT_FOUND", status: 404 };
        const gender = norm(session.gender);
        const roomId = roomForBed(stationId);
        const stationBusy = await tx`
          select patient_name from relife.chamber_sessions
          where clinic_id=${tenant.clinicId}::uuid and date=${session.date}::date
            and status='In Treatment' and station_id=${stationId} and id<>${sessionId}
          limit 1
        `;
        if (stationBusy[0]) return { error: `CHAMBER_CAPACITY:STATION_BUSY:${stationId}`, status: 409 };
        if (stationId !== "TRACTION-BED") {
          const roomConflict = await tx`
            select gender from relife.chamber_sessions
            where clinic_id=${tenant.clinicId}::uuid and date=${session.date}::date
              and status='In Treatment' and room_id=${roomId} and id<>${sessionId}
              and gender<>'' and lower(gender)<>${gender.toLowerCase()}
            limit 1
          `;
          if (roomConflict[0]) return { error: `CHAMBER_CAPACITY:ROOM_GENDER:${norm(roomConflict[0].gender)}`, status: 409 };
        }

        if (resourceId) {
          const resource = await tx`
            select resource_id from relife.chamber_resources
            where clinic_id=${tenant.clinicId}::uuid and resource_type='Machine'
              and enabled=true and resource_id=${resourceId}
            limit 1
          `;
          if (!resource[0]) return { error: "RESOURCE_NOT_FOUND", status: 404 };
          const busy = await tx`
            select patient_name from relife.chamber_sessions
            where clinic_id=${tenant.clinicId}::uuid and date=${session.date}::date
              and status='In Treatment' and current_resource_id=${resourceId} and id<>${sessionId}
            limit 1
          `;
          if (busy[0]) return { error: `RESOURCE_BUSY:${resourceId}:${norm(busy[0].patient_name)}`, status: 409 };
        }

        if (
          norm(session.current_step) === step &&
          norm(session.current_resource_id) === resourceId &&
          norm(session.station_id) === stationId &&
          Number(session.step_duration_min || 0) === durationMin
        ) {
          return { ok: true, session, duplicate: true };
        }

        const endedAt = new Date().toISOString();
        const log = closeStep(session, endedAt);
        const expected = durationMin > 0 ? new Date(Date.now() + durationMin * 60_000).toISOString() : null;
        const rows = await tx`
          update relife.chamber_sessions
          set room_id=${roomId}, station_id=${stationId}, step_log=${JSON.stringify(log)}::jsonb,
              current_step=${step}, current_resource_id=${resourceId}, step_started_at=now(),
              step_duration_min=${durationMin}, expected_release_at=${expected}::timestamptz,
              updated_by=${actorId}, updated_at=now(), version=version+1
          where clinic_id=${tenant.clinicId}::uuid and id=${sessionId}
          returning *
        `;
        await insertAudit(tx, tenant, actorId, "chamber.step.update", sessionId, norm(session.patient_id), { step, resourceId, stationId, durationMin });
        return { ok: true, session: rows[0] as Record<string, unknown> };
      });
      if (result.error) return response({ ok: false, error: result.error }, result.status || 500);
      return response({ ok: true, session: result.session, duplicate: result.duplicate });
    }

    if (action === "complete") {
      const sessionId = norm(body.sessionId);
      const result = await sql.begin(async (tx): Promise<TxResult> => {
        const sessions = await tx`
          select * from relife.chamber_sessions
          where clinic_id=${tenant.clinicId}::uuid and id=${sessionId}
          limit 1 for update
        `;
        const session = sessions[0] as Record<string, unknown> | undefined;
        if (!session) return { error: "CHAMBER_SESSION_NOT_FOUND", status: 404 };
        if (norm(session.status) === "Completed") return { ok: true, session, duplicate: true };
        if (norm(session.status) !== "In Treatment") return { error: "CHAMBER_SESSION_NOT_RUNNING", status: 409 };
        const date = norm(session.date).slice(0, 10);
        await tx`select pg_advisory_xact_lock(hashtext(${`relife-chamber-runtime:${tenant.clinicId}:${date}`}))`;

        const endedAt = new Date().toISOString();
        const log = closeStep(session, endedAt);
        const rows = await tx`
          update relife.chamber_sessions
          set status='Completed', step_log=${JSON.stringify(log)}::jsonb,
              completed_at=now(), current_resource_id='', expected_release_at=null,
              updated_by=${actorId}, updated_at=now(), version=version+1
          where clinic_id=${tenant.clinicId}::uuid and id=${sessionId}
          returning *
        `;
        await tx`
          update relife.appointments
          set status='Completed', updated_by=${actorId}, updated_at=now()
          where clinic_id=${tenant.clinicId}::uuid and id=${norm(session.appointment_id)}
        `;
        await tx`
          update relife.machine_reservations
          set status='Completed', updated_at=now()
          where clinic_id=${tenant.clinicId}::uuid and appointment_id=${norm(session.appointment_id)}
        `;
        await tx`
          update relife.treatment_timeline
          set status='Completed', updated_at=now()
          where clinic_id=${tenant.clinicId}::uuid and appointment_id=${norm(session.appointment_id)}
        `;
        await insertAudit(tx, tenant, actorId, "chamber.complete", sessionId, norm(session.patient_id), { steps: log.length });
        return { ok: true, session: rows[0] as Record<string, unknown> };
      });
      if (result.error) return response({ ok: false, error: result.error }, result.status || 500);
      return response({ ok: true, session: result.session, duplicate: result.duplicate });
    }

    return response({ ok: false, error: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error("relife-chamber-runtime-api", error);
    const message = error instanceof Error ? error.message : "EDGE_FAILED";
    return response({ ok: false, error: message }, statusFor(message));
  }
});
