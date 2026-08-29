begin;

-- ===========================================================================
-- Tenant-native operational core — foundation + patients/appointments/payments
-- ===========================================================================
--
-- Until now the clinic operational record (patients, appointments, payments)
-- had no canonical home in Postgres. `relife` held tenancy, configuration,
-- gamification, consent and audit tables, while the operational record itself
-- lived only in Relife's Google Sheets workbooks keyed by the legacy
-- `RELIFE-PHYSIO` / `RELIFE-DENTAL` ledger identities. A newly provisioned
-- clinic could therefore be configured but could not register a patient, book
-- an appointment, or take a payment: there was nothing to write to.
--
-- This migration creates that missing operational core, tenant-scoped from the
-- first row. It is additive: no existing table, column or authority is changed,
-- and no Sheets data is read, written or migrated here. Relife stays on its
-- current Sheets authority (see the routing switch in section 5); moving its
-- data is a separate, evidence-gated migration that must not delete raw data.
--
-- Design rules this schema is required to satisfy:
--
--   * Every tenant-owned row carries `organization_id + clinic_id`, and the
--     composite foreign key to `relife.clinics (organization_id, id)` makes a
--     cross-tenant reference structurally impossible rather than merely
--     discouraged.
--   * Business keys are clinic-local. Two clinics may each hold `PT-0001`;
--     the primary key is the tenant plus the local id, never the id alone.
--     This is the multi-clinic key-collision gap that blocked Clinic #2.
--   * Every mutation is idempotent through a caller `request_id`, so a retried
--     write returns the original row instead of creating a second one.
--   * Ordinary RLS is not treated as protection for privileged traffic; the
--     browser roles are denied outright and only the trusted server path is
--     granted, matching the decision already made for the configuration tables.

-- ---------------------------------------------------------------------------
-- 1. Clinic-local business key allocation
-- ---------------------------------------------------------------------------
-- Sheets allocated the next patient/appointment id by scanning every existing
-- row and taking max+1, which is a lost-update race under concurrency and
-- cannot express "unique within this clinic". A counter row per tenant per kind
-- replaces that scan: allocation is a single atomic statement, and the number
-- series is naturally clinic-local.

