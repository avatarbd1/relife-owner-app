import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
const sql = postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20 });

// Fingerprint only; the actual server key remains outside source control.
const SERVER_KEY_HASH = "50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe";
const DEFAULT_ORGANIZATION_SLUG = "relife";
const DEFAULT_CLINIC_SLUG = "amtali-main";
const ACTIVE = ["scheduled", "received", "arrived", "waiting", "in treatment"];
const BEDS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);

type SqlExecutor = typeof sql;
type Tenant = { organizationId: string; clinicId: string };

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function validDate(value: unknown) {
  const text = norm(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("INVALID_DATE");
  return text;
}

function validRequestId(value: unknown) {
  const text = norm(value);
  if (!text) return `CBK${crypto.randomUUID().replaceAll("-", "")}`;
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(text)) throw new Error("INVALID_REQUEST_ID");
  return text;
}

function minutesToTime(value: number) {
  const n = Math.max(0, Math.min(1439, Math.trunc(value)));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`;
}

function roomForBed(id: string) {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  return "Traction Room";
}

function overlaps(a1: number, a2: number, b1: number, b2: number) {
  return a1 < b2 && a2 > b1;
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(req: Request) {
  const key = req.headers.get("x-relife-server-key") || "";
  if (!key) return false;
  return (await sha256Hex(key)) === SERVER_KEY_HASH;
}

async function resolveTenant(executor: SqlExecutor, body: Record<string, unknown>): Promise<Tenant> {
  const organizationSlug = norm(body.organizationSlug || DEFAULT_ORGANIZATION_SLUG);
  const clinicSlug = norm(body.clinicSlug || DEFAULT_CLINIC_SLUG);
  const rows = await executor`
    select o.id::text as organization_id, c.id::text as clinic_id
    from relife.organizations o
    join relife.clinics c on c.organization_id = o.id
    where o.slug = ${organizationSlug}
      and c.slug = ${clinicSlug}
      and lower(o.status) = 'active'
      and lower(c.status) = 'active'
    limit 1
  `;
  if (!rows[0]) throw new Error("TENANT_NOT_FOUND");
  return {
    organizationId: norm(rows[0].organization_id),
    clinicId: norm(rows[0].clinic_id),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!(await authorized(req))) {
    return response({ ok: false, error: "ACCESS_DENIED" }, 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = norm(body.action || "health");

    if (action === "health") {
      const tenant = await resolveTenant(sql, body);
      const rows = await sql`select now() as now`;
      return response({ ok: true, db: true, tenant, now: rows[0]?.now });
    }

    if (action === "bootstrap") {
      const date = validDate(body.date);
      const tenant = await resolveTenant(sql, body);
      const [patients, plans, resources, appointments, reservations, timeline, sessions, messages, equipment] = await Promise.all([
        sql`select * from relife.patient_cache where clinic_id=${tenant.clinicId}::uuid and department='Physio' and lower(status) <> 'inactive' order by full_name`,
        sql`select * from relife.treatment_plan_cache where clinic_id=${tenant.clinicId}::uuid and lower(status)='active'`,
        sql`select * from relife.chamber_resources where clinic_id=${tenant.clinicId}::uuid and department='Physio' and enabled=true order by resource_id`,
        sql`select * from relife.appointments where clinic_id=${tenant.clinicId}::uuid and date=${date}::date and department='Physio' order by start_time`,
        sql`select * from relife.machine_reservations where clinic_id=${tenant.clinicId}::uuid and date=${date}::date order by start_minute`,
        sql`select * from relife.treatment_timeline where clinic_id=${tenant.clinicId}::uuid and date=${date}::date order by start_minute, sequence`,
        sql`select * from relife.chamber_sessions where clinic_id=${tenant.clinicId}::uuid and date=${date}::date order by updated_at desc`,
        sql`select * from relife.chat_messages where clinic_id=${tenant.clinicId}::uuid and department='Physio' and created_at >= ${date}::date and created_at < (${date}::date + interval '1 day') order by created_at desc limit 200`,
        sql`select * from relife.equipment_requests where clinic_id=${tenant.clinicId}::uuid and department='Physio' and created_at >= ${date}::date and created_at < (${date}::date + interval '1 day') order by created_at desc limit 200`,
      ]);
      return response({ ok: true, patients, plans, resources, appointments, reservations, timeline, sessions, messages, equipment });
    }

    if (action === "sync_cache") {
      const patients = Array.isArray(body.patients) ? body.patients : [];
      const plans = Array.isArray(body.plans) ? body.plans : [];
      const tenant = await resolveTenant(sql, body);
      await sql.begin(async (tx) => {
        for (const raw of patients) {
          const item = raw as Record<string, unknown>;
          const patientId = norm(item.patientId || item.patient_id);
          if (!patientId) continue;
          await tx`
            insert into relife.patient_cache(
              patient_id, full_name, gender, therapist, status, department,
              organization_id, clinic_id, updated_at
            ) values(
              ${patientId}, ${norm(item.fullName || item.full_name)}, ${norm(item.gender)},
              ${norm(item.therapist)}, ${norm(item.status || "Active")},
              ${norm(item.department || "Physio")}, ${tenant.organizationId}::uuid,
              ${tenant.clinicId}::uuid, now()
            )
            on conflict(patient_id) do update set
              full_name=excluded.full_name,
              gender=excluded.gender,
              therapist=excluded.therapist,
              status=excluded.status,
              department=excluded.department,
              organization_id=excluded.organization_id,
              clinic_id=excluded.clinic_id,
              updated_at=now()
          `;
        }
        for (const raw of plans) {
          const item = raw as Record<string, unknown>;
          const patientId = norm(item.patientId || item.patient_id);
          if (!patientId) continue;
          await tx`
            insert into relife.treatment_plan_cache(
              patient_id, electrotherapy_plan, manual_therapy_plan, exercise_plan,
              status, organization_id, clinic_id, updated_at
            ) values(
              ${patientId}, ${norm(item.electrotherapyPlan || item.electrotherapy_plan)},
              ${norm(item.manualTherapyPlan || item.manual_therapy_plan)},
              ${norm(item.exercisePlan || item.exercise_plan)},
              ${norm(item.status || "Active")}, ${tenant.organizationId}::uuid,
              ${tenant.clinicId}::uuid, now()
            )
            on conflict(patient_id) do update set
              electrotherapy_plan=excluded.electrotherapy_plan,
              manual_therapy_plan=excluded.manual_therapy_plan,
              exercise_plan=excluded.exercise_plan,
              status=excluded.status,
              organization_id=excluded.organization_id,
              clinic_id=excluded.clinic_id,
              updated_at=now()
          `;
        }
      });
      return response({ ok: true, patients: patients.length, plans: plans.length });
    }

    if (action === "create_booking") {
      const date = validDate(body.date);
      const patientId = norm(body.patientId);
      const therapist = norm(body.therapist);
      const bedId = norm(body.bedId);
      const actorId = norm(body.actorId);
      const remarks = norm(body.remarks);
      const requestId = validRequestId(body.requestId);
      const startMinute = Number(body.startMinute);
      const timeline = Array.isArray(body.timeline) ? body.timeline : [];
      const modalities = Array.isArray(body.modalities) ? body.modalities.map(String) : [];
      if (
        !patientId ||
        !therapist ||
        !BEDS.has(bedId) ||
        !Number.isInteger(startMinute) ||
        startMinute < 0 ||
        startMinute > 1380 ||
        startMinute % 60 !== 0
      ) {
        return response({ ok: false, error: "INVALID_BOOKING" }, 400);
      }
      const endMinute = startMinute + 60;
      const tenant = await resolveTenant(sql, body);

      const result = await sql.begin(async (tx) => {
        const replay = await tx`
          select id, timeline_id, patient_name, gender
          from relife.appointments
          where clinic_id=${tenant.clinicId}::uuid and request_id=${requestId}
          limit 1
        `;
        if (replay[0]) {
          return {
            appointmentId: norm(replay[0].id),
            timelineId: norm(replay[0].timeline_id),
            patientName: norm(replay[0].patient_name),
            gender: norm(replay[0].gender),
            duplicate: true,
          };
        }

        await tx`select pg_advisory_xact_lock(hashtext(${`relife-chamber:${tenant.clinicId}:${date}`}))`;

        const patients = await tx`
          select * from relife.patient_cache
          where clinic_id=${tenant.clinicId}::uuid
            and patient_id=${patientId}
            and department='Physio'
          limit 1
        `;
        const patient = patients[0];
        if (!patient) return { conflict: "Patient is not synced to Chamber database." };
        const gender = norm(patient.gender);
        if (!gender) return { conflict: "Patient gender must be set before Chamber booking." };

        const plans = await tx`
          select * from relife.treatment_plan_cache
          where clinic_id=${tenant.clinicId}::uuid
            and patient_id=${patientId}
            and lower(status)='active'
          limit 1
        `;
        const plan = plans[0];
        const combinedPlan = `${norm(plan?.electrotherapy_plan)} ${norm(plan?.manual_therapy_plan)} ${norm(plan?.exercise_plan)}`;
        if (/\btraction\b/i.test(combinedPlan) && bedId !== "TRACTION-BED") {
          return { conflict: "Active treatment plan requires the Traction Bed." };
        }

        const existing = await tx`
          select id, timeline_id, patient_id, patient_name, therapist, bed_id, gender,
                 extract(hour from start_time)::int * 60 + extract(minute from start_time)::int as start_minute,
                 expected_duration_min
          from relife.appointments
          where clinic_id=${tenant.clinicId}::uuid
            and date=${date}::date
            and department='Physio'
            and lower(status)=any(${ACTIVE})
        `;
        for (const row of existing) {
          const otherStart = Number(row.start_minute);
          const otherEnd = otherStart + Math.max(60, Number(row.expected_duration_min || 60));
          if (!overlaps(startMinute, endMinute, otherStart, otherEnd)) continue;

          if (norm(row.patient_id) === patientId) {
            if (
              otherStart === startMinute &&
              norm(row.therapist).toLowerCase() === therapist.toLowerCase() &&
              norm(row.bed_id) === bedId
            ) {
              return {
                appointmentId: norm(row.id),
                timelineId: norm(row.timeline_id),
                patientName: norm(row.patient_name),
                gender,
                duplicate: true,
              };
            }
            return { conflict: "Patient already has an overlapping appointment in this hour." };
          }
          if (norm(row.therapist).toLowerCase() === therapist.toLowerCase()) {
            return { conflict: `${therapist} already has a patient in this hour.` };
          }
          if (norm(row.bed_id) === bedId) {
            return { conflict: `${bedId} is already booked in this hour.` };
          }
          if (
            bedId !== "TRACTION-BED" &&
            norm(row.bed_id) !== "TRACTION-BED" &&
            roomForBed(norm(row.bed_id)) === roomForBed(bedId) &&
            norm(row.gender) &&
            norm(row.gender).toLowerCase() !== gender.toLowerCase()
          ) {
            return { conflict: `${roomForBed(bedId)} is locked for ${norm(row.gender)} during this hour.` };
          }
        }

        const totalSelected = timeline.reduce(
          (sum: number, raw: unknown) =>
            sum + Math.max(0, Number((raw as Record<string, unknown>)?.durationMin || 0)),
          0
        );
        if (totalSelected > 60) {
          return { conflict: `Selected treatment is ${totalSelected} min. Maximum is 60 min.` };
        }

        const reservations = await tx`
          select r.resource_id, r.start_minute, r.end_minute, r.patient_name
          from relife.machine_reservations r
          join relife.appointments a
            on a.id=r.appointment_id and a.clinic_id=r.clinic_id
          where r.clinic_id=${tenant.clinicId}::uuid
            and r.date=${date}::date
            and lower(r.status) in ('scheduled','active')
            and lower(a.status)=any(${ACTIVE})
        `;
        for (const raw of timeline) {
          const step = raw as Record<string, unknown>;
          const resourceId = norm(step.resourceId || step.resource_id);
          if (!resourceId) continue;
          const s = Number(step.startMinute ?? step.start_minute);
          const e = Number(step.endMinute ?? step.end_minute);
          const busy = reservations.find(
            (r) =>
              norm(r.resource_id) === resourceId &&
              overlaps(s, e, Number(r.start_minute), Number(r.end_minute))
          );
          if (busy) {
            return { conflict: `${norm(step.name || resourceId)} is already reserved during this time.` };
          }
        }

        const appointmentId = `APW${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
        const timelineId = `TLW${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
        await tx`
          insert into relife.appointments(
            id, date, start_time, patient_id, patient_name, gender, therapist,
            status, bed_id, modalities, expected_duration_min, timeline_id,
            remarks, department, created_by, organization_id, clinic_id,
            request_id, created_at, updated_at
          ) values(
            ${appointmentId}, ${date}::date, ${minutesToTime(startMinute)}::time,
            ${patientId}, ${norm(patient.full_name)}, ${gender}, ${therapist},
            'Scheduled', ${bedId}, ${JSON.stringify(modalities)}::jsonb, 60,
            ${timelineId}, ${remarks}, 'Physio', ${actorId},
            ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid,
            ${requestId}, now(), now()
          )
        `;

        let seq = 0;
        for (const raw of timeline) {
          const step = raw as Record<string, unknown>;
          seq += 1;
          const duration = Math.max(1, Number(step.durationMin || 0));
          const s = Number(step.startMinute ?? step.start_minute);
          const e = Number(step.endMinute ?? step.end_minute);
          const resourceId = norm(step.resourceId || step.resource_id);
          const resourceName = norm(step.resourceName || step.resource_name || step.name);
          const stepId = `TLS${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
          await tx`
            insert into relife.treatment_timeline(
              id, timeline_id, appointment_id, patient_id, patient_name, date,
              bed_id, sequence, step_name, resource_id, resource_name,
              duration_min, start_minute, end_minute, start_time, end_time,
              status, created_by, organization_id, clinic_id, created_at, updated_at
            ) values(
              ${stepId}, ${timelineId}, ${appointmentId}, ${patientId},
              ${norm(patient.full_name)}, ${date}::date, ${bedId}, ${seq},
              ${norm(step.name)}, ${resourceId}, ${resourceName}, ${duration},
              ${s}, ${e}, ${minutesToTime(s)}::time, ${minutesToTime(e)}::time,
              'Planned', ${actorId}, ${tenant.organizationId}::uuid,
              ${tenant.clinicId}::uuid, now(), now()
            )
          `;
          if (resourceId) {
            const reservationId = `RSV${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
            await tx`
              insert into relife.machine_reservations(
                id, appointment_id, patient_id, patient_name, date, bed_id,
                resource_id, resource_name, sequence, start_minute, end_minute,
                start_time, end_time, duration_min, status, created_by,
                organization_id, clinic_id, created_at, updated_at
              ) values(
                ${reservationId}, ${appointmentId}, ${patientId}, ${norm(patient.full_name)},
                ${date}::date, ${bedId}, ${resourceId}, ${resourceName}, ${seq},
                ${s}, ${e}, ${minutesToTime(s)}::time, ${minutesToTime(e)}::time,
                ${duration}, 'Scheduled', ${actorId}, ${tenant.organizationId}::uuid,
                ${tenant.clinicId}::uuid, now(), now()
              )
            `;
          }
        }

        return {
          appointmentId,
          timelineId,
          patientName: norm(patient.full_name),
          gender,
          duplicate: false,
        };
      });

      if ((result as { conflict?: string }).conflict) {
        const conflict = (result as { conflict: string }).conflict;
        const conflictId = `BCF${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
        await sql`
          insert into relife.booking_conflicts(
            id, patient_id, patient_name, date, start_time, therapist,
            conflict_type, detail, modalities, expected_duration_min, actor_id,
            department, organization_id, clinic_id
          ) values(
            ${conflictId}, ${patientId}, '', ${date}::date,
            ${minutesToTime(startMinute)}::time, ${therapist}, 'booking_conflict',
            ${conflict}, ${JSON.stringify(modalities)}::jsonb, 60, ${actorId},
            'Physio', ${tenant.organizationId}::uuid, ${tenant.clinicId}::uuid
          )
        `;
        return response({ ok: false, error: "APPOINTMENT_CONFLICT", detail: conflict }, 409);
      }

      return response({ ok: true, ...result });
    }

    return response({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("relife-chamber-api", error);
    return response(
      { ok: false, error: error instanceof Error ? error.message : "EDGE_FAILED" },
      500
    );
  }
});
