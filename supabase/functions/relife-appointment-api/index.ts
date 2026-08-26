import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

const SERVER_KEY_HASH = "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe";
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const ACTIVE = ["scheduled", "received", "arrived", "waiting", "in treatment"];
const BEDS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);

type Tenant = { organizationId: string; clinicId: string };
type PlanStep = {
  sequence: number;
  name: string;
  resourceId: string;
  resourceName: string;
  durationMin: number;
  startMinute: number;
  endMinute: number;
};
type BookingPlan = {
  patientId: string;
  date: string;
  startMinute: number;
  therapist: string;
  bedId: string;
  gender: string;
  roomId: string;
  modalities: string[];
  totalDurationMin: number;
  timeline: PlanStep[];
  remarks: string;
};
type Conflict = { type: string; message: string; resourceId?: string };

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return norm(value).toLowerCase();
}

function validDate(value: unknown) {
  const text = norm(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("INVALID_DATE");
  return text;
}

function validRequestId(value: unknown) {
  const text = norm(value);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(text)) throw new Error("INVALID_REQUEST_ID");
  return text;
}

function overlaps(a1: number, a2: number, b1: number, b2: number) {
  return a1 < b2 && a2 > b1;
}

function roomForBed(id: string) {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  if (id === "TRACTION-BED") return "Traction Room";
  return "";
}

function minutesToTime(value: number) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new Error("INVALID_PLAN_TIME");
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}:00`;
}

function bookingPlan(value: unknown): BookingPlan {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const patientId = norm(raw.patientId);
  const date = validDate(raw.date);
  const startMinute = Number(raw.startMinute);
  const therapist = norm(raw.therapist);
  const bedId = norm(raw.bedId);
  const gender = norm(raw.gender);
  const roomId = norm(raw.roomId);
  const totalDurationMin = Number(raw.totalDurationMin);
  const remarks = norm(raw.remarks);
  const modalities = Array.isArray(raw.modalities) ? raw.modalities.map(String).map(norm).filter(Boolean) : [];
  const rawTimeline = Array.isArray(raw.timeline) ? raw.timeline : [];

  if (!patientId || !therapist || !BEDS.has(bedId)) throw new Error("INVALID_BOOKING_PLAN");
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 1440) throw new Error("INVALID_TIME");
  if (!Number.isInteger(totalDurationMin) || totalDurationMin <= 0 || totalDurationMin > 480) {
    throw new Error("INVALID_DURATION");
  }
  if (startMinute + totalDurationMin > 1440) throw new Error("INVALID_PLAN_TIME");
  if (roomForBed(bedId) !== roomId) throw new Error("INVALID_ROOM");
  if (rawTimeline.length < 1 || rawTimeline.length > 50) throw new Error("INVALID_TIMELINE");

  let cursor = startMinute;
  const timeline: PlanStep[] = rawTimeline.map((item, index) => {
    const step = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const sequence = Number(step.sequence);
    const name = norm(step.name);
    const resourceId = norm(step.resourceId);
    const resourceName = norm(step.resourceName);
    const durationMin = Number(step.durationMin);
    const stepStart = Number(step.startMinute);
    const stepEnd = Number(step.endMinute);
    if (
      sequence !== index + 1 ||
      !name ||
      !Number.isInteger(durationMin) ||
      durationMin <= 0 ||
      !Number.isInteger(stepStart) ||
      !Number.isInteger(stepEnd) ||
      stepStart !== cursor ||
      stepEnd !== stepStart + durationMin
    ) {
      throw new Error("INVALID_TIMELINE");
    }
    cursor = stepEnd;
    return {
      sequence,
      name,
      resourceId,
      resourceName,
      durationMin,
      startMinute: stepStart,
      endMinute: stepEnd,
    };
  });
  if (cursor !== startMinute + totalDurationMin) throw new Error("INVALID_TIMELINE_DURATION");

  return {
    patientId,
    date,
    startMinute,
    therapist,
    bedId,
    gender,
    roomId,
    modalities: [...new Set(modalities)],
    totalDurationMin,
    timeline,
    remarks,
  };
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(req: Request) {
  const key = req.headers.get("x-relife-server-key") || "";
  return Boolean(key) && (await sha256Hex(key)) === SERVER_KEY_HASH;
}

async function resolveTenant(executor: typeof sql, body: Record<string, unknown>): Promise<Tenant> {
  const organizationSlug = norm(body.organizationSlug || DEFAULT_ORGANIZATION_SLUG);
  const clinicSlug = norm(body.clinicSlug || DEFAULT_CLINIC_SLUG);
  const rows = await executor`
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
  return {
    organizationId: norm(rows[0].organization_id),
    clinicId: norm(rows[0].clinic_id),
  };
}

