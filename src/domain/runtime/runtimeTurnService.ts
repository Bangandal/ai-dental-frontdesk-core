import { randomUUID } from 'node:crypto';

import { AppointmentStatus } from '../appointments/appointmentStatus.js';
import type { BookingApplyRequest, BookingApplyResponse } from '../booking/bookingApply.js';
import { CaseStatus } from '../cases/caseStatus.js';
import type { RuntimeAIOutput, RuntimeSideEffect, RuntimeTurnInput, RuntimeTurnResult } from './runtimeContracts.js';
import {
  formatRuntimeAIError,
  NoopRuntimeAIClient,
  parseRuntimeAIOutput,
  type RuntimeAIClient,
} from './runtimeAiClient.js';
import { buildRuntimePrompt } from './runtimePrompt.js';
import { getClinicLocalDateIso, normalizeRuntimeAIOutputDates } from './runtimeDateNormalizer.js';
import { classifyRuntimeConversationMode, type RuntimeConversationMode } from './runtimeConversationMode.js';
import { decideRuntimeAction, type RuntimePolicyDecision } from './runtimePolicy.js';
import { buildRuntimeReplyBehavior } from './runtimeReplyBehavior.js';
import { resolveRuntimeReplyLanguage } from './runtimeReplyLanguage.js';
import { runtimeReplyTemplate } from './runtimeReplyTemplates.js';
import {
  DeterministicRuntimeKnowledgeReplyComposer,
  type RuntimeKnowledgeReplyComposer,
} from './runtimeKnowledgeReplyComposer.js';
import type { RuntimeReplySource } from './runtimeReplyBuilder.js';
import type { RuntimeEmbeddingClient } from './runtimeEmbeddingClient.js';
import { NoopRuntimeKnowledgeRepository, type RuntimeKnowledgeRepository, type RuntimeKnowledgeResult } from './runtimeKnowledgeRepository.js';

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

export interface CreateAdminNotificationInput {
  clinicId: string;
  contactId: string;
  caseId: string | null;
  leadId: string | null;
  channel: string;
  recipient: string;
  templateKey: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  traceId: string;
}

export interface RuntimeAdminNotificationRecord {
  notification_id: string;
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

export interface SaveOutboundAssistantMessageInput {
  clinicId: string;
  contactId: string;
  caseId: string | null;
  channel: string;
  text: string;
  traceId: string;
  replyToMessageId?: string | null;
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
  saveOutboundAssistantMessage(input: SaveOutboundAssistantMessageInput): Promise<RuntimeMessageRecord>;
  createAdminNotification(input: CreateAdminNotificationInput): Promise<RuntimeAdminNotificationRecord>;
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

export interface RuntimeBookingApplyService {
  apply(request: BookingApplyRequest): Promise<BookingApplyResponse>;
}

export class RuntimeTurnService {
  constructor(
    private readonly repository: RuntimeTurnRepository,
    private readonly aiClient: RuntimeAIClient = new NoopRuntimeAIClient(),
    private readonly bookingApplyService?: RuntimeBookingApplyService,
    private readonly clock: () => Date = () => new Date(),
    private readonly knowledgeRepository: RuntimeKnowledgeRepository = new NoopRuntimeKnowledgeRepository(),
    private readonly embeddingClient?: RuntimeEmbeddingClient,
    private readonly knowledgeReplyComposer: RuntimeKnowledgeReplyComposer = new DeterministicRuntimeKnowledgeReplyComposer(),
  ) {}

  async handleTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
    const traceId = randomUUID();
    const turnStartedAt = this.clock();
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
      now: turnStartedAt,
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
    const responseLanguage = resolveRuntimeReplyLanguage({ meta: input.meta, clinic });
    debug.response_language = responseLanguage;
    let replyText = runtimeReplyTemplate(responseLanguage, 'safe_fallback');
    let replySource: RuntimeReplySource = 'safe_fallback';
    let bookingResult: BookingApplyResponse | null = null;
    let aiOutputForNotification: RuntimeAIOutput | null = null;
    let policyDecisionForReply: RuntimePolicyDecision | null = null;
    let conversationMode: RuntimeConversationMode = 'safe_fallback';
    let replySideEffects: RuntimeSideEffect[] = [];
    let knowledgeResult: RuntimeKnowledgeResult | null = null;
    let knowledgeReplyText: string | null = null;

