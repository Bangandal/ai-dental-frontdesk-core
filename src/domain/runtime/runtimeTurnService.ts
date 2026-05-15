import { randomUUID } from 'node:crypto';

import { AppointmentStatus } from '../appointments/appointmentStatus.js';
import { CaseStatus } from '../cases/caseStatus.js';
import type { RuntimeTurnInput, RuntimeTurnResult } from './runtimeContracts.js';
import {
  formatRuntimeAIError,
  NoopRuntimeAIClient,
  parseRuntimeAIOutput,
  RUNTIME_AI_SAFE_FALLBACK_REPLY,
  type RuntimeAIClient,
} from './runtimeAiClient.js';
import { buildRuntimePrompt } from './runtimePrompt.js';

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

export interface RuntimeCaseRecord {
  id: string;
  clinicId: string;
  contactId: string;
  caseNumber: number;
  caseType: string;
  topic: string | null;
  status: string;
  priority: string;
  summary: string | null;
  lastActivityAt: string;
  collected: Record<string, unknown>;
}

export interface RuntimeCaseContext {
  current_case_id: string | null;
  current_case: RuntimeCaseCompact | null;
  open_cases_count: number;
  recent_cases_count: number;
  hard_handoff_mode: boolean;
  case_relation: 'none' | 'current_open_case' | 'latest_handed_off_case' | 'latest_non_open_case';
}

export interface RuntimeCaseCompact {
  id: string;
  case_number: number;
  case_type: string;
  topic: string | null;
  status: string;
  priority: string;
  summary: string | null;
  last_activity_at: string;
  collected: Record<string, unknown>;
}

export interface RuntimeExternalAppointmentRecord {
  id: string;
  clinicId: string;
  contactId: string;
  caseId: string | null;
  externalProvider: string;
  service: string | null;
  startAt: string;
  endAt: string;
  status: string;
  dedupeKey: string;
  cellRange: string | null;
  sheetName: string | null;
  externalRecordId: string | null;
  meta: Record<string, unknown>;
}

export interface RuntimeBookingContext {
  active_hold: RuntimeActiveHoldContext | null;
  latest_appointment: RuntimeLatestAppointmentContext | null;
}

export interface RuntimeActiveHoldContext {
  hold_id: string;
  dedupe_key: string;
  appointment_id: string;
  case_id: string | null;
  status: string;
  service_interest: string | null;
  service: string | null;
  start_at: string;
  end_at: string;
  label: string | null;
  provider_metadata: Record<string, unknown>;
}

export interface RuntimeLatestAppointmentContext {
  appointment_id: string;
  case_id: string | null;
  status: string;
  service_interest: string | null;
  service: string | null;
  start_at: string;
  end_at: string;
  patient_confirmed_at: string | null;
  admin_confirmed_at: string | null;
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
  listRecentCases(clinicId: string, contactId: string): Promise<RuntimeCaseRecord[]>;
  findLatestHeldAppointmentForContactOrCase(
    clinicId: string,
    contactId: string,
    caseId: string | null,
  ): Promise<RuntimeExternalAppointmentRecord | null>;
  findLatestExternalAppointmentForContactOrCase(
    clinicId: string,
    contactId: string,
    caseId: string | null,
  ): Promise<RuntimeExternalAppointmentRecord | null>;
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
  constructor(
    private readonly repository: RuntimeTurnRepository,
    private readonly aiClient: RuntimeAIClient = new NoopRuntimeAIClient(),
  ) {}

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

    const caseContext = await loadRuntimeCaseContext(this.repository, clinic.id, contact.id);
    const bookingContext = await loadRuntimeBookingContext(
      this.repository,
      clinic.id,
      contact.id,
      caseContext.current_case_id,
    );

    const prompt = buildRuntimePrompt({
      traceId,
      clinic,
      contact,
      turn: input,
      convoState,
      caseContext,
      bookingContext,
    });
    const debug: Record<string, unknown> = {
      inbound_event_id: inboundEvent.id,
      user_message_id: userMessage.id,
      state_version: convoState.stateVersion,
      duplicate: inboundEvent.isDuplicate,
      case_context: caseContext,
      booking_context: bookingContext,
      prompt_version: prompt.prompt_version,
    };

    if (this.aiClient.provider !== undefined) {
      debug.ai_provider = this.aiClient.provider;
    }

    if (this.aiClient.model !== undefined) {
      debug.ai_model = this.aiClient.model;
    }
    let replyText = RUNTIME_AI_SAFE_FALLBACK_REPLY;

    try {
      const rawAIOutput = await this.aiClient.extract({
        trace_id: traceId,
        prompt_version: prompt.prompt_version,
        system_prompt: prompt.system_prompt,
        context: prompt.context,
      });
      const aiOutput = parseRuntimeAIOutput(rawAIOutput);
      debug.ai_output = aiOutput;
      replyText = aiOutput.reply_draft ?? RUNTIME_AI_SAFE_FALLBACK_REPLY;
    } catch (error) {
      debug.ai_error = formatRuntimeAIError(error);
    }