async function patientForPlan(executor: typeof sql, tenant: Tenant, plan: BookingPlan) {
  const rows = await executor`
    select * from relife.patient_cache
    where organization_id=${tenant.organizationId}::uuid
      and clinic_id=${tenant.clinicId}::uuid
      and patient_id=${plan.patientId}
      and department='Physio'
      and lower(status) <> 'inactive'
    limit 1
  `;
  return rows[0] || null;
}

async function checkPlan(
  executor: typeof sql,
  tenant: Tenant,
  plan: BookingPlan,
  patient: Record<string, unknown>
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const gender = norm(patient.gender);
  if (!gender) {
    conflicts.push({ type: "gender_required", message: "Patient gender is required before bed allocation." });
    return conflicts;
  }
  if (plan.gender && lower(plan.gender) !== lower(gender)) {
    conflicts.push({ type: "gender_rule", message: "Patient gender changed after validation. Refresh and validate again." });
  }

  const resourceIds = [...new Set(plan.timeline.map((step) => step.resourceId).filter(Boolean))];
  if (resourceIds.length > 0) {
    const resources = await executor`
      select resource_id from relife.chamber_resources
      where organization_id=${tenant.organizationId}::uuid
        and clinic_id=${tenant.clinicId}::uuid
        and department='Physio'
        and enabled=true
        and resource_id = any(${resourceIds})
    `;
    const available = new Set(resources.map((row) => norm(row.resource_id)));
    for (const resourceId of resourceIds) {
      if (!available.has(resourceId)) {
        conflicts.push({
          type: "schema",
          resourceId,
          message: `${resourceId} is not an enabled Chamber resource.`,
        });
      }
    }
  }

  const existing = await executor`
    select id, patient_id, patient_name, gender, bed_id,
           extract(hour from start_time)::int * 60 + extract(minute from start_time)::int as start_minute,
           expected_duration_min
    from relife.appointments
    where organization_id=${tenant.organizationId}::uuid
      and clinic_id=${tenant.clinicId}::uuid
      and date=${plan.date}::date
      and department='Physio'
      and lower(status)=any(${ACTIVE})
  `;
  const planEnd = plan.startMinute + plan.totalDurationMin;
  for (const row of existing) {
    const otherStart = Number(row.start_minute);
    const otherEnd = otherStart + Math.max(1, Number(row.expected_duration_min || 30));
    if (!overlaps(plan.startMinute, planEnd, otherStart, otherEnd)) continue;
    if (norm(row.patient_id) === plan.patientId) {
      conflicts.push({ type: "duplicate", message: "Patient already has an overlapping appointment." });
      continue;
    }
    if (norm(row.bed_id) === plan.bedId) {
      conflicts.push({ type: "bed_busy", message: `${plan.bedId} is already occupied during this treatment window.` });
      continue;
    }
    if (
      plan.bedId !== "TRACTION-BED" &&
      norm(row.bed_id) !== "TRACTION-BED" &&
      roomForBed(norm(row.bed_id)) === plan.roomId &&
      norm(row.gender) &&
      lower(row.gender) !== lower(gender)
    ) {
      conflicts.push({ type: "gender_rule", message: `${plan.roomId} is already reserved for ${norm(row.gender)} patients in this window.` });
    }
  }

  const reservations = await executor`
    select resource_id, start_minute, end_minute, patient_name
    from relife.machine_reservations
    where organization_id=${tenant.organizationId}::uuid
      and clinic_id=${tenant.clinicId}::uuid
      and date=${plan.date}::date
      and lower(status) in ('scheduled','active')
  `;
  for (const step of plan.timeline) {
    if (!step.resourceId) continue;
    const busy = reservations.find(
      (row) =>
        norm(row.resource_id) === step.resourceId &&
        overlaps(step.startMinute, step.endMinute, Number(row.start_minute), Number(row.end_minute))
    );
    if (busy) {
      conflicts.push({
        type: "machine_busy",
        resourceId: step.resourceId,
        message: `${step.resourceName || step.resourceId} is busy with ${norm(busy.patient_name) || "another patient"}.`,
      });
    }
  }

  return [
    ...new Map(conflicts.map((item) => [`${item.type}:${item.resourceId || ""}:${item.message}`, item])).values(),
  ];
}