    try {
      const rawAIOutput = await this.aiClient.extract({
        trace_id: traceId,
        prompt_version: prompt.prompt_version,
        system_prompt: prompt.system_prompt,
        context: prompt.context,
      });
      const parsedAIOutput = parseRuntimeAIOutput(rawAIOutput);
      const currentDateIso = getClinicLocalDateIso(clinic.timezone, turnStartedAt);
      const normalizationResult = normalizeRuntimeAIOutputDates({
        ai_output: parsedAIOutput,
        user_text: input.text,
        clinic_timezone: clinic.timezone,
        current_date_iso: currentDateIso,
      });
      const aiOutput = normalizationResult.ai_output;
      aiOutputForNotification = aiOutput;
      debug.ai_output_raw = parsedAIOutput;
      debug.ai_output = aiOutput;
      debug.date_normalization = normalizationResult.debug;
      const policyDecision = decideRuntimeAction({
        ai_output: aiOutput,
        case_context: caseContext,
        booking_context: bookingContext,
        clinic,
        contact_id: contact.id,
        channel: input.channel,
        meta: input.meta,
        trace_id: traceId,
        current_time_iso: turnStartedAt.toISOString(),
        current_clinic_date_iso: currentDateIso,
      });
      policyDecisionForReply = policyDecision;
      debug.policy_decision = policyDecision;

      if (policyDecision.should_call_booking && policyDecision.booking_request !== null && this.bookingApplyService !== undefined) {
        debug.booking_request = policyDecision.booking_request;

        try {
          bookingResult = await this.bookingApplyService.apply(policyDecision.booking_request);
          debug.booking_result = bookingResult;
          conversationMode = classifyRuntimeConversationMode({
            ai_output: aiOutput,
            booking_result: bookingResult,
            policy_decision: policyDecision,
            case_context: caseContext,
            booking_context: bookingContext,
          });
          const replyDecision = buildRuntimeReplyBehavior({
            conversation_mode: conversationMode,
            booking_result: bookingResult,
            policy_decision: policyDecision,
            case_context: caseContext,
            booking_context: bookingContext,
            clinic,
            ai_output: aiOutput,
            channel: input.channel,
            knowledge_result: knowledgeResult,
            knowledge_reply_text: knowledgeReplyText,
            response_language: responseLanguage,
          });
          replyText = replyDecision.reply_text;
          replySource = replyDecision.reply_source;
          replySideEffects = replyDecision.side_effects;
          debug.conversation_mode = conversationMode;
          debug.reply_source = replySource;
        } catch (error) {
          debug.booking_error = formatBookingApplyError(error);
          replySource = 'booking_error';
          debug.reply_source = replySource;
          replyText = runtimeReplyTemplate(responseLanguage, 'booking_error');
        }
      } else if (policyDecision.should_call_booking && this.bookingApplyService === undefined) {
        replySource = 'safe_fallback';
        debug.reply_source = replySource;
        debug.booking_request = policyDecision.booking_request;
        debug.booking_error = { code: 'booking_apply_service_unavailable' };
        replyText = runtimeReplyTemplate(responseLanguage, 'safe_fallback');
      } else {
        conversationMode = classifyRuntimeConversationMode({
          ai_output: aiOutput,
          booking_result: bookingResult,
          policy_decision: policyDecision,
          case_context: caseContext,
          booking_context: bookingContext,
        });
        knowledgeResult = await this.retrieveKnowledgeForReply({
          aiOutput,
          clinicId: clinic.id,
          userText: input.text,
          language: responseLanguage,
          conversationMode,
          traceId,
          debug,
        });
        knowledgeReplyText = await this.composeKnowledgeReply({
          knowledgeResult,
          responseLanguage,
          traceId,
          debug,
        });
        const replyDecision = buildRuntimeReplyBehavior({
          conversation_mode: conversationMode,
          booking_result: bookingResult,
          policy_decision: policyDecision,
          case_context: caseContext,
          booking_context: bookingContext,
          clinic,
          ai_output: aiOutput,
          channel: input.channel,
          knowledge_result: knowledgeResult,
          knowledge_reply_text: knowledgeReplyText,
          response_language: responseLanguage,
        });
        replyText = replyDecision.reply_text;
        replySource = replyDecision.reply_source;
        replySideEffects = replyDecision.side_effects;
        debug.conversation_mode = conversationMode;
        debug.reply_source = replySource;
      }
    } catch (error) {
      debug.ai_error = formatRuntimeAIError(error);
      const policyDecision = decideRuntimeAction({
        ai_output: null,
        case_context: caseContext,
        booking_context: bookingContext,
        clinic,
        contact_id: contact.id,
        channel: input.channel,
        meta: input.meta,
        trace_id: traceId,
        current_time_iso: turnStartedAt.toISOString(),
      });
      policyDecisionForReply = policyDecision;
      debug.policy_decision = policyDecision;
      conversationMode = classifyRuntimeConversationMode({
        ai_output: null,
        booking_result: null,
        policy_decision: policyDecision,
        case_context: caseContext,
        booking_context: bookingContext,
      });
      const replyDecision = buildRuntimeReplyBehavior({
        conversation_mode: conversationMode,
        booking_result: null,
        policy_decision: policyDecisionForReply,
        case_context: caseContext,
        booking_context: bookingContext,
        clinic,
        ai_output: null,
        channel: input.channel,
        knowledge_result: knowledgeResult,
        knowledge_reply_text: knowledgeReplyText,
        response_language: responseLanguage,
      });
      replyText = replyDecision.reply_text;
      replySource = replyDecision.reply_source;
      replySideEffects = replyDecision.side_effects;
      debug.conversation_mode = conversationMode;
      debug.reply_source = replySource;
    }