    return {
      trace_id: traceId,
      reply_text: replyText,
      clinic_id: clinic.id,
      contact_id: contact.id,
      case_id: caseContext.current_case_id,
      booking_result: null,
      side_effects: [],
      debug,
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

  async listRecentCases(clinicId: string, contactId: string): Promise<RuntimeCaseRecord[]> {
    const result = await this.db.query<RuntimeCaseRow>(
      `select id,
              clinic_id,
              contact_id,
              case_number,
              case_type,
              topic,
              status,
              priority,
              summary,
              last_activity_at,
              collected
       from core.cases
       where clinic_id = $1
         and contact_id = $2
         and not (status = any($3))
       order by last_activity_at desc, created_at desc
       limit 10`,
      [clinicId, contactId, RuntimeTerminalCaseStatuses],
    );

    return result.rows.map(mapRuntimeCaseRow);
  }

  async findLatestHeldAppointmentForContactOrCase(
    clinicId: string,
    contactId: string,
    caseId: string | null,
  ): Promise<RuntimeExternalAppointmentRecord | null> {
    const result = await this.db.query<RuntimeExternalAppointmentRow>(
      `select id,
              clinic_id,
              contact_id,
              case_id,
              external_provider,
              service,
              start_at,
              end_at,
              status,
              dedupe_key,
              cell_range,
              sheet_name,
              external_record_id,
              meta
       from core.external_appointments
       where clinic_id = $1
         and status = $3
         and (
           contact_id = $2
           or ($4::uuid is not null and case_id = $4::uuid)
         )
       order by created_at desc
       limit 1`,
      [clinicId, contactId, AppointmentStatus.Held, caseId],
    );

    return result.rows[0] === undefined ? null : mapRuntimeExternalAppointmentRow(result.rows[0]);
  }

  async findLatestExternalAppointmentForContactOrCase(
    clinicId: string,
    contactId: string,
    caseId: string | null,
  ): Promise<RuntimeExternalAppointmentRecord | null> {
    const result = await this.db.query<RuntimeExternalAppointmentRow>(
      `select id,
              clinic_id,
              contact_id,
              case_id,
              external_provider,
              service,
              start_at,
              end_at,
              status,
              dedupe_key,
              cell_range,
              sheet_name,
              external_record_id,
              meta
       from core.external_appointments
       where clinic_id = $1
         and (
           contact_id = $2
           or ($3::uuid is not null and case_id = $3::uuid)
         )
       order by created_at desc
       limit 1`,
      [clinicId, contactId, caseId],
    );

    return result.rows[0] === undefined ? null : mapRuntimeExternalAppointmentRow(result.rows[0]);
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

type RuntimeCaseRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  contact_id: string;
  case_number: number;
  case_type: string;
  topic: string | null;
  status: string;
  priority: string;
  summary: string | null;
  last_activity_at: Date | string;
  collected: Record<string, unknown> | null;
};

type RuntimeExternalAppointmentRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  contact_id: string;
  case_id: string | null;
  external_provider: string;
  service: string | null;
  start_at: Date | string;
  end_at: Date | string;
  status: string;
  dedupe_key: string;
  cell_range: string | null;
  sheet_name: string | null;
  external_record_id: string | null;
  meta: Record<string, unknown> | null;
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


async function loadRuntimeCaseContext(
  repository: RuntimeTurnRepository,
  clinicId: string,
  contactId: string,
): Promise<RuntimeCaseContext> {
  const recentCases = await repository.listRecentCases(clinicId, contactId);
  const currentCase = recentCases[0] ?? null;
  const compactCase = currentCase === null ? null : toCompactCase(currentCase);
  const openCasesCount = recentCases.filter((caseRecord) => isOpenCaseStatus(caseRecord.status)).length;

  return {
    current_case_id: compactCase?.id ?? null,
    current_case: compactCase,
    open_cases_count: openCasesCount,
    recent_cases_count: recentCases.length,
    hard_handoff_mode: currentCase?.status === CaseStatus.HandedOff,
    case_relation: getCaseRelation(currentCase),
  };
}

async function loadRuntimeBookingContext(
  repository: RuntimeTurnRepository,
  clinicId: string,
  contactId: string,
  caseId: string | null,
): Promise<RuntimeBookingContext> {
  const [activeHold, latestAppointment] = await Promise.all([
    repository.findLatestHeldAppointmentForContactOrCase(clinicId, contactId, caseId),
    repository.findLatestExternalAppointmentForContactOrCase(clinicId, contactId, caseId),
  ]);

  return {
    active_hold: activeHold === null ? null : toActiveHoldContext(activeHold),
    latest_appointment: latestAppointment === null ? null : toLatestAppointmentContext(latestAppointment),
  };
}

function toCompactCase(caseRecord: RuntimeCaseRecord): RuntimeCaseCompact {
  return {
    id: caseRecord.id,
    case_number: caseRecord.caseNumber,
    case_type: caseRecord.caseType,
    topic: caseRecord.topic,
    status: caseRecord.status,
    priority: caseRecord.priority,
    summary: caseRecord.summary,
    last_activity_at: caseRecord.lastActivityAt,
    collected: caseRecord.collected,
  };
}

function toActiveHoldContext(appointment: RuntimeExternalAppointmentRecord): RuntimeActiveHoldContext {
  const providerMetadata = readProviderMetadata(appointment);

  return {
    hold_id: appointment.dedupeKey,
    dedupe_key: appointment.dedupeKey,
    appointment_id: appointment.id,
    case_id: appointment.caseId,
    status: appointment.status,
    service_interest: appointment.service,
    service: appointment.service,
    start_at: appointment.startAt,
    end_at: appointment.endAt,
    label: formatAppointmentLabel(appointment, providerMetadata),
    provider_metadata: providerMetadata,
  };
}

function toLatestAppointmentContext(appointment: RuntimeExternalAppointmentRecord): RuntimeLatestAppointmentContext {
  return {
    appointment_id: appointment.id,
    case_id: appointment.caseId,
    status: appointment.status,
    service_interest: appointment.service,
    service: appointment.service,
    start_at: appointment.startAt,
    end_at: appointment.endAt,
    patient_confirmed_at: readOptionalString(appointment.meta, 'patient_confirmed_at'),
    admin_confirmed_at: readOptionalString(appointment.meta, 'admin_confirmed_at'),
  };
}

function getCaseRelation(caseRecord: RuntimeCaseRecord | null): RuntimeCaseContext['case_relation'] {
  if (caseRecord === null) {
    return 'none';
  }

  if (caseRecord.status === CaseStatus.HandedOff) {
    return 'latest_handed_off_case';
  }

  if (isOpenCaseStatus(caseRecord.status)) {
    return 'current_open_case';
  }

  return 'latest_non_open_case';
}

function isOpenCaseStatus(status: string): boolean {
  return RuntimeCurrentCaseStatuses.has(status);
}

const RuntimeCurrentCaseStatuses = new Set<string>([
  CaseStatus.Open,
  'collecting',
  'awaiting_patient_confirmation',
  CaseStatus.AppointmentBookedPendingAdminConfirmation,
  'booked_pending_admin_confirmation',
]);

const RuntimeTerminalCaseStatuses = [
  CaseStatus.Closed,
  'cancelled',
  'canceled',
  'resolved',
];

function readProviderMetadata(appointment: RuntimeExternalAppointmentRecord): Record<string, unknown> {
  const metadata = appointment.meta.provider_metadata;

  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  const storedSlot = appointment.meta.slot;
  if (storedSlot !== null && typeof storedSlot === 'object' && !Array.isArray(storedSlot)) {
    const slotMetadata = (storedSlot as Record<string, unknown>).metadata;
    if (slotMetadata !== null && typeof slotMetadata === 'object' && !Array.isArray(slotMetadata)) {
      return slotMetadata as Record<string, unknown>;
    }
  }

  return {
    cell_range: appointment.cellRange,
    sheet_name: appointment.sheetName,
    external_record_id: appointment.externalRecordId,
  };
}

function formatAppointmentLabel(
  appointment: RuntimeExternalAppointmentRecord,
  providerMetadata: Record<string, unknown>,
): string | null {
  const timezone = readOptionalString(providerMetadata, 'timezone') ?? readSlotTimezone(appointment.meta) ?? 'UTC';

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(appointment.startAt));
  } catch {
    return null;
  }
}

function readSlotTimezone(meta: Record<string, unknown>): string | null {
  const storedSlot = meta.slot;

  if (storedSlot === null || typeof storedSlot !== 'object' || Array.isArray(storedSlot)) {
    return null;
  }

  return readOptionalString(storedSlot as Record<string, unknown>, 'timezone');
}

function readOptionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapRuntimeCaseRow(row: RuntimeCaseRow): RuntimeCaseRecord {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    contactId: row.contact_id,
    caseNumber: row.case_number,
    caseType: row.case_type,
    topic: row.topic,
    status: row.status,
    priority: row.priority,
    summary: row.summary,
    lastActivityAt: toIso(row.last_activity_at),
    collected: row.collected ?? {},
  };
}

function mapRuntimeExternalAppointmentRow(row: RuntimeExternalAppointmentRow): RuntimeExternalAppointmentRecord {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    contactId: row.contact_id,
    caseId: row.case_id,
    externalProvider: row.external_provider,
    service: row.service,
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    status: row.status,
    dedupeKey: row.dedupe_key,
    cellRange: row.cell_range,
    sheetName: row.sheet_name,
    externalRecordId: row.external_record_id,
    meta: row.meta ?? {},
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
