create extension if not exists pgcrypto;

create schema if not exists core;

create table if not exists core.cases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references core.clinics(id),
  contact_id uuid not null references core.contacts(id),
  lead_id uuid null references core.leads(id),
  case_type text not null,
  topic text null,
  status text not null default 'open',
  current_stage text null,
  summary text null,
  collected jsonb not null default '{}'::jsonb,
  source_channel text null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  last_activity_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_status_check check (
    status in ('open', 'appointment_booked_pending_admin_confirmation', 'handed_off', 'closed')
  )
);

create index if not exists cases_clinic_id_idx
  on core.cases (clinic_id);

create index if not exists cases_contact_id_idx
  on core.cases (contact_id);

create index if not exists cases_lead_id_idx
  on core.cases (lead_id)
  where lead_id is not null;

create index if not exists cases_clinic_status_last_activity_idx
  on core.cases (clinic_id, status, last_activity_at desc);

create index if not exists cases_clinic_case_type_idx
  on core.cases (clinic_id, case_type);

create index if not exists cases_opened_at_idx
  on core.cases (opened_at desc);

create index if not exists cases_collected_gin_idx
  on core.cases using gin (collected);

create index if not exists cases_meta_gin_idx
  on core.cases using gin (meta);

do $$
begin
  if to_regproc('core._touch_updated_at') is not null then
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'cases_touch_updated_at'
        and tgrelid = 'core.cases'::regclass
    ) then
      create trigger cases_touch_updated_at
        before update on core.cases
        for each row
        execute function core._touch_updated_at();
    end if;
  end if;
end;
$$;