    try {
      const outboundMessage = await this.repository.saveOutboundAssistantMessage({
        clinicId: clinic.id,
        contactId: contact.id,
        caseId: caseContext.current_case_id,
        channel: input.channel,
        text: replyText,
        traceId,
        replyToMessageId: userMessage.id,
        meta: buildOutboundAssistantMessageMeta({
          traceId,
          replySource,
          promptVersion: prompt.prompt_version,
          policyDecision: debug.policy_decision,
          bookingResult,
          conversationMode,
        }),
      });
      debug.outbound_message_id = outboundMessage.id;
    } catch (error) {
      debug.outbound_persistence_error = formatOutboundPersistenceError(error);
    }

    const adminSideEffects = await this.createAdminNotificationSideEffect({
      clinic,
      contact,
      caseId: caseContext.current_case_id,
      input,
      traceId,
      replyText,
      replySource,
      bookingResult,
      aiOutput: aiOutputForNotification,
      conversationMode,
      debug,
    });
    const sideEffects = [...replySideEffects, ...adminSideEffects];

    return {
      trace_id: traceId,
      reply_text: replyText,
      clinic_id: clinic.id,
      contact_id: contact.id,
      case_id: caseContext.current_case_id,
      booking_result: bookingResult as Record<string, unknown> | null,
      side_effects: sideEffects,
      debug,
    };
  }


  private async composeKnowledgeReply(input: {
    knowledgeResult: RuntimeKnowledgeResult | null;
    responseLanguage: ReturnType<typeof resolveRuntimeReplyLanguage>;
    traceId: string;
    debug: Record<string, unknown>;
  }): Promise<string | null> {
    if (input.knowledgeResult?.found !== true) {
      return null;
    }

    try {
      const result = await this.knowledgeReplyComposer.compose({
        knowledge_result: input.knowledgeResult,
        language: input.responseLanguage,
        trace_id: input.traceId,
        debug: input.debug,
      });

      return typeof result.reply_text === 'string' && result.reply_text.trim() !== '' ? result.reply_text.trim() : null;
    } catch (error) {
      input.debug.kb_reply_composer_error = formatRuntimeKnowledgeReplyComposerError(error);
      const fallbackComposer = new DeterministicRuntimeKnowledgeReplyComposer();
      const fallback = await fallbackComposer.compose({
        knowledge_result: input.knowledgeResult,
        language: input.responseLanguage,
        trace_id: input.traceId,
        debug: input.debug,
      });

      return typeof fallback.reply_text === 'string' && fallback.reply_text.trim() !== '' ? fallback.reply_text.trim() : null;
    }
  }

  private async retrieveKnowledgeForReply(input: RetrieveKnowledgeForReplyInput): Promise<RuntimeKnowledgeResult | null> {
    if (this.embeddingClient === undefined || !shouldRetrieveKnowledge(input.conversationMode, input.aiOutput)) {
      return null;
    }

    const queryText = buildRuntimeKnowledgeQueryText({
      faqTopic: input.aiOutput.faq_topic,
      serviceInterest: input.aiOutput.slot_updates.service_interest,
      userText: input.userText,
      language: input.language,
    });

    input.debug.kb_query = {
      enabled: true,
      query_text: queryText,
    };

    try {
      const queryEmbedding = await this.embeddingClient.embedText({
        text: queryText,
        trace_id: input.traceId,
      });
      const knowledgeResult = await this.knowledgeRepository.retrieve({
        clinicId: input.clinicId,
        queryEmbedding,
        trace_id: input.traceId,
      });

      input.debug.kb_result = {
        found: knowledgeResult.found,
        count: knowledgeResult.count,
        top_similarity: knowledgeResult.top_similarity,
        snippets: knowledgeResult.snippets.map((snippet) => ({
          title: snippet.title,
          score: snippet.score,
          source_type: snippet.source_type,
        })),
      };

      return knowledgeResult;
    } catch (error) {
      input.debug.kb_error = formatRuntimeKnowledgeError(error);
      return null;
    }
  }

