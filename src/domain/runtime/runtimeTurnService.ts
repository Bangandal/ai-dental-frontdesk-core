import { randomUUID } from 'node:crypto';

import type { RuntimeTurnInput, RuntimeTurnResult } from './runtimeContracts.js';

export interface RuntimeClinicRecord {
  id: string;
  code: string;
  name: string;
  timezone: string;
  settings: Record<string, unknown>;
}

export interface RuntimeContactRecord {
  id: string;
  clinicId: string;
  channel: string;
  externalUserId: string;
}

export interface RuntimeInboundEventRecord {
  id: string;
  isDuplicate: boolean | null;
}

export interface RuntimeMessageRecord {
  id: string;
}

export interface RuntimeConvoStateRecord {
  contactId: string;
  clinicId: string;
  state: Record<string, unknown>;
  stateVersion: number;
}

export interface GetOrCreateRuntimeContactInput {
  clinicId: string;
  channel: string;
  externalUserId: string;
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  meta: Record<string, unknown>;
}

export interface RegisterInboundEventInput {
  clinicId: string;
  contactId: string;
  channel: string;
  externalUserId: string;
  dedupeKey: string;
  sourceMessageId: string | null;
  sourceUpdateId: string | null;
  payload: RuntimeTurnInput;
  traceId: string;
}

export interface SaveInboundUserMessageInput {
  clinicId: string;
  contactId: string;
  channel: string;
  text: string;
  providerMessageId: string | null;
  meta: Record<string, unknown>;
}

export interface LoadOrInitConvoStateInput {
  clinicId: string;
  contactId: string;
  lastUserMessageAt: Date;
}

export interface RuntimeTurnRepository {
  findActiveClinicByCode(code: string): Promise<RuntimeClinicRecord | null>;
  getOrCreateContact(input: GetOrCreateRuntimeContactInput): Promise<RuntimeContactRecord>;
  registerInboundEvent(input: RegisterInboundEventInput): Promise<RuntimeInboundEventRecord>;
  saveInboundUserMessage(input: SaveInboundUserMessageInput): Promise<RuntimeMessageRecord>;
  loadOrInitConvoState(input: LoadOrInitConvoStateInput): Promise<RuntimeConvoStateRecord>;
}

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

interface PgError extends Error {
  code?: string;
}

export class RuntimeClinicNotFoundError extends Error {
  readonly code = 'clinic_not_found';

  constructor(
    readonly clinicCode: string,
    readonly traceId: string,
  ) {
    super('Active clinic was not found for the provided clinic_code.');
    this.name = 'RuntimeClinicNotFoundError';
  }
}

export class RuntimeTurnService {
  constructor(private readonly repository: RuntimeTurnRepository) {}

  async handleTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
    const traceId = randomUUID();
    const sourceMessageId = stringifyOptional(input.meta?.message_id);
    const sourceUpdateId = stringifyOptional(input.meta?.update_id);
    const dedupeKey = buildInboundDedupeKey(input, sourceMessageId, sourceUpdateId, traceId);

    const clinic = await this.repository.findActiveClinicByCode(input.clinic_code);

    if (clinic === null) {
      throw new RuntimeClinicNotFoundError(input.clinic_code, traceId);
    }

    const contact = await this.repository.getOrCreateContact({
      clinicId: clinic.id,
      channel: input.channel,
      externalUserId: input.external_user_id,
      chatId: input.chat_id,
      username: input.meta?.username ?? null,
      firstName: input.meta?.first_name ?? null,
      lastName: input.meta?.last_name ?? null,
      languageCode: input.meta?.language_code ?? null,
      meta: input.meta ?? {},
    });

    const inboundEvent = await this.repository.registerInboundEvent({
      clinicId: clinic.id,
      contactId: contact.id,
      channel: input.channel,
      externalUserId: input.external_user_id,
      dedupeKey,
      sourceMessageId,
      sourceUpdateId,
      payload: input,
      traceId,
    });

