import { describe, expect, it } from 'vitest';

import type { CaseRecord, CaseRepository, CreateCaseInput, UpdateCaseInput } from './caseRepository.js';
import { resolveCase } from './resolveCase.js';

const clinicId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';

describe('resolveCase', () => {
  it('creates a case for the first booking request', async () => {
    const repository = new InMemoryCaseRepository();

    const result = await resolveCase({
      clinic_id: clinicId,
      contact_id: contactId,
      conversation_intent: 'booking',
      requested_action: 'check_availability',
      slot_updates: { service: 'cleaning' },
    }, repository);

    expect(result).toMatchObject({
      action: 'created_new_case',
      status: 'open',
      case_type: 'appointment_booking',
      topic: 'cleaning',
      reason: 'first_booking_case_created',
    });
    expect(repository.cases).toHaveLength(1);
    expect(repository.cases[0]?.collected).toMatchObject({ service: 'cleaning' });
  });

  it('updates the latest case status when a slot is confirmed', async () => {
    const repository = new InMemoryCaseRepository([
      makeCase({ id: 'case_1', caseType: 'appointment_booking', topic: 'cleaning', status: 'open' }),
    ]);

    const result = await resolveCase({
      clinic_id: clinicId,
      contact_id: contactId,
      conversation_intent: 'booking',
      requested_action: 'confirm_slot',
      booking: { status: 'confirmed', appointment_id: 'external_123' },
    }, repository);

    expect(result).toMatchObject({
      case_id: 'case_1',
      action: 'updated_existing_case',
      status: 'appointment_booked_pending_admin_confirmation',
      reason: 'appointment_booked_pending_admin_confirmation',
    });
    expect(repository.cases[0]).toMatchObject({
      status: 'appointment_booked_pending_admin_confirmation',
      currentStage: 'admin_confirmation_pending',
      collected: {
        booking: { status: 'confirmed', appointment_id: 'external_123' },
      },
    });
  });

  it('creates a new informational case for a braces question after a booked case', async () => {
    const repository = new InMemoryCaseRepository([
      makeCase({
        id: 'case_1',
        caseType: 'appointment_booking',
        topic: 'cleaning',
        status: 'appointment_booked_pending_admin_confirmation',
        currentStage: 'admin_confirmation_pending',
      }),
    ]);

    const result = await resolveCase({
      clinic_id: clinicId,
      contact_id: contactId,
      conversation_intent: 'faq',
      requested_action: 'answer_question',
      slot_updates: { service: 'braces' },
      current_text: 'Do you do braces?',
    }, repository);

    expect(result).toMatchObject({
      action: 'created_new_case',
      status: 'open',
      case_type: 'informational',
      topic: 'braces',
      reason: 'new_topic_after_booked_case_created',
    });
    expect(repository.cases).toHaveLength(2);
  });

  it('attaches a post-handoff thank-you without creating a duplicate case', async () => {
    const repository = new InMemoryCaseRepository([
      makeCase({
        id: 'case_1',
        caseType: 'appointment_booking',
        topic: 'cleaning',
        status: 'appointment_booked_pending_admin_confirmation',
        currentStage: 'admin_confirmation_pending',
      }),
    ]);

    const result = await resolveCase({
      clinic_id: clinicId,
      contact_id: contactId,
      conversation_intent: 'post_handoff_ack',
      requested_action: 'acknowledge_handoff',
      current_text: 'Thank you!',
    }, repository);

    expect(result).toMatchObject({
      case_id: 'case_1',
      action: 'attached_to_existing_case',
      reason: 'post_handoff_follow_up_attached',
    });
    expect(repository.cases).toHaveLength(1);
    expect(repository.cases[0]?.meta).toMatchObject({ last_case_resolution: 'post_handoff_ack' });
  });
});

class InMemoryCaseRepository implements CaseRepository {
  constructor(readonly cases: CaseRecord[] = []) {}

  async listRecentCases(requestClinicId: string, requestContactId: string): Promise<CaseRecord[]> {
    return this.cases
      .filter((caseRecord) => caseRecord.clinicId === requestClinicId && caseRecord.contactId === requestContactId)
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
  }

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const created = makeCase({
      id: `case_${this.cases.length + 1}`,
      clinicId: input.clinicId,
      contactId: input.contactId,
      leadId: input.leadId ?? null,
      caseType: input.caseType,
      topic: input.topic ?? null,
      status: input.status ?? 'open',
      currentStage: input.currentStage ?? null,
      summary: input.summary ?? null,
      collected: input.collected ?? {},
      sourceChannel: input.sourceChannel ?? null,
      meta: input.meta ?? {},
    });

    this.cases.push(created);
    return created;
  }

  async updateCase(input: UpdateCaseInput): Promise<CaseRecord> {
    const caseRecord = this.cases.find((candidate) => candidate.id === input.caseId);

    if (caseRecord === undefined) {
      throw new Error(`Missing case: ${input.caseId}`);
    }

    caseRecord.status = input.status ?? caseRecord.status;
    caseRecord.currentStage = input.currentStage ?? caseRecord.currentStage;
    caseRecord.topic = input.topic ?? caseRecord.topic;
    caseRecord.summary = input.summary ?? caseRecord.summary;
    caseRecord.collected = { ...caseRecord.collected, ...(input.collected ?? {}) };
    caseRecord.meta = { ...caseRecord.meta, ...(input.meta ?? {}) };
    caseRecord.lastActivityAt = new Date().toISOString();

    return caseRecord;
  }
}

function makeCase(overrides: Partial<CaseRecord>): CaseRecord {
  return {
    id: 'case_1',
    clinicId,
    contactId,
    leadId: null,
    caseType: 'appointment_booking',
    topic: null,
    status: 'open',
    currentStage: null,
    summary: null,
    collected: {},
    sourceChannel: null,
    openedAt: '2026-05-10T00:00:00.000Z',
    closedAt: null,
    lastActivityAt: '2026-05-10T00:00:00.000Z',
    meta: {},
    ...overrides,
  };
}