  private async createAdminNotificationSideEffect(input: CreateAdminNotificationSideEffectInput): Promise<RuntimeSideEffect[]> {
    const trigger = determineAdminNotificationTrigger({
      bookingResult: input.bookingResult,
      aiOutput: input.aiOutput,
      replySource: input.replySource,
      conversationMode: input.conversationMode,
    });

    if (trigger === null) {
      return [];
    }

    const recipient = readAdminNotificationRecipient(input.clinic.settings);

    if (recipient === null) {
      input.debug.admin_notification_skipped = {
        reason: 'admin_recipient_not_configured',
        trigger: trigger.trigger,
      };
      return [];
    }

    const templateKey = 'runtime_admin_attention';
    const dedupeKey = `runtime_admin_notification:${input.traceId}:${trigger.trigger}`;
    const payload = buildAdminNotificationPayload({
      ...input,
      trigger: trigger.trigger,
      reason: trigger.reason,
    });

    try {
      const notification = await this.repository.createAdminNotification({
        clinicId: input.clinic.id,
        contactId: input.contact.id,
        caseId: input.caseId,
        leadId: null,
        channel: 'telegram',
        recipient,
        templateKey,
        dedupeKey,
        payload,
        traceId: input.traceId,
      });

      input.debug.admin_notification = {
        notification_id: notification.notification_id,
        trigger: trigger.trigger,
        dedupe_key: dedupeKey,
      };

      return [{
        type: 'admin_notification',
        channel: 'telegram',
        notification_id: notification.notification_id,
        recipient,
        template_key: templateKey,
        payload,
      }];
    } catch (error) {
      input.debug.admin_notification_error = formatAdminNotificationPersistenceError(error);
      return [];
    }
  }
}

interface RetrieveKnowledgeForReplyInput {
  aiOutput: RuntimeAIOutput;
  clinicId: string;
  userText: string;
  language: string;
  conversationMode: RuntimeConversationMode;
  traceId: string;
  debug: Record<string, unknown>;
}

function shouldRetrieveKnowledge(conversationMode: RuntimeConversationMode, aiOutput: RuntimeAIOutput): boolean {
  return conversationMode === 'faq_price'
    || conversationMode === 'faq_insurance'
    || conversationMode === 'post_booking_question'
    || aiOutput.requested_action === 'answer_faq';
}

function buildRuntimeKnowledgeQueryText(input: {
  faqTopic: RuntimeAIOutput['faq_topic'];
  serviceInterest: string | null;
  userText: string;
  language: string;
}): string {
  return [
    `faq_topic: ${input.faqTopic}`,
    `service_interest: ${input.serviceInterest?.trim() === '' || input.serviceInterest === null ? 'unknown' : input.serviceInterest}`,
    `question: ${input.userText}`,
    `language: ${input.language?.trim() === '' || input.language === null ? 'unknown' : input.language}`,
  ].join('\n');
}

function formatRuntimeKnowledgeError(error: unknown): Record<string, string> {
  return {
    code: readRuntimeKnowledgeErrorCode(error),
    message: 'Runtime KB retrieval failed; replying with safe fallback where grounding is required.',
  };
}

function readRuntimeKnowledgeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  if (error instanceof Error && error.name.trim() !== '') {
    return error.name;
  }

  return 'runtime_kb_retrieval_failed';
}


function formatRuntimeKnowledgeReplyComposerError(error: unknown): Record<string, string> {
  return {
    code: error instanceof Error && error.name.trim() !== '' ? error.name : 'runtime_kb_reply_composer_failed',
    message: 'Runtime KB reply composer failed; using deterministic KB fallback.',
  };
}