create table if not exists relife.clinic_local_id_sequences (
  organization_id uuid not null,
  clinic_id uuid not null,
  sequence_kind text not null check (sequence_kind in ('patient','appointment','payment')),
  next_value bigint not null default 1 check (next_value > 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, sequence_kind),
  constraint clinic_local_id_sequences_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.clinic_local_id_sequences is
  'Per-clinic business-key counters. Makes local ids collision-safe across clinics and allocation race-free.';

-- Allocation is `insert .. on conflict do update .. returning`, which takes a
-- row lock and increments in one statement. Concurrent callers serialize on the
-- counter row instead of racing a max+1 scan.
create or replace function relife.next_clinic_local_id(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_kind text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_value bigint;
begin
  if p_organization_id is null or p_clinic_id is null then
    raise exception 'TENANT_SCOPE_REQUIRED';
  end if;
  if p_prefix !~ '^[A-Z]{2,4}$' then
    raise exception 'ID_PREFIX_INVALID';
  end if;

  -- Seeding with 2 and returning `next_value - 1` makes the insert and the
  -- update branches agree without inspecting system columns: a fresh counter
  -- lands on 2 and hands out 1, an existing counter moves to old+1 and hands
  -- out old.
  insert into relife.clinic_local_id_sequences (organization_id, clinic_id, sequence_kind, next_value)
  values (p_organization_id, p_clinic_id, p_kind, 2)
  on conflict (organization_id, clinic_id, sequence_kind) do update
    set next_value = relife.clinic_local_id_sequences.next_value + 1,
        updated_at = now()
  returning next_value - 1
  into v_value;

  return p_prefix || '-' || lpad(v_value::text, 4, '0');
end;
$$;

revoke all on function relife.next_clinic_local_id(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function relife.next_clinic_local_id(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Patients
-- ---------------------------------------------------------------------------
-- Department is constrained to 'Physio'. The platform offers exactly one
-- clinic template, and Dental is discontinued as a business line: its historical
-- rows stay in the read-only Sheets archive rather than entering this core.
-- Widening this check is a deliberate future migration, not an accident.

create table if not exists relife.patients (
  organization_id uuid not null,
  clinic_id uuid not null,
  patient_id text not null,
  department text not null default 'Physio' check (department in ('Physio')),
  full_name text not null check (length(btrim(full_name)) >= 2),
  father_husband_name text not null default '',
  phone text not null default '',
  alternative_phone text not null default '',
  age text not null default '',
  gender text not null default '' check (gender in ('', 'Male', 'Female')),
  address text not null default '',
  diagnosis text not null default '',
  therapist text not null default '',
  referral text not null default '',
  remarks text not null default '',
  registration_date date not null,
  -- Money on the patient row is a running position derived from the payment
  -- ledger, never an independent source of truth. `payments` stays the record
  -- of what was actually collected.
  total_bill numeric(12,2) not null default 0 check (total_bill >= 0),
  paid numeric(12,2) not null default 0 check (paid >= 0),
  due numeric(12,2) not null default 0,
  -- Overpayment carried forward. Kept distinct from `paid` because money held
  -- against future sessions is not the same fact as money already earned.
  advance numeric(12,2) not null default 0 check (advance >= 0),
  payment_status text not null default 'Due',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  request_id text not null default '',
  created_by text not null,
  source_system text not null default 'web_pwa',
  source_type text not null default 'human_entry',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, patient_id),
  constraint patients_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.patients is
  'Tenant-native patient master. Local patient_id is unique per clinic, never globally, so clinics may reuse a number series.';

-- A retried registration must return the original patient, not create a twin.
create unique index if not exists patients_request_uidx
  on relife.patients (organization_id, clinic_id, request_id)
  where request_id <> '';

-- The Sheets writer rejected a second active patient with the same phone in the
-- same tenant. That rule becomes a database guarantee here, scoped per clinic so
-- one clinic's number can never collide with another's.
create unique index if not exists patients_active_phone_uidx
  on relife.patients (organization_id, clinic_id, phone)
  where phone <> '' and status = 'Active';

create index if not exists patients_clinic_registered_idx
  on relife.patients (organization_id, clinic_id, registration_date desc);
create index if not exists patients_clinic_name_idx
  on relife.patients (organization_id, clinic_id, lower(full_name));

-- ---------------------------------------------------------------------------
-- 3. Appointments
-- ---------------------------------------------------------------------------

create table if not exists relife.appointments (
  organization_id uuid not null,
  clinic_id uuid not null,
  appointment_id text not null,
  patient_id text not null,
  patient_name text not null,
  department text not null default 'Physio' check (department in ('Physio')),
  appointment_date date not null,
  -- Stored as minutes from midnight so ordering and overlap comparisons are
  -- arithmetic rather than string parsing of a display format.
  start_minute smallint not null check (start_minute between 0 and 1439),
  duration_min smallint not null default 60 check (duration_min between 5 and 480),
  therapist text not null default '',
  status text not null default 'Scheduled'
    check (status in ('Scheduled', 'Arrived', 'Waiting', 'In Treatment', 'Completed', 'No-show', 'Cancelled')),
  remarks text not null default '',
  request_id text not null default '',
  created_by text not null,
  source_system text not null default 'web_pwa',
  source_type text not null default 'human_entry',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, appointment_id),
  constraint appointments_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  -- The patient must belong to the same clinic. The composite reference is what
  -- makes booking another clinic's patient structurally impossible.
  constraint appointments_patient_fk foreign key (organization_id, clinic_id, patient_id)
    references relife.patients (organization_id, clinic_id, patient_id) on delete restrict
);

comment on table relife.appointments is
  'Tenant-native appointment ledger. Booking-time intent only; live treatment/bed assignment remains a Chamber runtime concern.';

create unique index if not exists appointments_request_uidx
  on relife.appointments (organization_id, clinic_id, request_id)
  where request_id <> '';

-- Booking invariant 4: the same patient may not hold two active appointments in
-- the same slot. Cancelled/No Show rows are excluded so a slot can be rebooked.
create unique index if not exists appointments_active_duplicate_uidx
  on relife.appointments (organization_id, clinic_id, patient_id, appointment_date, start_minute)
  where status not in ('Cancelled', 'No-show');

create index if not exists appointments_clinic_date_idx
  on relife.appointments (organization_id, clinic_id, appointment_date, start_minute);
create index if not exists appointments_clinic_patient_idx
  on relife.appointments (organization_id, clinic_id, patient_id, appointment_date desc);

-- ---------------------------------------------------------------------------
-- 4. Payments
-- ---------------------------------------------------------------------------
-- Collection truth only. Expenses, cash custody movement and salary remain
-- separate ledgers with separate accounting meaning and are not merged here.

create table if not exists relife.payments (
  organization_id uuid not null,
  clinic_id uuid not null,
  receipt_no text not null,
  patient_id text not null,
  patient_name text not null,
  department text not null default 'Physio' check (department in ('Physio')),
  payment_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  -- Patient balance carried at the moment of the receipt. Not a second source
  -- of truth for the running position, which stays on the patient row.
  due numeric(12,2) not null default 0,
  payment_method text not null
    check (payment_method in ('Cash', 'bKash', 'Nagad', 'Bank', 'Card')),
  sessions integer not null default 0 check (sessions >= 0),
  session_type text not null default '',
  received_by text not null,
  remarks text not null default '',
  request_id text not null default '',
  source_system text not null default 'web_pwa',
  source_type text not null default 'human_entry',
  created_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, receipt_no),
  constraint payments_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint payments_patient_fk foreign key (organization_id, clinic_id, patient_id)
    references relife.patients (organization_id, clinic_id, patient_id) on delete restrict
);

comment on table relife.payments is
  'Tenant-native collection ledger. Internal cash transfers are custody movement and never appear here as revenue.';

-- The Sheets writer recognised a retry through a `WEBREQ:<id>` marker parked in
-- the remarks text. Here it is a real uniqueness guarantee.
create unique index if not exists payments_request_uidx
  on relife.payments (organization_id, clinic_id, request_id)
  where request_id <> '';

create index if not exists payments_clinic_date_idx
  on relife.payments (organization_id, clinic_id, payment_date desc);
create index if not exists payments_clinic_patient_idx
  on relife.payments (organization_id, clinic_id, patient_id, payment_date desc);

-- ---------------------------------------------------------------------------
-- 5. Operational store routing
-- ---------------------------------------------------------------------------
-- Exactly one operational authority per clinic. This is what keeps the core
-- from becoming a second writer beside Sheets for the same user action: a
-- clinic is either Sheets-authoritative or Supabase-authoritative, never both.
--
-- New clinics default to the tenant-native core. Relife is pinned to `sheets`
-- explicitly below and keeps its current live authority untouched; flipping it
-- is the later, evidence-gated cutover, not this migration.

alter table relife.clinic_settings
  add column if not exists operational_store text not null default 'supabase';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clinic_settings_operational_store_check'
  ) then
    alter table relife.clinic_settings
      add constraint clinic_settings_operational_store_check
      check (operational_store in ('sheets', 'supabase'));
  end if;
end
$$;

comment on column relife.clinic_settings.operational_store is
  'Which store is authoritative for this clinic''s operational record. Exactly one authority per clinic; never a dual writer.';

update relife.clinic_settings s
set operational_store = 'sheets', updated_at = now()
from relife.organizations o, relife.clinics c
where o.slug = 'relife' and c.slug = 'amtali-main'
  and s.organization_id = o.id and s.clinic_id = c.id;

-- ---------------------------------------------------------------------------
-- 6. Atomic operational writers
-- ---------------------------------------------------------------------------
-- Each user action commits as one transaction covering the record, any derived
-- balance, and its audit event. A multi-statement write driven from the
-- application could half-apply — a payment recorded with the patient balance
-- left stale — which is precisely the failure mode the Sheets batch writers
-- were built to avoid.
--
-- These functions are mechanical persistence, not policy. Authorization,
-- department rules, amount validation and the resulting balance are decided by
-- the domain layer and passed in; what happens here is storage, idempotency and
-- tenant enforcement. The tenant check is repeated inside the function because
-- service_role bypasses RLS, so this is the boundary that actually holds.

-- A clinic whose record still lives in Sheets must never gain a row here, or
-- its operational history silently splits across two stores with neither one
-- complete. Enforcing that in the writer rather than only at the call site
-- means a mistake in application routing cannot corrupt the data.
create or replace function relife.assert_tenant_native_store(
  p_organization_id uuid,
  p_clinic_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_store text;
begin
  select operational_store into v_store
  from relife.clinic_settings
  where organization_id = p_organization_id and clinic_id = p_clinic_id;

  if v_store is null then
    raise exception 'OPERATIONAL_STORE_NOT_CONFIGURED';
  end if;
  if v_store <> 'supabase' then
    raise exception 'OPERATIONAL_STORE_MISMATCH:supabase';
  end if;
end;
$$;

create or replace function relife.register_patient_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_actor_id text,
  p_request_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_patient_id text;
  v_phone text := btrim(coalesce(p_payload ->> 'phone', ''));
  v_existing text;
begin
  if p_organization_id is null or p_clinic_id is null then
    raise exception 'TENANT_SCOPE_REQUIRED';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  perform relife.assert_tenant_native_store(p_organization_id, p_clinic_id);
  if not exists (
    select 1 from relife.clinics
    where organization_id = p_organization_id and id = p_clinic_id
  ) then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  -- Retry of an already-applied registration returns the original patient.
  select patient_id into v_existing
  from relife.patients
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and request_id = p_request_id;
  if v_existing is not null then
    return jsonb_build_object('patientId', v_existing, 'duplicate', true);
  end if;

  if v_phone <> '' then
    select patient_id into v_existing
    from relife.patients
    where organization_id = p_organization_id
      and clinic_id = p_clinic_id
      and phone = v_phone
      and status = 'Active';
    if v_existing is not null then
      raise exception 'DUPLICATE_PHONE:%', v_existing;
    end if;
  end if;

  v_patient_id := relife.next_clinic_local_id(p_organization_id, p_clinic_id, 'patient', 'PT');

  insert into relife.patients (
    organization_id, clinic_id, patient_id, full_name, father_husband_name,
    phone, alternative_phone, age, gender, address, diagnosis, therapist,
    referral, remarks, registration_date, request_id, created_by
  ) values (
    p_organization_id, p_clinic_id, v_patient_id,
    btrim(coalesce(p_payload ->> 'fullName', '')),
    btrim(coalesce(p_payload ->> 'fatherHusbandName', '')),
    v_phone,
    btrim(coalesce(p_payload ->> 'alternativePhone', '')),
    btrim(coalesce(p_payload ->> 'age', '')),
    btrim(coalesce(p_payload ->> 'gender', '')),
    btrim(coalesce(p_payload ->> 'address', '')),
    btrim(coalesce(p_payload ->> 'diagnosis', '')),
    btrim(coalesce(p_payload ->> 'therapist', '')),
    btrim(coalesce(p_payload ->> 'referral', '')),
    btrim(coalesce(p_payload ->> 'remarks', '')),
    coalesce((p_payload ->> 'registrationDate')::date, current_date),
    p_request_id, p_actor_id
  );

  insert into relife.audit_events (
    organization_id, clinic_id, request_id, actor_id, action,
    entity_type, entity_id, patient_id, payload
  ) values (
    p_organization_id, p_clinic_id, p_request_id, p_actor_id, 'patient.create',
    'Patient', v_patient_id, v_patient_id,
    jsonb_build_object('patientId', v_patient_id, 'fullName', p_payload ->> 'fullName')
  );

  return jsonb_build_object('patientId', v_patient_id, 'duplicate', false);
end;
$$;

create or replace function relife.book_appointment_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_actor_id text,
  p_request_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_appointment_id text;
  v_existing text;
  v_patient_id text := btrim(coalesce(p_payload ->> 'patientId', ''));
  v_patient_name text;
  v_date date := (p_payload ->> 'date')::date;
  v_start_minute smallint := (p_payload ->> 'startMinute')::smallint;
begin
  if p_organization_id is null or p_clinic_id is null then
    raise exception 'TENANT_SCOPE_REQUIRED';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  perform relife.assert_tenant_native_store(p_organization_id, p_clinic_id);

  select appointment_id into v_existing
  from relife.appointments
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and request_id = p_request_id;
  if v_existing is not null then
    return jsonb_build_object('appointmentId', v_existing, 'duplicate', true);
  end if;

  -- The patient is resolved inside the tenant, so booking another clinic's
  -- patient cannot succeed even with a guessed id.
  select full_name into v_patient_name
  from relife.patients
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and patient_id = v_patient_id;
  if v_patient_name is null then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  if exists (
    select 1 from relife.appointments
    where organization_id = p_organization_id
      and clinic_id = p_clinic_id
      and patient_id = v_patient_id
      and appointment_date = v_date
      and start_minute = v_start_minute
      and status not in ('Cancelled', 'No-show')
  ) then
    raise exception 'APPOINTMENT_DUPLICATE';
  end if;

  v_appointment_id := relife.next_clinic_local_id(p_organization_id, p_clinic_id, 'appointment', 'AP');

  insert into relife.appointments (
    organization_id, clinic_id, appointment_id, patient_id, patient_name,
    appointment_date, start_minute, duration_min, therapist, remarks,
    request_id, created_by
  ) values (
    p_organization_id, p_clinic_id, v_appointment_id, v_patient_id, v_patient_name,
    v_date, v_start_minute,
    coalesce((p_payload ->> 'durationMin')::smallint, 60),
    btrim(coalesce(p_payload ->> 'therapist', '')),
    btrim(coalesce(p_payload ->> 'remarks', '')),
    p_request_id, p_actor_id
  );

  insert into relife.audit_events (
    organization_id, clinic_id, request_id, actor_id, action,
    entity_type, entity_id, patient_id, payload
  ) values (
    p_organization_id, p_clinic_id, p_request_id, p_actor_id, 'appointment.create',
    'Appointment', v_appointment_id, v_patient_id,
    jsonb_build_object(
      'appointmentId', v_appointment_id, 'patientId', v_patient_id,
      'date', v_date, 'startMinute', v_start_minute
    )
  );

  return jsonb_build_object('appointmentId', v_appointment_id, 'duplicate', false);
end;
$$;

create or replace function relife.record_payment_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_actor_id text,
  p_request_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_receipt_no text;
  v_existing record;
  v_patient_id text := btrim(coalesce(p_payload ->> 'patientId', ''));
  v_patient_name text;
  v_amount numeric(12,2) := coalesce((p_payload ->> 'amount')::numeric, 0);
  v_discount numeric(12,2) := coalesce((p_payload ->> 'discount')::numeric, 0);
  -- The resulting balance and status are decided by the finance domain and
  -- passed in. This function stores that outcome atomically; it does not
  -- reinterpret what the payment means.
  v_due numeric(12,2) := coalesce((p_payload ->> 'due')::numeric, 0);
  v_status text := coalesce(nullif(btrim(p_payload ->> 'paymentStatus'), ''), 'Due');
begin
  if p_organization_id is null or p_clinic_id is null then
    raise exception 'TENANT_SCOPE_REQUIRED';
  end if;
  if btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  perform relife.assert_tenant_native_store(p_organization_id, p_clinic_id);

  select receipt_no, due into v_existing
  from relife.payments
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'receiptNo', v_existing.receipt_no, 'due', v_existing.due, 'duplicate', true
    );
  end if;

  select full_name into v_patient_name
  from relife.patients
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and patient_id = v_patient_id;
  if v_patient_name is null then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  v_receipt_no := relife.next_clinic_local_id(p_organization_id, p_clinic_id, 'payment', 'RC');

  insert into relife.payments (
    organization_id, clinic_id, receipt_no, patient_id, patient_name,
    payment_date, amount, discount, due, payment_method, sessions, session_type,
    received_by, remarks, request_id
  ) values (
    p_organization_id, p_clinic_id, v_receipt_no, v_patient_id, v_patient_name,
    coalesce((p_payload ->> 'date')::date, current_date),
    v_amount, v_discount, v_due,
    p_payload ->> 'paymentMethod',
    coalesce((p_payload ->> 'sessions')::integer, 0),
    btrim(coalesce(p_payload ->> 'sessionType', '')),
    p_actor_id,
    btrim(coalesce(p_payload ->> 'remarks', '')),
    p_request_id
  );

  update relife.patients
  set paid = paid + v_amount,
      due = v_due,
      advance = coalesce((p_payload ->> 'advance')::numeric, advance),
      payment_status = v_status,
      updated_at = now()
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and patient_id = v_patient_id;

  insert into relife.audit_events (
    organization_id, clinic_id, request_id, actor_id, action,
    entity_type, entity_id, patient_id, payload
  ) values (
    p_organization_id, p_clinic_id, p_request_id, p_actor_id, 'payment.create',
    'Payment', v_receipt_no, v_patient_id,
    jsonb_build_object(
      'receiptNo', v_receipt_no, 'patientId', v_patient_id,
      'amount', v_amount, 'discount', v_discount, 'due', v_due
    )
  );

  return jsonb_build_object('receiptNo', v_receipt_no, 'due', v_due, 'duplicate', false);
end;
$$;

create or replace function relife.update_patient_profile_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_actor_id text,
  p_patient_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_current record;
  v_phone text;
begin
  if p_organization_id is null or p_clinic_id is null then
    raise exception 'TENANT_SCOPE_REQUIRED';
  end if;
  perform relife.assert_tenant_native_store(p_organization_id, p_clinic_id);

  select * into v_current
  from relife.patients
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and patient_id = p_patient_id;
  if not found then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  -- An omitted key means "leave unchanged"; an explicit null or empty string is
  -- a real edit. `?` distinguishes the two, which `coalesce` alone cannot.
  v_phone := case when p_payload ? 'phone'
    then btrim(coalesce(p_payload ->> 'phone', '')) else v_current.phone end;

  if v_phone <> '' and v_phone <> v_current.phone and exists (
    select 1 from relife.patients
    where organization_id = p_organization_id
      and clinic_id = p_clinic_id
      and patient_id <> p_patient_id
      and phone = v_phone
      and status = 'Active'
  ) then
    raise exception 'DUPLICATE_PHONE';
  end if;

  update relife.patients
  set full_name = case when p_payload ? 'fullName'
        then btrim(coalesce(p_payload ->> 'fullName', '')) else full_name end,
      phone = v_phone,
      age = case when p_payload ? 'age' then btrim(coalesce(p_payload ->> 'age', '')) else age end,
      gender = case when p_payload ? 'gender' then btrim(coalesce(p_payload ->> 'gender', '')) else gender end,
      address = case when p_payload ? 'address' then btrim(coalesce(p_payload ->> 'address', '')) else address end,
      diagnosis = case when p_payload ? 'diagnosis' then btrim(coalesce(p_payload ->> 'diagnosis', '')) else diagnosis end,
      therapist = case when p_payload ? 'therapist' then btrim(coalesce(p_payload ->> 'therapist', '')) else therapist end,
      status = case when p_payload ? 'status'
        then coalesce(nullif(btrim(p_payload ->> 'status'), ''), status) else status end,
      updated_at = now()
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and patient_id = p_patient_id;

  insert into relife.audit_events (
    organization_id, clinic_id, request_id, actor_id, action,
    entity_type, entity_id, patient_id, payload
  ) values (
    p_organization_id, p_clinic_id,
    'patient.update:' || p_patient_id || ':' || extract(epoch from clock_timestamp())::bigint,
    p_actor_id, 'patient.update', 'Patient', p_patient_id, p_patient_id, p_payload
  );

  return jsonb_build_object('patientId', p_patient_id);
end;
$$;

create or replace function relife.update_appointment_status_v1(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_actor_id text,
  p_appointment_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_patient_id text;
begin
  if p_organization_id is null or p_clinic_id is null then
    raise exception 'TENANT_SCOPE_REQUIRED';
  end if;
  perform relife.assert_tenant_native_store(p_organization_id, p_clinic_id);

  select patient_id into v_patient_id
  from relife.appointments
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and appointment_id = p_appointment_id;
  if v_patient_id is null then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  update relife.appointments
  set status = p_status, updated_at = now()
  where organization_id = p_organization_id
    and clinic_id = p_clinic_id
    and appointment_id = p_appointment_id;

  insert into relife.audit_events (
    organization_id, clinic_id, request_id, actor_id, action,
    entity_type, entity_id, patient_id, payload
  ) values (
    p_organization_id, p_clinic_id,
    'appointment.status:' || p_appointment_id || ':' || extract(epoch from clock_timestamp())::bigint,
    p_actor_id, 'appointment.update', 'Appointment', p_appointment_id, v_patient_id,
    jsonb_build_object('appointmentId', p_appointment_id, 'status', p_status)
  );

  return jsonb_build_object('appointmentId', p_appointment_id, 'status', p_status);
end;
$$;

do $$
declare
  fn text;
  operational_functions text[] := array[
    'relife.assert_tenant_native_store(uuid,uuid)',
    'relife.update_patient_profile_v1(uuid,uuid,text,text,jsonb)',
    'relife.update_appointment_status_v1(uuid,uuid,text,text,text)',
    'relife.register_patient_v1(uuid,uuid,text,text,jsonb)',
    'relife.book_appointment_v1(uuid,uuid,text,text,jsonb)',
    'relife.record_payment_v1(uuid,uuid,text,text,jsonb)'
  ];
begin
  foreach fn in array operational_functions loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Client-private RLS
-- ---------------------------------------------------------------------------
-- Same posture as the configuration tables: the browser roles are denied and
-- only the trusted server path is granted. service_role bypasses RLS, but the
-- table privilege must still exist or every server read fails.

do $$
declare
  t text;
  operational_tables text[] := array[
    'clinic_local_id_sequences',
    'patients',
    'appointments',
    'payments'
  ];
begin
  foreach t in array operational_tables loop
    execute format('alter table relife.%I enable row level security', t);
    execute format('revoke all on table relife.%I from anon, authenticated', t);
    -- Postgres has no `create policy if not exists`; the drop keeps a partial
    -- failure recoverable by re-running the migration.
    execute format('drop policy if exists %I on relife.%I', t || '_deny_anon', t);
    execute format(
      'create policy %I on relife.%I for all to anon using (false) with check (false)',
      t || '_deny_anon', t
    );
    execute format('drop policy if exists %I on relife.%I', t || '_deny_authenticated', t);
    execute format(
      'create policy %I on relife.%I for all to authenticated using (false) with check (false)',
      t || '_deny_authenticated', t
    );
    execute format(
      'grant select, insert, update, delete on table relife.%I to service_role', t
    );
  end loop;
end
$$;

commit;
