import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import { displayTimeFromMinute } from "@/lib/domain/operations/appointmentTime";
import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";
import type { PatientRecord } from "@/lib/patients";
import type { Payment } from "@/lib/types";

/**
 * Persistence adapter for the tenant-native operational core.
 *
 * This module stores and retrieves records. It does not decide policy: whether
 * a caller may register a patient, what a payment means for a patient's
 * balance, and whether a booking is safe are all settled by the domain layer
 * before anything here is called. Every mutation goes through a SQL function so
 * the record, its derived balance and its audit event commit together.
 */

function adminClient(): SupabaseClient {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new Error("OPERATIONAL_STORE_UNAVAILABLE");
  }
}

function dbScope(scope: TenantScope) {
  const tenant = requireTenantScope(scope);
  return { organization_id: tenant.organizationId, clinic_id: tenant.clinicId };
}

function ensure(error: { message?: string } | null, operation: string): void {
  if (!error) return;
  const message = String(error.message || "unknown");
  // Business rejections raised by the SQL writers carry their own contract
  // (`DUPLICATE_PHONE:PT-0007`, `APPOINTMENT_DUPLICATE`, `PATIENT_NOT_FOUND`).
  // Callers already handle those strings, so they are rethrown unchanged rather
  // than buried inside a generic storage error.
  const known = /(DUPLICATE_PHONE:[^\s"]*|DUPLICATE_PHONE|APPOINTMENT_DUPLICATE|APPOINTMENT_NOT_FOUND|PATIENT_NOT_FOUND|TENANT_NOT_FOUND|TENANT_SCOPE_REQUIRED|REQUEST_ID_REQUIRED|OPERATIONAL_STORE_MISMATCH:[a-z]+|OPERATIONAL_STORE_NOT_CONFIGURED)/.exec(message);
  if (known) throw new Error(known[1]);
  throw new Error(`OPERATIONAL_${operation}_FAILED:${message}`);
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return String(value ?? "");
}

function toPatientRecord(row: Record<string, unknown>, tenant: TenantScope): PatientRecord {
  const paid = money(row.paid);
  return {
    patientId: text(row.patient_id),
    registrationDate: text(row.registration_date),
    fullName: text(row.full_name),
    phone: text(row.phone),
    age: text(row.age),
    gender: text(row.gender),
    address: text(row.address),
    department: "Physio",
    diagnosis: text(row.diagnosis),
    therapist: text(row.therapist),
    paymentStatus: text(row.payment_status),
    totalBill: money(row.total_bill),
    paid,
    due: money(row.due),
    advance: money(row.advance),
    status: text(row.status),
    lastUpdated: text(row.updated_at),
    organizationId: tenant.organizationId,
    clinicId: tenant.clinicId,
  };
}

export interface OperationalAppointment {
  appointmentId: string;
  date: string;
  time: string;
  startMinute: number;
  durationMin: number;
  patientId: string;
  patientName: string;
  department: "Physio";
  therapist: string;
  status: string;
  remarks: string;
  receivedBy: string;
  organizationId: string;
  clinicId: string;
}

function toAppointment(row: Record<string, unknown>, tenant: TenantScope): OperationalAppointment {
  const startMinute = Number(row.start_minute ?? 0);
  return {
    appointmentId: text(row.appointment_id),
    date: text(row.appointment_date),
    time: displayTimeFromMinute(startMinute),
    startMinute,
    durationMin: Number(row.duration_min ?? 60),
    patientId: text(row.patient_id),
    patientName: text(row.patient_name),
    department: "Physio",
    therapist: text(row.therapist),
    status: text(row.status),
    remarks: text(row.remarks),
    receivedBy: text(row.created_by),
    organizationId: tenant.organizationId,
    clinicId: tenant.clinicId,
  };
}

function toPayment(row: Record<string, unknown>, tenant: TenantScope): Payment {
  return {
    receiptNo: text(row.receipt_no),
    date: text(row.payment_date),
    patientId: text(row.patient_id),
    patientName: text(row.patient_name),
    department: "Physio",
    amount: money(row.amount),
    discount: money(row.discount),
    due: money(row.due),
    paymentMethod: text(row.payment_method) as Payment["paymentMethod"],
    receivedBy: text(row.received_by),
    remarks: text(row.remarks),
    organizationId: tenant.organizationId,
    clinicId: tenant.clinicId,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readPatients(
  scope: TenantScope,
  client = adminClient(),
): Promise<PatientRecord[]> {
  const tenant = requireTenantScope(scope);
  const result = await client
    .schema("relife")
    .from("patients")
    .select("*")
    .match(dbScope(tenant))
    .order("registration_date", { ascending: false });
  ensure(result.error, "PATIENTS_READ");
  return ((result.data || []) as Record<string, unknown>[]).map((row) => toPatientRecord(row, tenant));
}

export async function readPatient(
  scope: TenantScope,
  patientId: string,
  client = adminClient(),
): Promise<PatientRecord | null> {
  const tenant = requireTenantScope(scope);
  const result = await client
    .schema("relife")
    .from("patients")
    .select("*")
    .match({ ...dbScope(tenant), patient_id: String(patientId || "").trim() })
    .maybeSingle();
  ensure(result.error, "PATIENT_READ");
  return result.data ? toPatientRecord(result.data as Record<string, unknown>, tenant) : null;
}

export async function readAppointments(
  scope: TenantScope,
  options: { date?: string; patientId?: string } = {},
  client = adminClient(),
): Promise<OperationalAppointment[]> {
  const tenant = requireTenantScope(scope);
  const filter: Record<string, string> = { ...dbScope(tenant) };
  if (options.date) filter.appointment_date = options.date;
  if (options.patientId) filter.patient_id = options.patientId;
  const result = await client
    .schema("relife")
    .from("appointments")
    .select("*")
    .match(filter)
    .order("appointment_date", { ascending: false })
    .order("start_minute", { ascending: true });
  ensure(result.error, "APPOINTMENTS_READ");
  return ((result.data || []) as Record<string, unknown>[]).map((row) => toAppointment(row, tenant));
}

export async function readPayments(
  scope: TenantScope,
  options: { patientId?: string } = {},
  client = adminClient(),
): Promise<Payment[]> {
  const tenant = requireTenantScope(scope);
  const filter: Record<string, string> = { ...dbScope(tenant) };
  if (options.patientId) filter.patient_id = options.patientId;
  const result = await client
    .schema("relife")
    .from("payments")
    .select("*")
    .match(filter)
    .order("payment_date", { ascending: false });
  ensure(result.error, "PAYMENTS_READ");
  return ((result.data || []) as Record<string, unknown>[]).map((row) => toPayment(row, tenant));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RegisterPatientRow {
  fullName: string;
  fatherHusbandName?: string;
  phone?: string;
  alternativePhone?: string;
  age?: string;
  gender?: string;
  address?: string;
  diagnosis?: string;
  therapist?: string;
  referral?: string;
  remarks?: string;
  registrationDate?: string;
}

export async function insertPatient(
  scope: TenantScope,
  actorId: string,
  requestId: string,
  row: RegisterPatientRow,
  client = adminClient(),
): Promise<{ patientId: string; duplicate: boolean }> {
  const tenant = requireTenantScope(scope);
  const result = await client.schema("relife").rpc("register_patient_v1", {
    p_organization_id: tenant.organizationId,
    p_clinic_id: tenant.clinicId,
    p_actor_id: actorId,
    p_request_id: requestId,
    p_payload: row,
  });
  ensure(result.error, "PATIENT_WRITE");
  const data = (result.data || {}) as { patientId?: string; duplicate?: boolean };
  if (!data.patientId) throw new Error("OPERATIONAL_PATIENT_WRITE_FAILED:no_id");
  return { patientId: data.patientId, duplicate: Boolean(data.duplicate) };
}

export interface BookAppointmentRow {
  patientId: string;
  date: string;
  startMinute: number;
  durationMin?: number;
  therapist?: string;
  remarks?: string;
}

export async function insertAppointment(
  scope: TenantScope,
  actorId: string,
  requestId: string,
  row: BookAppointmentRow,
  client = adminClient(),
): Promise<{ appointmentId: string; duplicate: boolean }> {
  const tenant = requireTenantScope(scope);
  const result = await client.schema("relife").rpc("book_appointment_v1", {
    p_organization_id: tenant.organizationId,
    p_clinic_id: tenant.clinicId,
    p_actor_id: actorId,
    p_request_id: requestId,
    p_payload: row,
  });
  ensure(result.error, "APPOINTMENT_WRITE");
  const data = (result.data || {}) as { appointmentId?: string; duplicate?: boolean };
  if (!data.appointmentId) throw new Error("OPERATIONAL_APPOINTMENT_WRITE_FAILED:no_id");
  return { appointmentId: data.appointmentId, duplicate: Boolean(data.duplicate) };
}

export interface UpdatePatientProfileRow {
  fullName?: string;
  phone?: string;
  age?: string;
  gender?: string;
  address?: string;
  diagnosis?: string;
  therapist?: string;
  status?: string;
}

export async function updatePatientProfileRow(
  scope: TenantScope,
  actorId: string,
  patientId: string,
  row: UpdatePatientProfileRow,
  client = adminClient(),
): Promise<{ patientId: string }> {
  const tenant = requireTenantScope(scope);
  // Only the keys the caller actually supplied are forwarded, so the writer can
  // tell "leave unchanged" from "set to empty".
  const payload = Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
  const result = await client.schema("relife").rpc("update_patient_profile_v1", {
    p_organization_id: tenant.organizationId,
    p_clinic_id: tenant.clinicId,
    p_actor_id: actorId,
    p_patient_id: patientId,
    p_payload: payload,
  });
  ensure(result.error, "PATIENT_UPDATE");
  return { patientId };
}

export async function updateAppointmentStatusRow(
  scope: TenantScope,
  actorId: string,
  appointmentId: string,
  status: string,
  client = adminClient(),
): Promise<{ appointmentId: string; status: string }> {
  const tenant = requireTenantScope(scope);
  const result = await client.schema("relife").rpc("update_appointment_status_v1", {
    p_organization_id: tenant.organizationId,
    p_clinic_id: tenant.clinicId,
    p_actor_id: actorId,
    p_appointment_id: appointmentId,
    p_status: status,
  });
  ensure(result.error, "APPOINTMENT_STATUS_UPDATE");
  return { appointmentId, status };
}

export interface RecordPaymentRow {
  patientId: string;
  date?: string;
  amount: number;
  discount?: number;
  /** Patient balance after this receipt, decided by the finance domain. */
  due: number;
  /** Carried-forward overpayment after this receipt, also decided upstream. */
  advance?: number;
  paymentStatus: string;
  paymentMethod: Payment["paymentMethod"];
  sessions?: number;
  sessionType?: string;
  remarks?: string;
}

export async function insertPayment(
  scope: TenantScope,
  actorId: string,
  requestId: string,
  row: RecordPaymentRow,
  client = adminClient(),
): Promise<{ receiptNo: string; due: number; duplicate: boolean }> {
  const tenant = requireTenantScope(scope);
  const result = await client.schema("relife").rpc("record_payment_v1", {
    p_organization_id: tenant.organizationId,
    p_clinic_id: tenant.clinicId,
    p_actor_id: actorId,
    p_request_id: requestId,
    p_payload: row,
  });
  ensure(result.error, "PAYMENT_WRITE");
  const data = (result.data || {}) as { receiptNo?: string; due?: number; duplicate?: boolean };
  if (!data.receiptNo) throw new Error("OPERATIONAL_PAYMENT_WRITE_FAILED:no_receipt");
  return { receiptNo: data.receiptNo, due: money(data.due), duplicate: Boolean(data.duplicate) };
}