interface CreateAdminNotificationSideEffectInput {
  clinic: RuntimeClinicRecord;
  contact: RuntimeContactRecord;
  caseId: string | null;
  input: RuntimeTurnInput;
  traceId: string;
  replyText: string;
  replySource: RuntimeReplySource;
  bookingResult: BookingApplyResponse | null;
  aiOutput: RuntimeAIOutput | null;
  conversationMode: RuntimeConversationMode;
  debug: Record<string, unknown>;
}

interface AdminNotificationTrigger {
  trigger: string;
  reason: string;
}

function determineAdminNotificationTrigger(input: {
  bookingResult: BookingApplyResponse | null;
  aiOutput: RuntimeAIOutput | null;
  replySource: RuntimeReplySource;
  conversationMode: RuntimeConversationMode;
}): AdminNotificationTrigger | null {
  if (input.replySource === 'booking_error') {
    return { trigger: 'booking_error', reason: 'booking_apply_failed' };
  }

  if (input.conversationMode === 'multi_patient_request') {
    return { trigger: 'multi_patient_request', reason: 'multi_patient_requires_admin_coordination' };
  }

  if (input.conversationMode === 'reschedule_request') {
    return { trigger: 'reschedule_request', reason: 'reschedule_requires_admin_coordination' };
  }

  if (input.bookingResult?.should_notify_admin === true) {
    return {
      trigger: `booking_result_${input.bookingResult.booking_status}`,
      reason: input.bookingResult.reason,
    };
  }

  if (input.aiOutput?.handoff_recommended === true) {
    return { trigger: 'ai_handoff_recommended', reason: 'handoff_recommended' };
  }

  if (input.aiOutput?.requested_action === 'handoff') {
    return { trigger: 'ai_requested_handoff', reason: 'requested_action_handoff' };
  }

  if (input.aiOutput?.conversation_intent === 'urgent') {
    return { trigger: 'ai_urgent_intent', reason: 'conversation_intent_urgent' };
  }

  if (input.aiOutput?.conversation_intent === 'follow_up' && hasRequestHumanFlag(input.aiOutput)) {
    return { trigger: 'ai_follow_up_request_human', reason: 'follow_up_request_human' };
  }

  return null;
}

function hasRequestHumanFlag(aiOutput: RuntimeAIOutput): boolean {
  const value = (aiOutput as unknown as Record<string, unknown>).request_human;
  return value === true;
}

