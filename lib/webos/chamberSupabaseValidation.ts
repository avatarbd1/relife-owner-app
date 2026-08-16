import "server-only";

import {
  getSupabaseChamberBootstrap,
  type SupabaseAppointmentRow,
  type SupabaseChamberBootstrap,
} from "@/lib/data/supabaseChamber";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import type {
  FixedBedId,
  FixedHourConflict,
  FixedHourInput,
  FixedHourValidation,
  FixedModalityOption,
  FixedPlanStep,
} from "@/lib/webos/chamberFixedHour";

const SESSION_MINUTES = 60;
const MANUAL_ID = "MANUAL";
const ACTIVE = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);
const BEDS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);
const BOOTSTRAP_CACHE_MS = 2_000;

let bootstrapCache = new Map<string, { at: number; promise: Promise<SupabaseChamberBootstrap> }>();

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function bedId(value: unknown): FixedBedId | "" {
  const text = normalized(value);
  if (["traction", "traction bed", "traction-bed"].includes(text)) return "TRACTION-BED";
  const match = /bed[-\s]*([1-4])/.exec(text);
  return match ? (`BED-${match[1]}` as FixedBedId) : "";
}

function bedLabel(id: FixedBedId): string {
  return id === "TRACTION-BED" ? "Traction Bed" : `Bed ${id.slice(-1)}`;
}

function roomForBed(id: FixedBedId): string {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  return "Traction Room";
}

