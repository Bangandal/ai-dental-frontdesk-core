import type { RuntimeMeta, RuntimeTurnInput } from './runtimeContracts.js';

export interface RuntimeClinicRecord {
  id: string;
  code: string;
  name: string;
  timezone: string;
  settingsJson: Record<string, unknown>;
}

export interface RuntimeContactRecord {
  id: string;
  clinicId: string;
  channel: string;
  externalUserId: string;
  chatId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  meta: Record<string, unknown>;
}

export interface RuntimeInboundEventRecord {
  id: string | null;
  duplicate: boolean;
}

export interface RuntimeMessageRecord {
  id: string;
}

export interface RuntimeConvoStateRecord {
  id: string;
  stateJson: Record<string, unknown>;
  stateVersion: number;
}

export interface RuntimeContactInput {
  clinicId: string;
  channel: string;
  externalUserId: string;
  chatId: string;
  meta?: RuntimeMeta;
}

export interface RuntimeInboundEventInput {
  clinicId: string;
  contactId: string;
  input: RuntimeTurnInput;
  dedupeKey: string;
  traceId: string;
}

export interface RuntimeInboundMessageInput {
  clinicId: string;
  contactId: string;
  input: RuntimeTurnInput;
}

export interface RuntimeContextRepository {
  resolveActiveClinicByCode(clinicCode: string): Promise<RuntimeClinicRecord | null>;
  getOrCreateContact(input: RuntimeContactInput): Promise<RuntimeContactRecord>;
  registerInboundEvent(input: RuntimeInboundEventInput): Promise<RuntimeInboundEventRecord>;
  saveInboundMessage(input: RuntimeInboundMessageInput): Promise<RuntimeMessageRecord>;
  loadOrInitConvoState(clinicId: string, contactId: string): Promise<RuntimeConvoStateRecord>;
}

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class PgRuntimeContextRepository implements RuntimeContextRepository {
  constructor(private readonly db: Queryable) {}

  async resolveActiveClinicByCode(clinicCode: string): Promise<RuntimeClinicRecord | null> {
    const result = await this.db.query<ClinicRow>(
      `select id, code, name, timezone, settings_json
       from core.clinics
       where code = $1
         and is_active = true
       limit 1`,
      [clinicCode],
    );

    return result.rows[0] === undefined ? null : mapClinicRow(result.rows[0]);
  }

  async getOrCreateContact(input: RuntimeContactInput): Promise<RuntimeContactRecord> {
    const result = await this.db.query<ContactRow>(
      `insert into core.contacts (
         clinic_id,
         channel,
         external_user_id,
         chat_id,
         username,
         first_name,
         last_name,
         language_code,
         meta
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       on conflict (clinic_id, channel, external_user_id) do update
       set chat_id = excluded.chat_id,
           username = excluded.username,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           language_code = excluded.language_code,
           meta = coalesce(core.contacts.meta, '{}'::jsonb) || excluded.meta,
           updated_at = now()
       returning *`,
      [
        input.clinicId,
        input.channel,
        input.externalUserId,
        input.chatId,
        input.meta?.username ?? null,
        input.meta?.first_name ?? null,
        input.meta?.last_name ?? null,
        input.meta?.language_code ?? null,
        JSON.stringify(input.meta ?? {}),
      ],
    );

    return mapContactRow(result.rows[0]);
  }

  async registerInboundEvent(input: RuntimeInboundEventInput): Promise<RuntimeInboundEventRecord> {
    const sourceMessageId = getSourceValue(input.input.meta?.message_id);
    const sourceUpdateId = getSourceValue(input.input.meta?.update_id);

    const result = await this.db.query<InboundEventRow>(
      `insert into core.inbound_events (
         clinic_id,
         contact_id,
         channel,
         external_user_id,
         dedupe_key,
         source_message_id,
         source_update_id,
         payload,
         trace_id,
         n8n_execution_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       on conflict do nothing
       returning id`,
      [
        input.clinicId,
        input.contactId,
        input.input.channel,
        input.input.external_user_id,
        input.dedupeKey,
        sourceMessageId,
        sourceUpdateId,
        JSON.stringify(input.input),
        input.traceId,
        input.input.meta?.n8n_execution_id ?? null,
      ],
    );

    const row = result.rows[0];

    return {
      id: row?.id ?? null,
      duplicate: row === undefined,
    };
  }

  async saveInboundMessage(input: RuntimeInboundMessageInput): Promise<RuntimeMessageRecord> {
    const result = await this.db.query<MessageRow>(
      `insert into core.messages (
         clinic_id,
         contact_id,
         direction,
         role,
         channel,
         text,
         message_type,
         status,
         provider_message_id,
         meta
       )
       values ($1, $2, 'inbound', 'user', $3, $4, 'text', 'created', $5, $6::jsonb)
       returning id`,
      [
        input.clinicId,
        input.contactId,
        input.input.channel,
        input.input.text,
        getSourceValue(input.input.meta?.message_id),
        JSON.stringify(input.input.meta ?? {}),
      ],
    );

    return { id: mapRequiredId(result.rows[0], 'message') };
  }

  async loadOrInitConvoState(clinicId: string, contactId: string): Promise<RuntimeConvoStateRecord> {
    const result = await this.db.query<ConvoStateRow>(
      `insert into core.convo_state (
         clinic_id,
         contact_id,
         state_json,
         state_version,
         last_user_message_at
       )
       values ($1, $2, '{}'::jsonb, 1, now())
       on conflict (clinic_id, contact_id) do update
       set last_user_message_at = now(),
           updated_at = now()
       returning id, state_json, state_version`,
      [clinicId, contactId],
    );

    return mapConvoStateRow(result.rows[0]);
  }
}

type ClinicRow = Record<string, unknown> & {
  id: string;
  code: string;
  name: string;
  timezone: string | null;
  settings_json: Record<string, unknown> | null;
};

type ContactRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  channel: string;
  external_user_id: string;
  chat_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  meta: Record<string, unknown> | null;
};

type InboundEventRow = Record<string, unknown> & {
  id: string;
};

type MessageRow = Record<string, unknown> & {
  id: string;
};

type ConvoStateRow = Record<string, unknown> & {
  id: string;
  state_json: Record<string, unknown> | null;
  state_version: number;
};

function mapClinicRow(row: ClinicRow): RuntimeClinicRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    timezone: row.timezone ?? 'UTC',
    settingsJson: row.settings_json ?? {},
  };
}

function mapContactRow(row: ContactRow | undefined): RuntimeContactRecord {
  if (row === undefined) {
    throw new Error('Expected contact row');
  }

  return {
    id: row.id,
    clinicId: row.clinic_id,
    channel: row.channel,
    externalUserId: row.external_user_id,
    chatId: row.chat_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    languageCode: row.language_code,
    meta: row.meta ?? {},
  };
}

function mapConvoStateRow(row: ConvoStateRow | undefined): RuntimeConvoStateRecord {
  if (row === undefined) {
    throw new Error('Expected convo_state row');
  }

  return {
    id: row.id,
    stateJson: row.state_json ?? {},
    stateVersion: row.state_version,
  };
}

function mapRequiredId(row: { id: string } | undefined, label: string): string {
  if (row === undefined) {
    throw new Error(`Expected ${label} row`);
  }

  return row.id;
}

function getSourceValue(value: string | number | undefined): string | null {
  return value === undefined ? null : String(value);
}
