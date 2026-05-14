# DB Schema Snapshot

Source: live Supabase `core` schema snapshot provided on 2026-05-14.

Important:
- Repo migrations are not the full production schema.
- Do not create duplicate base tables unless explicitly requested.
- Runtime repositories must target the existing `core` schema.
- No secrets are included in this document.

## Relevant runtime tables

### core.clinics
- id uuid
- code text not null
- name text not null
- is_active boolean not null default true
- timezone text not null default 'Europe/Prague'
- settings_json jsonb not null default '{}'
- created_at timestamptz
- updated_at timestamptz

Runtime use:
- Resolve active clinic by code.

### core.contacts
- id uuid
- clinic_id uuid not null
- channel text not null
- external_user_id text not null
- chat_id text nullable
- username text nullable
- first_name text nullable
- last_name text nullable
- phone text nullable
- language_code text nullable
- meta jsonb not null default '{}'
- created_at timestamptz
- updated_at timestamptz

Runtime use:
- Get/create contact by clinic_id + channel + external_user_id.
- Update Telegram profile fields on each turn.

### core.inbound_events
- id uuid
- clinic_id uuid not null
- contact_id uuid not null
- channel text not null
- external_user_id text not null
- dedupe_key text not null
- source_message_id text nullable
- source_update_id text nullable
- payload jsonb not null
- received_at timestamptz default now()
- is_duplicate boolean default false
- runtime_status text default 'accepted'
- trace_id uuid not null
- n8n_execution_id text nullable
- case_id uuid nullable

Runtime use:
- Register inbound event.
- Detect duplicates if uniqueness constraints exist.

### core.messages
- id uuid
- clinic_id uuid not null
- contact_id uuid not null
- lead_id uuid nullable
- direction text not null
- role text not null
- channel text not null
- text text nullable
- message_type text not null default 'text'
- status text not null default 'created'
- provider_message_id text nullable
- reply_to_message_id uuid nullable
- meta jsonb not null default '{}'
- created_at timestamptz
- delivered_at timestamptz nullable
- failed_at timestamptz nullable
- case_id uuid nullable

Runtime use:
- Save inbound user message.
- Save outbound assistant message later.
- Use direction/role:
  - inbound/user
  - outbound/assistant

### core.convo_state
Important: this table has NO id column.

Columns:
- contact_id uuid not null
- clinic_id uuid not null
- state_json jsonb not null default '{}'
- state_version integer not null default 1
- last_user_message_at timestamptz nullable
- last_assistant_message_at timestamptz nullable
- qualification_status text nullable
- need_admin boolean not null default false
- last_intent text nullable
- updated_at timestamptz not null default now()

Runtime use:
- Load/init by clinic_id + contact_id.
- Do not SELECT or RETURN id from this table.

### core.cases
- id uuid
- clinic_id uuid not null
- contact_id uuid not null
- case_number integer not null
- case_type text not null default 'intake'
- topic text nullable
- status text not null default 'open'
- priority text not null default 'normal'
- source_channel text nullable
- summary text nullable
- collected jsonb not null default '{}'
- opened_at timestamptz
- last_activity_at timestamptz
- handoff_at timestamptz nullable
- admin_notified_at timestamptz nullable
- resolved_at timestamptz nullable
- closed_at timestamptz nullable
- close_reason text nullable
- meta jsonb not null default '{}'
- created_at timestamptz
- updated_at timestamptz

Runtime use:
- Not for PR 2 mutation.
- Case creation/update comes later.

### core.external_appointments
Existing booking service already uses this table.
Runtime must not rewrite booking logic.

### core.clinic_integrations
Existing appointment lifecycle uses this for Google Sheets.

### core.notifications
Later for admin notifications.

### core.inbound_message_batches
Exists already.
Future batching/debounce layer.
Not part of PR 2.

## PR 2 constraints

For PR 2:
- Do not add migrations.
- Do not implement AI.
- Do not implement booking.
- Do not mutate cases.
- Implement repositories against existing:
  - core.clinics
  - core.contacts
  - core.inbound_events
  - core.messages
  - core.convo_state
- RuntimeTurnService should return real clinic_id/contact_id.
- core.convo_state has no id column.