function timeMinutes(value: string): number {
  const text = normalize(value).toUpperCase();
  const hms = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (hms) {
    const hour = Number(hms[1]);
    const minute = Number(hms[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  const sheet = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (sheet) {
    let hour = Number(sheet[1]) % 12;
    const minute = Number(sheet[2]);
    if (sheet[3] === "PM") hour += 12;
    if (minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  throw new Error("INVALID_TIME");
}

function sheetTime(value: number): string {
  const minute = Math.max(0, Math.round(value));
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function slotLabel(start: number): string {
  const hour = (value: number) => String((Math.floor(value / 60) % 12) || 12);
  return `${hour(start)}–${hour(start + 60)}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function modalityOptions(snapshot: SupabaseChamberBootstrap): FixedModalityOption[] {
  const options = snapshot.resources.flatMap((resource) => {
    const durationMin = Number(resource.default_duration_min || 0);
    if (normalized(resource.resource_type) !== "machine" || !resource.enabled || durationMin <= 0) return [];
    return [{
      value: resource.resource_id,
      label: resource.resource_name,
      durationMin,
      resourceId: resource.resource_id,
      machine: true,
    } satisfies FixedModalityOption];
  });
  options.push({ value: MANUAL_ID, label: "Manual Therapy", durationMin: 10, resourceId: "", machine: false });
  return options;
}

function planSuggestion(
  snapshot: SupabaseChamberBootstrap,
  patientId: string,
  options: FixedModalityOption[]
): { modalities: string[]; needsTraction: boolean } {
  const plan = snapshot.plans.find((item) => item.patient_id === patientId);
  if (!plan) return { modalities: [], needsTraction: false };
  const electro = `${normalize(plan.electrotherapy_plan)} ${normalize(plan.manual_therapy_plan)}`;
  const combined = `${electro} ${normalize(plan.exercise_plan)}`;
  const aliases: Array<[RegExp, string]> = [
    [/facial\s*tens/i, "Facial TENS"],
    [/shockwave|sk5/i, "Shockwave SK5"],
    [/ultrasound|\bust\b/i, "Ultrasound"],
    [/\bift\b/i, "IFT"],
    [/\btens\b/i, "TENS"],
    [/\bems\b/i, "EMS"],
    [/\bswd\b|short\s*wave/i, "SWD"],
    [/\bwax\b/i, "Wax"],
    [/\birr\b|infra\s*red/i, "IRR"],
  ];
  const modalities: string[] = [];
  for (const [pattern, label] of aliases) {
    if (!pattern.test(electro)) continue;
    const option = options.find((item) => normalized(item.label) === normalized(label));
    if (option && !modalities.includes(option.value)) modalities.push(option.value);
  }
  if (/manual|mobil|mulligan|massage|mfr|soft\s*tissue|release|dtfm|istm/i.test(normalize(plan.manual_therapy_plan))) {
    modalities.push(MANUAL_ID);
  }
  return { modalities: [...new Set(modalities)], needsTraction: /\btraction\b/i.test(combined) };
}

function buildTimeline(
  startMinute: number,
  selected: string[],
  options: FixedModalityOption[]
): { timeline: FixedPlanStep[]; totalSelectedMin: number; remainingMin: number } {
  const chosen = selected.flatMap((value) => {
    const option = options.find((item) => item.value === value);
    return option ? [option] : [];
  });
  const totalSelectedMin = chosen.reduce((sum, option) => sum + option.durationMin, 0);
  let cursor = startMinute;
  const timeline: FixedPlanStep[] = chosen.map((option, index) => {
    const start = cursor;
    const end = start + option.durationMin;
    cursor = end;
    return {
      sequence: index + 1,
      name: option.label,
      value: option.value,
      resourceId: option.resourceId,
      durationMin: option.durationMin,
      startMinute: start,
      endMinute: end,
      startTime: sheetTime(start),
      endTime: sheetTime(end),
    };
  });
  const remainingMin = Math.max(0, SESSION_MINUTES - totalSelectedMin);
  if (remainingMin > 0) {
    timeline.push({
      sequence: timeline.length + 1,
      name: chosen.length ? "Therapist time" : "Therapist session",
      value: "THERAPIST-TIME",
      resourceId: "",
      durationMin: remainingMin,
      startMinute: cursor,
      endMinute: cursor + remainingMin,
      startTime: sheetTime(cursor),
      endTime: sheetTime(cursor + remainingMin),
    });
  }
  return { timeline, totalSelectedMin, remainingMin };
}

function activeAppointment(row: SupabaseAppointmentRow): boolean {
  return ACTIVE.has(normalized(row.status));
}

async function bootstrap(date: string): Promise<SupabaseChamberBootstrap> {
  const now = Date.now();
  const cached = bootstrapCache.get(date);
  if (cached && now - cached.at < BOOTSTRAP_CACHE_MS) return cached.promise;
  const promise = getSupabaseChamberBootstrap(date).catch((error) => {
    bootstrapCache.delete(date);
    throw error;
  });
  bootstrapCache.set(date, { at: now, promise });
  if (bootstrapCache.size > 8) {
    const oldest = [...bootstrapCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) bootstrapCache.delete(oldest);
  }
  return promise;
}

export async function validateFixedHourBookingWithSupabase(
  context: AccessContext,
  input: FixedHourInput
): Promise<FixedHourValidation> {
  assertCanPerform(context, "appointment.create", "Physio");
  const requestedBedId = bedId(input.requestedBedId);
  if (!requestedBedId || !BEDS.has(requestedBedId)) throw new Error("INVALID_BED");
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const slotStartMinute = timeMinutes(input.time);
  if (slotStartMinute % 60 !== 0) throw new Error("INVALID_SLOT");
  const slotEndMinute = slotStartMinute + SESSION_MINUTES;
  const therapist = normalize(input.therapist);
  if (!therapist) throw new Error("INVALID_THERAPIST");

  const snapshot = await bootstrap(date);
  const patient = snapshot.patients.find((item) => item.patient_id.toLowerCase() === normalize(input.patientId).toLowerCase());
  if (!patient || normalized(patient.department) !== "physio") throw new Error("PATIENT_NOT_FOUND");
  const gender = parseGender(patient.gender);
  const options = modalityOptions(snapshot);
  const suggestion = planSuggestion(snapshot, patient.patient_id, options);
  const selected = [...new Set((input.modalities || []).filter((value) => options.some((item) => item.value === value)))];
  const plan = buildTimeline(slotStartMinute, selected, options);
  const conflicts: FixedHourConflict[] = [];

  if (!gender) conflicts.push({ type: "gender_required", message: "Patient gender must be set before Chamber booking." });
  if (plan.totalSelectedMin > SESSION_MINUTES) conflicts.push({ type: "duration_overflow", message: `Selected treatment is ${plan.totalSelectedMin} min. Maximum is 60 min for this slot.` });
  if (suggestion.needsTraction && requestedBedId !== "TRACTION-BED") conflicts.push({ type: "treatment_plan", message: "Active treatment plan requires the Traction Bed." });

  const overlapping = snapshot.appointments.filter((item) => {
    if (!activeAppointment(item)) return false;
    const start = timeMinutes(item.start_time);
    const end = start + Math.max(60, Number(item.expected_duration_min || 60));
    return overlaps(slotStartMinute, slotEndMinute, start, end);
  });
  if (overlapping.some((item) => item.patient_id === patient.patient_id)) {
    conflicts.push({ type: "duplicate", message: "Patient already has an overlapping appointment in this hour." });
  }
  const therapistBusy = overlapping.find((item) => normalized(item.therapist) === normalized(therapist));
  if (therapistBusy) {
    conflicts.push({ type: "therapist_busy", message: `${therapist} already has ${therapistBusy.patient_name || therapistBusy.patient_id} in this hour.` });
  }
  const bedBusy = overlapping.find((item) => bedId(item.bed_id) === requestedBedId);
  if (bedBusy) {
    conflicts.push({ type: "bed_busy", message: `${bedLabel(requestedBedId)} is already booked for ${bedBusy.patient_name || bedBusy.patient_id}.` });
  }

  if (requestedBedId !== "TRACTION-BED" && gender) {
    const room = roomForBed(requestedBedId);
    const roomGenders = new Set(
      overlapping
        .filter((item) => {
          const otherBed = bedId(item.bed_id);
          return otherBed && otherBed !== "TRACTION-BED" && roomForBed(otherBed) === room;
        })
        .map((item) => parseGender(item.gender))
        .filter(Boolean)
    );
    if (roomGenders.size > 1) {
      conflicts.push({ type: "gender_rule", message: `${room} already has mixed-gender data. Resolve it first.` });
    } else if (roomGenders.size === 1 && !roomGenders.has(gender)) {
      conflicts.push({ type: "gender_rule", message: `${room} is locked for ${[...roomGenders][0]} during this hour.` });
    }
  }

  const statusByAppointment = new Map(snapshot.appointments.map((item) => [item.id, item.status]));
  const reservations = snapshot.reservations.filter((item) => {
    if (!["scheduled", "active"].includes(normalized(item.status))) return false;
    const appointmentStatus = statusByAppointment.get(item.appointment_id);
    return appointmentStatus ? ACTIVE.has(normalized(appointmentStatus)) : true;
  });
  for (const step of plan.timeline) {
    if (!step.resourceId) continue;
    const busy = reservations.find(
      (item) => item.resource_id === step.resourceId && overlaps(step.startMinute, step.endMinute, Number(item.start_minute), Number(item.end_minute))
    );
    if (busy) {
      conflicts.push({ type: "machine_busy", message: `${step.name} is reserved for ${busy.patient_name || "another patient"} during ${step.startTime}–${step.endTime}.` });
    }
  }

  const unique = [...new Map(conflicts.map((item) => [`${item.type}:${item.message}`, item])).values()];
  return {
    isValid: unique.length === 0,
    patientId: patient.patient_id,
    patientName: patient.full_name,
    gender,
    requestedBedId,
    roomId: roomForBed(requestedBedId),
    slotStartMinute,
    slotEndMinute,
    slotLabel: slotLabel(slotStartMinute),
    totalSelectedMin: plan.totalSelectedMin,
    remainingMin: plan.remainingMin,
    timeline: plan.timeline,
    conflicts: unique,
    modalityOptions: options,
    suggestedModalities: suggestion.modalities,
    needsTraction: suggestion.needsTraction,
  };
}
