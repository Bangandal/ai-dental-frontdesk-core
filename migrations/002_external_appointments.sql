create extension if not exists pgcrypto;

create schema if not exists core;

create table if not exists core.external_appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references core.clinics(id),
  contact_id uuid not null references core.contacts(id),
  case_id uuid null references core.cases(id),
  lead_id uuid null references core.leads(id),
  external_provider text not null,
  external_calendar_id text null,
  spreadsheet_id text null,
  sheet_name text null,
  cell_range text null,
  external_record_id text null,
  service text null,
  patient_name text null,
  doctor text null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'proposed',
  dedupe_key text not null,
  hold_expires_at timestamptz null,
  last_sync_at timestamptz null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_appointments_status_check check (
    status in (
      'proposed',
      'held',
      'booked_pending_admin_confirmation',
      'failed_external_write',
      'canceled',
      'expired',
      'admin_confirmed'
    )
  ),
  constraint external_appointments_clinic_dedupe_key_key unique (clinic_id, dedupe_key)
);

create index if not exists external_appointments_clinic_id_idx
  on core.external_appointments (clinic_id);

create index if not exists external_appointments_contact_id_idx
  on core.external_appointments (contact_id);

create index if not exists external_appointments_case_id_idx
  on core.external_appointments (case_id)
  where case_id is not null;

create index if not exists external_appointments_lead_id_idx
  on core.external_appointments (lead_id)
  where lead_id is not null;

create index if not exists external_appointments_clinic_status_start_idx
  on core.external_appointments (clinic_id, status, start_at);

create index if not exists external_appointments_clinic_provider_start_idx
  on core.external_appointments (clinic_id, external_provider, start_at);

create index if not exists external_appointments_external_record_idx
  on core.external_appointments (external_provider, external_record_id)
  where external_record_id is not null;

create index if not exists external_appointments_spreadsheet_sheet_idx
  on core.external_appointments (spreadsheet_id, sheet_name)
  where spreadsheet_id is not null;

create index if not exists external_appointments_hold_expires_at_idx
  on core.external_appointments (hold_expires_at)
  where hold_expires_at is not null;

create index if not exists external_appointments_meta_gin_idx
  on core.external_appointments using gin (meta);

do $$
begin
  if to_regproc('core._touch_updated_at') is not null then
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'external_appointments_touch_updated_at'
        and tgrelid = 'core.external_appointments'::regclass
    ) then
      create trigger external_appointments_touch_updated_at
        before update on core.external_appointments
        for each row
        execute function core._touch_updated_at();
    end if;
  end if;
end;
$$;