    const userMessage = await this.repository.saveInboundUserMessage({
      clinicId: clinic.id,
      contactId: contact.id,
      channel: input.channel,
      text: input.text,
      providerMessageId: sourceMessageId,
      meta: {
        ...(input.meta ?? {}),
        inbound_event_id: inboundEvent.id,
        trace_id: traceId,
      },
    });

    const convoState = await this.repository.loadOrInitConvoState({
      clinicId: clinic.id,
      contactId: contact.id,
      lastUserMessageAt: new Date(),
    });

    return {
      trace_id: traceId,
      reply_text: 'Runtime endpoint is wired.',
      clinic_id: clinic.id,
      contact_id: contact.id,
      case_id: null,
      booking_result: null,
      side_effects: [],
      debug: {
        inbound_event_id: inboundEvent.id,
        user_message_id: userMessage.id,
        state_version: convoState.stateVersion,
        duplicate: inboundEvent.isDuplicate,
      },
    };
  }
}

export class PgRuntimeTurnRepository implements RuntimeTurnRepository {
  constructor(private readonly db: Queryable) {}

  async findActiveClinicByCode(code: string): Promise<RuntimeClinicRecord | null> {
    const result = await this.db.query<ClinicRow>(
      `select id, code, name, timezone, settings_json
       from core.clinics
       where code = $1
         and is_active = true
       limit 1`,
      [code],
    );

    return result.rows[0] === undefined ? null : mapClinicRow(result.rows[0]);
  }

  async getOrCreateContact(input: GetOrCreateRuntimeContactInput): Promise<RuntimeContactRecord> {
    const existing = await this.findContact(input.clinicId, input.channel, input.externalUserId);

    if (existing !== null) {
      const updated = await this.db.query<ContactRow>(
        `update core.contacts
         set chat_id = $4,
             username = $5,
             first_name = $6,
             last_name = $7,
             language_code = $8,
             meta = meta || $9::jsonb,
             updated_at = now()
         where clinic_id = $1
           and channel = $2
           and external_user_id = $3
         returning id, clinic_id, channel, external_user_id`,
        [
          input.clinicId,
          input.channel,
          input.externalUserId,
          input.chatId,
          input.username ?? null,
          input.firstName ?? null,
          input.lastName ?? null,
          input.languageCode ?? null,
          JSON.stringify(input.meta),
        ],
      );

      return mapContactRow(updated.rows[0]);
    }

    try {
      const inserted = await this.db.query<ContactRow>(
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
         returning id, clinic_id, channel, external_user_id`,
        [
          input.clinicId,
          input.channel,
          input.externalUserId,
          input.chatId,
          input.username ?? null,
          input.firstName ?? null,
          input.lastName ?? null,
          input.languageCode ?? null,
          JSON.stringify(input.meta),
        ],
      );

      return mapContactRow(inserted.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const contact = await this.findContact(input.clinicId, input.channel, input.externalUserId);

        if (contact !== null) {
          return contact;
        }
      }

      throw error;
    }
  }

  async registerInboundEvent(input: RegisterInboundEventInput): Promise<RuntimeInboundEventRecord> {
    try {
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
           trace_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid)
         returning id, is_duplicate`,
        [
          input.clinicId,
          input.contactId,
          input.channel,
          input.externalUserId,
          input.dedupeKey,
          input.sourceMessageId,
          input.sourceUpdateId,
          JSON.stringify(input.payload),
          input.traceId,
        ],
      );

      return mapInboundEventRow(result.rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const duplicate = await this.db.query<InboundEventRow>(
        `select id, is_duplicate
         from core.inbound_events
         where clinic_id = $1
           and dedupe_key = $2
         limit 1`,
        [input.clinicId, input.dedupeKey],
      );

      const row = duplicate.rows[0];

      if (row === undefined) {
        throw error;
      }

      return {
        id: row.id,
        isDuplicate: true,
      };
    }
  }

  async saveInboundUserMessage(input: SaveInboundUserMessageInput): Promise<RuntimeMessageRecord> {
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
        input.channel,
        input.text,
        input.providerMessageId,
        JSON.stringify(input.meta),
      ],
    );

