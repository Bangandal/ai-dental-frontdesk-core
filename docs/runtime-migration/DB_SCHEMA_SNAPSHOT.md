# DB Schema Snapshot

Source: live Supabase `core` schema snapshot provided on 2026-05-14.

Important:
- Repo migrations are not the full production schema.
- Do not create duplicate base tables unless explicitly requested.
- Runtime repositories must target the existing `core` schema.
- No secrets are included in this document.

## Existing core tables relevant to runtime

### core.clinics

Columns:
- id uuid not null default gen_random_uuid()
- code text not null
- name text not null
- is_active boolean not null default true
- timezone text not null default 'Europe/Prague'
- settings_json jsonb not null default '{}'
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Runtime use:
- Resolve clinic by `code`.
- Only active clinics should be used.

### core.contacts

Columns:
- id uuid not null default gen_random_uuid()
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
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Runtime use:
- Get/create contact by clinic_id + channel + external_user_id.
- Update chat_id, username, first_name, last_name, language_code, meta when new data arrives.
- Telegram phone is optional unless patient explicitly asks for callback.

### core.inbound_events

Columns:
- id uuid not null default gen_random_uuid()
- clinic_id uuid not null
- contact_id uuid not null
- channel text not null
- external_user_id text not null
- dedupe_key text not null
- source_message_id text nullable
- source_update_id text nullable
- payload jsonb not null
- received_at timestamptz not null default now()
- is_duplicate boolean not null default false
- runtime_status text not null default 'accepted'
- trace_id uuid not null
- n8n_execution_id text nullable
- case_id uuid nullable

Runtime use:
- Register every incoming transport event.
- Detect duplicates using dedupe_key.
- Return duplicate info in debug, but do not crash runtime.
- Link case_id later when case resolution exists.

### core.messages

Columns:
- id uuid not null default gen_random_uuid()
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
- created_at timestamptz not null default now()
- delivered_at timestamptz nullable
- failed_at timestamptz nullable
- case_id uuid nullable

Runtime use:
- Save inbound user message.
- Save outbound assistant message later.
- Use direction/role:
  - inbound/user
  - outbound/assistant
- case_id may be null before case resolution.

### core.convo_state

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
- Load/init state per clinic_id + contact_id.
- Store business/conversation state.
- Current schema is contact-level, not case-level.

### core.cases

Columns:
- id uuid not null default gen_random_uuid()
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
- opened_at timestamptz not null default now()
- last_activity_at timestamptz not null default now()
- handoff_at timestamptz nullable
- admin_notified_at timestamptz nullable
- resolved_at timestamptz nullable
- closed_at timestamptz nullable
- close_reason text nullable
- meta jsonb not null default '{}'
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Runtime use:
- Not for PR 2 mutation.
- PR 2 may read current/recent cases only if existing repository already supports it.
- Case creation/update comes later.

### core.case_events

Columns:
- id bigint not null
- clinic_id uuid not null
- contact_id uuid not null
- case_id uuid not null
- event_type text not null
- event_source text not null default 'runtime'
- trace_id uuid nullable
- message_id uuid nullable
- lead_id uuid nullable
- notification_id uuid nullable
- payload jsonb not null default '{}'
- created_at timestamptz not null default now()

Runtime use:
- Later for case audit events.

### core.events

Columns:
- id bigint not null
- trace_id uuid not null
- clinic_id uuid nullable
- contact_id uuid nullable
- lead_id uuid nullable
- inbound_event_id uuid nullable
- message_id uuid nullable
- notification_id uuid nullable
- event_type text not null
- event_stage text not null
- status text not null
- provider text nullable
- model text nullable
- latency_ms integer nullable
- payload jsonb not null default '{}'
- error_code text nullable
- error_text text nullable
- created_at timestamptz not null default now()
- n8n_execution_id text nullable
- case_id uuid nullable

Runtime use:
- Runtime trace/audit logging.
- Useful for errors and stage logs.

### core.external_appointments

Columns:
- id uuid not null default gen_random_uuid()
- clinic_id uuid not null
- contact_id uuid not null
- case_id uuid nullable
- lead_id uuid nullable
- external_provider text not null
- external_record_id text nullable
- sheet_name text nullable
- cell_range text nullable
- start_at timestamptz not null
- end_at timestamptz not null
- timezone text nullable
- service text nullable
- patient_name text nullable
- status text not null default 'held_pending_confirmation'
- dedupe_key text not null
- meta jsonb not null default '{}'
- last_error text nullable
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- external_calendar_id text nullable
- spreadsheet_id text nullable
- last_sync_at timestamptz nullable
- doctor jsonb nullable

Runtime use:
- Existing booking service already uses this table.
- Runtime should not rewrite this logic.
- Active hold/latest appointment should reuse existing appointment repository.

### core.clinic_integrations

Columns:
- id uuid not null default gen_random_uuid()
- clinic_id uuid not null
- provider text not null
- name text not null
- is_active boolean not null default true
- config jsonb not null default '{}'
- secrets_ref text nullable
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Runtime use:
- Existing appointment lifecycle uses this for Google Sheets.

### core.notifications

Columns:
- id uuid not null default gen_random_uuid()
- clinic_id uuid not null
- contact_id uuid nullable
- lead_id uuid nullable
- channel text not null
- recipient text not null
- template_key text not null
- dedupe_key text not null
- payload jsonb not null
- status text not null default 'pending'
- send_attempts integer not null default 0
- last_attempt_at timestamptz nullable
- sent_at timestamptz nullable
- failed_at timestamptz nullable
- provider_message_id text nullable
- error_text text nullable
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- case_id uuid nullable

Runtime use:
- Later for admin notification persistence.

### core.inbound_message_batches

Exists already.

Runtime use:
- Future batching/debounce layer.
- Not part of PR 2.

## PR 2 implementation constraints

For PR 2:
- Do not add migrations.
- Do not implement AI.
- Do not implement booking.
- Do not mutate cases yet.
- Implement repositories against existing core.clinics, core.contacts, core.inbound_events, core.messages, core.convo_state.
- RuntimeTurnService should return real clinic_id/contact_id after DB resolution.
- Use dependency injection and mock repositories in tests.