async function logConflict(tenant: Tenant, plan: BookingPlan, actorId: string, conflicts: Conflict[]) {
  const conflictId = `BCF${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const primary = conflicts[0];
  await sql`
    insert into relife.booking_conflicts(
      id, patient_id, patient_name, date, start_time, therapist,
      conflict_type, resource_id, detail, modalities, expected_duration_min,
      actor_id, department, organization_id, clinic_id
    ) values(
      ${conflictId}, ${plan.patientId}, '', ${plan.date}::date,
      ${minutesToTime(plan.startMinute)}::time, ${plan.therapist},
      ${primary?.type || 'booking_conflict'}, ${primary?.resourceId || ''},
      ${conflicts.map((item) => item.message).join(' | ')},
      ${JSON.stringify(plan.modalities)}::jsonb, ${plan.totalDurationMin},
      ${actorId}, 'Physio', ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid
    )
  `;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!(await authorized(req))) return response({ ok: false, error: "ACCESS_DENIED" }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = norm(body.action || "health");
    const tenant = await resolveTenant(sql, body);

    if (action === "health") {
      const rows = await sql`select now() as now`;
      return response({ ok: true, db: true, tenant, now: rows[0]?.now });
    }

    if (action === "validate_booking_plan") {
      const plan = bookingPlan(body.plan);
      const patient = await patientForPlan(sql, tenant, plan);
      if (!patient) return response({ ok: false, error: "PATIENT_NOT_FOUND" }, 404);
      const conflicts = await checkPlan(sql, tenant, plan, patient);
      return response({ ok: true, conflicts });
    }

    if (action === "create_validated_booking") {
      const plan = bookingPlan(body.plan);
      const actorId = norm(body.actorId);
      const requestId = validRequestId(body.requestId);
      if (!actorId) return response({ ok: false, error: "ACTOR_REQUIRED" }, 400);

      const result = await sql.begin(async (tx) => {
        const replay = await tx`
          select id, timeline_id from relife.appointments
          where organization_id=${tenant.organizationId}::uuid and clinic_id=${tenant.clinicId}::uuid and request_id=${requestId}
          limit 1
        `;
        if (replay[0]) {
          return {
            appointmentId: norm(replay[0].id),
            timelineId: norm(replay[0].timeline_id),
            duplicate: true,
            conflicts: [] as Conflict[],
          };
        }

        await tx`select pg_advisory_xact_lock(hashtext(${`relife-appointment:${tenant.clinicId}:${plan.date}`}))`;
        const patient = await patientForPlan(tx as typeof sql, tenant, plan);
        if (!patient) return { conflicts: [{ type: "patient", message: "Patient is not synced to the appointment database." }] as Conflict[] };
        const conflicts = await checkPlan(tx as typeof sql, tenant, plan, patient);
        if (conflicts.length > 0) return { conflicts };

        const appointmentId = `APW${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
        const timelineId = `TLW${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
        const gender = norm(patient.gender);
        await tx`
          insert into relife.appointments(
            id, date, start_time, patient_id, patient_name, gender, therapist,
            status, bed_id, modalities, expected_duration_min, timeline_id,
            remarks, department, created_by, updated_by, organization_id, clinic_id,
            request_id, created_at, updated_at
          ) values(
            ${appointmentId}, ${plan.date}::date, ${minutesToTime(plan.startMinute)}::time,
            ${plan.patientId}, ${norm(patient.full_name)}, ${gender}, ${plan.therapist},
            'Scheduled', ${plan.bedId}, ${JSON.stringify(plan.modalities)}::jsonb,
            ${plan.totalDurationMin}, ${timelineId}, ${plan.remarks}, 'Physio',
            ${actorId}, ${actorId}, ${tenant.organizationId}::uuid,
            ${tenant.clinicId}::uuid, ${requestId}, now(), now()
          )
        `;

        for (const step of plan.timeline) {
          const stepId = `TLS${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
          await tx`
            insert into relife.treatment_timeline(
              id, timeline_id, appointment_id, patient_id, patient_name, date,
              bed_id, sequence, step_name, resource_id, resource_name,
              duration_min, start_minute, end_minute, start_time, end_time,
              status, created_by, organization_id, clinic_id, created_at, updated_at
            ) values(
              ${stepId}, ${timelineId}, ${appointmentId}, ${plan.patientId},
              ${norm(patient.full_name)}, ${plan.date}::date, ${plan.bedId},
              ${step.sequence}, ${step.name}, ${step.resourceId}, ${step.resourceName},
              ${step.durationMin}, ${step.startMinute}, ${step.endMinute},
              ${minutesToTime(step.startMinute)}::time, ${minutesToTime(step.endMinute)}::time,
              'Planned', ${actorId}, ${tenant.organizationId}::uuid,
              ${tenant.clinicId}::uuid, now(), now()
            )
          `;
          if (step.resourceId) {
            const reservationId = `RSV${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
            await tx`
              insert into relife.machine_reservations(
                id, appointment_id, patient_id, patient_name, date, bed_id,
                resource_id, resource_name, sequence, start_minute, end_minute,
                start_time, end_time, duration_min, status, created_by,
                organization_id, clinic_id, created_at, updated_at
              ) values(
                ${reservationId}, ${appointmentId}, ${plan.patientId}, ${norm(patient.full_name)},
                ${plan.date}::date, ${plan.bedId}, ${step.resourceId}, ${step.resourceName},
                ${step.sequence}, ${step.startMinute}, ${step.endMinute},
                ${minutesToTime(step.startMinute)}::time, ${minutesToTime(step.endMinute)}::time,
                ${step.durationMin}, 'Scheduled', ${actorId}, ${tenant.organizationId}::uuid,
                ${tenant.clinicId}::uuid, now(), now()
              )
            `;
          }
        }

        await tx`
          insert into relife.audit_events(
            organization_id, clinic_id, request_id, actor_id, action,
            entity_type, entity_id, patient_id, payload
          ) values(
            ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid, ${requestId},
            ${actorId}, 'APPOINTMENT_CREATED', 'Appointment', ${appointmentId},
            ${plan.patientId}, ${JSON.stringify({
              date: plan.date,
              startMinute: plan.startMinute,
              therapist: plan.therapist,
              bedId: plan.bedId,
              durationMin: plan.totalDurationMin,
              timelineId,
              modalities: plan.modalities,
            })}::jsonb
          )
        `;

        return { appointmentId, timelineId, duplicate: false, conflicts: [] as Conflict[] };
      });

      if (result.conflicts?.length) {
        await logConflict(tenant, plan, actorId, result.conflicts);
        return response(
          {
            ok: false,
            error: "APPOINTMENT_CONFLICT",
            conflictType: result.conflicts[0]?.type || "database",
            detail: result.conflicts[0]?.message || "Booking conflict",
            conflicts: result.conflicts,
          },
          409
        );
      }

      return response({
        ok: true,
        appointmentId: result.appointmentId,
        timelineId: result.timelineId,
        duplicate: result.duplicate,
      });
    }

    return response({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("relife-appointment-api", error);
    const message = error instanceof Error ? error.message : "EDGE_FAILED";
    const status = [
      "INVALID_DATE",
      "INVALID_REQUEST_ID",
      "INVALID_BOOKING_PLAN",
      "INVALID_TIME",
      "INVALID_DURATION",
      "INVALID_PLAN_TIME",
      "INVALID_ROOM",
      "INVALID_TIMELINE",
      "INVALID_TIMELINE_DURATION",
    ].includes(message) ? 400 : 500;
    return response({ ok: false, error: message }, status);
  }
});
