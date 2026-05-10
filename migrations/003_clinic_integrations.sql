create extension if not exists pgcrypto;

create schema if not exists core;

create table if not exists core.clinic_integrations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references core.clinics(id),
  provider text not null,
  name text not null,
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  secrets_ref text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_integrations_clinic_provider_name_key unique (clinic_id, provider, name)
);

create index if not exists clinic_integrations_clinic_id_idx
  on core.clinic_integrations (clinic_id);

create index if not exists clinic_integrations_clinic_provider_active_idx
  on core.clinic_integrations (clinic_id, provider, is_active);

create index if not exists clinic_integrations_active_idx
  on core.clinic_integrations (is_active)
  where is_active = true;

create index if not exists clinic_integrations_config_gin_idx
  on core.clinic_integrations using gin (config);

do $$
begin
  if to_regproc('core._touch_updated_at') is not null then
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'clinic_integrations_touch_updated_at'
        and tgrelid = 'core.clinic_integrations'::regclass
    ) then
      create trigger clinic_integrations_touch_updated_at
        before update on core.clinic_integrations
        for each row
        execute function core._touch_updated_at();
    end if;
  end if;
end;
$$;