    return mapMessageRow(result.rows[0]);
  }

  async loadOrInitConvoState(input: LoadOrInitConvoStateInput): Promise<RuntimeConvoStateRecord> {
    const existing = await this.findConvoState(input.clinicId, input.contactId);

    if (existing !== null) {
      const result = await this.db.query<ConvoStateRow>(
        `update core.convo_state
         set last_user_message_at = $3,
             updated_at = now()
         where clinic_id = $1
           and contact_id = $2
         returning contact_id, clinic_id, state_json, state_version`,
        [input.clinicId, input.contactId, input.lastUserMessageAt],
      );

      return mapConvoStateRow(result.rows[0]);
    }

    try {
      const result = await this.db.query<ConvoStateRow>(
        `insert into core.convo_state (
           clinic_id,
           contact_id,
           state_json,
           state_version,
           last_user_message_at
         )
         values ($1, $2, '{}'::jsonb, 1, $3)
         returning contact_id, clinic_id, state_json, state_version`,
        [input.clinicId, input.contactId, input.lastUserMessageAt],
      );

      return mapConvoStateRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const state = await this.findConvoState(input.clinicId, input.contactId);

        if (state !== null) {
          return state;
        }
      }

      throw error;
    }
  }

  private async findContact(
    clinicId: string,
    channel: string,
    externalUserId: string,
  ): Promise<RuntimeContactRecord | null> {
    const result = await this.db.query<ContactRow>(
      `select id, clinic_id, channel, external_user_id
       from core.contacts
       where clinic_id = $1
         and channel = $2
         and external_user_id = $3
       limit 1`,
      [clinicId, channel, externalUserId],
    );

    return result.rows[0] === undefined ? null : mapContactRow(result.rows[0]);
  }

  private async findConvoState(clinicId: string, contactId: string): Promise<RuntimeConvoStateRecord | null> {
    const result = await this.db.query<ConvoStateRow>(
      `select contact_id, clinic_id, state_json, state_version
       from core.convo_state
       where clinic_id = $1
         and contact_id = $2
       limit 1`,
      [clinicId, contactId],
    );

    return result.rows[0] === undefined ? null : mapConvoStateRow(result.rows[0]);
  }
}

function buildInboundDedupeKey(
  input: RuntimeTurnInput,
  sourceMessageId: string | null,
  sourceUpdateId: string | null,
  traceId: string,
): string {
  const sourceId = sourceUpdateId ?? sourceMessageId ?? traceId;

  return [input.channel, input.external_user_id, sourceId].join(':');
}

function stringifyOptional(value: string | number | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return String(value);
}

function isUniqueViolation(error: unknown): error is PgError {
  return error instanceof Error && (error as PgError).code === '23505';
}

type ClinicRow = Record<string, unknown> & {
  id: string;
  code: string;
  name: string;
  timezone: string;
  settings_json: Record<string, unknown> | null;
};

type ContactRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  channel: string;
  external_user_id: string;
};

type InboundEventRow = Record<string, unknown> & {
  id: string;
  is_duplicate: boolean | null;
};

type MessageRow = Record<string, unknown> & {
  id: string;
};

type ConvoStateRow = Record<string, unknown> & {
  contact_id: string;
  clinic_id: string;
  state_json: Record<string, unknown> | null;
  state_version: number;
};

function mapClinicRow(row: ClinicRow): RuntimeClinicRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    settings: row.settings_json ?? {},
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
  };
}

function mapInboundEventRow(row: InboundEventRow | undefined): RuntimeInboundEventRecord {
  if (row === undefined) {
    throw new Error('Expected inbound event row');
  }

  return {
    id: row.id,
    isDuplicate: row.is_duplicate,
  };
}

function mapMessageRow(row: MessageRow | undefined): RuntimeMessageRecord {
  if (row === undefined) {
    throw new Error('Expected message row');
  }

  return {
    id: row.id,
  };
}

function mapConvoStateRow(row: ConvoStateRow | undefined): RuntimeConvoStateRecord {
  if (row === undefined) {
    throw new Error('Expected convo state row');
  }

  return {
    contactId: row.contact_id,
    clinicId: row.clinic_id,
    state: row.state_json ?? {},
    stateVersion: row.state_version,
  };
}