function readAdminNotificationRecipient(settings: Record<string, unknown>): string | null {
  const directKeys = ['admin_telegram_chat_id', 'admin_chat_id', 'notification_recipient'];

  for (const key of directKeys) {
    const value = settings[key];

    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  const notifications = settings.notifications;

  if (notifications !== null && typeof notifications === 'object' && !Array.isArray(notifications)) {
    const value = (notifications as Record<string, unknown>).admin_telegram_chat_id;

    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function buildAdminNotificationPayload(input: CreateAdminNotificationSideEffectInput & {
  trigger: string;
  reason: string;
}): Record<string, unknown> {
  return {
    trace_id: input.traceId,
    clinic_id: input.clinic.id,
    contact_id: input.contact.id,
    case_id: input.caseId,
    user_text: input.input.text,
    reply_text: input.replyText,
    reason: input.reason,
    trigger: input.trigger,
    conversation_mode: input.conversationMode,
    booking_result: summarizeBookingResult(input.bookingResult),
    contact: {
      username: input.input.meta?.username ?? null,
      first_name: input.input.meta?.first_name ?? null,
      last_name: input.input.meta?.last_name ?? null,
      chat_id: input.input.chat_id,
      external_user_id: input.input.external_user_id,
      channel: input.input.channel,
    },
  };
}

function summarizeBookingResult(bookingResult: BookingApplyResponse | null): Record<string, unknown> | null {
  if (bookingResult === null) {
    return null;
  }

  return {
    booking_action: bookingResult.booking_action,
    booking_status: bookingResult.booking_status,
    appointment_id: readBookingAppointmentId(bookingResult),
    hold_id: 'hold_id' in bookingResult ? bookingResult.hold_id : null,
    proposed_slot: summarizeProposedSlot(bookingResult),
  };
}

function readBookingAppointmentId(bookingResult: BookingApplyResponse): string | null {
  if ('appointment_id' in bookingResult && typeof bookingResult.appointment_id === 'string') {
    return bookingResult.appointment_id;
  }

  return null;
}

function summarizeProposedSlot(bookingResult: BookingApplyResponse): Record<string, string> | null {
  const proposedSlot = 'proposed_slot' in bookingResult ? bookingResult.proposed_slot : null;

  if (proposedSlot !== null && proposedSlot !== undefined) {
    return {
      label: proposedSlot.label,
      start_at: proposedSlot.start_at,
    };
  }

  if ('appointment' in bookingResult && bookingResult.appointment !== undefined) {
    return {
      label: bookingResult.appointment.label,
      start_at: bookingResult.appointment.start_at,
    };
  }

  return null;
}

function formatAdminNotificationPersistenceError(_error: unknown): Record<string, string> {
  return {
    code: 'admin_notification_persistence_failed',
    message: 'Admin notification persistence failed.',
  };
}

function formatBookingApplyError(_error: unknown): Record<string, string> {
  return {
    code: 'booking_apply_failed',
    message: 'Booking apply failed.',
  };
}

interface BuildOutboundAssistantMessageMetaInput {
  traceId: string;
  replySource: RuntimeReplySource;
  promptVersion: string;
  policyDecision: unknown;
  bookingResult: BookingApplyResponse | null;
  conversationMode: RuntimeConversationMode;
}

function buildOutboundAssistantMessageMeta(input: BuildOutboundAssistantMessageMetaInput): Record<string, unknown> {
  return {
    source: 'runtime_turn',
    trace_id: input.traceId,
    reply_source: input.replySource,
    prompt_version: input.promptVersion,
    policy_decision: {
      reason: readPolicyDecisionReason(input.policyDecision),
    },
    conversation_mode: input.conversationMode,
    booking: input.bookingResult === null ? null : {
      booking_status: input.bookingResult.booking_status,
      booking_action: input.bookingResult.booking_action,
      reason: input.bookingResult.reason,
    },
  };
}

function readPolicyDecisionReason(policyDecision: unknown): string | null {
  if (policyDecision === null || typeof policyDecision !== 'object' || Array.isArray(policyDecision)) {
    return null;
  }

  const reason = (policyDecision as Record<string, unknown>).reason;

  return typeof reason === 'string' ? reason : null;
}

function formatOutboundPersistenceError(_error: unknown): Record<string, string> {
  return {
    code: 'outbound_persistence_failed',
    message: 'Outbound assistant message persistence failed.',
  };
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

  async saveOutboundAssistantMessage(input: SaveOutboundAssistantMessageInput): Promise<RuntimeMessageRecord> {
    const result = await this.db.query<MessageRow>(
      `insert into core.messages (
         clinic_id,
         contact_id,
         lead_id,
         case_id,
         direction,
         role,
         channel,
         text,
         message_type,
         status,
         provider_message_id,
         reply_to_message_id,
         meta
       )
       values ($1, $2, null, $3, 'outbound', 'assistant', $4, $5, 'text', 'created', null, $6::uuid, $7::jsonb)
       returning id`,
      [
        input.clinicId,
        input.contactId,
        input.caseId,
        input.channel,
        input.text,
        input.replyToMessageId ?? null,
        JSON.stringify({
          ...input.meta,
          trace_id: input.traceId,
        }),
      ],
    );

    return mapMessageRow(result.rows[0]);
  }

  async createAdminNotification(input: CreateAdminNotificationInput): Promise<RuntimeAdminNotificationRecord> {
    try {
      const result = await this.db.query<NotificationRow>(
        `insert into core.notifications (
           clinic_id,
           contact_id,
           lead_id,
           case_id,
           channel,
           recipient,
           template_key,
           dedupe_key,
           payload,
           status,
           send_attempts,
           provider_message_id,
           error_text
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'pending', 0, null, null)
         returning id`,
        [
          input.clinicId,
          input.contactId,
          input.leadId,
          input.caseId,
          input.channel,
          input.recipient,
          input.templateKey,
          input.dedupeKey,
          JSON.stringify({
            ...input.payload,
            trace_id: input.traceId,
          }),
        ],
      );

      return mapNotificationRow(result.rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const duplicate = await this.db.query<NotificationRow>(
        `select id
         from core.notifications
         where clinic_id = $1
           and dedupe_key = $2
         limit 1`,
        [input.clinicId, input.dedupeKey],
      );

      const row = duplicate.rows[0];

      if (row === undefined) {
        throw error;
      }

      return mapNotificationRow(row);
    }
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

type NotificationRow = Record<string, unknown> & {
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

function mapNotificationRow(row: NotificationRow | undefined): RuntimeAdminNotificationRecord {
  if (row === undefined) {
    throw new Error('Expected notification row');
  }

  return {
    notification_id: row.id,
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
