import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type { CaseRecord, CaseRepository, CreateCaseInput, UpdateCaseInput } from '../../domain/cases/caseRepository.js';
import { registerCaseRoutes } from './cases.routes.js';

const clinicId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';

describe('case routes', () => {
  it('returns a structured validation error for invalid resolve payloads', async () => {
    const app = Fastify();
    await app.register(registerCaseRoutes, { caseRepository: new InMemoryCaseRepository() });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/cases/resolve',
        payload: { clinic_id: 'bad', contact_id: contactId, conversation_intent: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
    } finally {
      await app.close();
    }
  });

  it('resolves a first booking request through the injected repository', async () => {
    const repository = new InMemoryCaseRepository();
    const app = Fastify();
    await app.register(registerCaseRoutes, { caseRepository: repository });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/cases/resolve',
        payload: {
          clinic_id: clinicId,
          contact_id: contactId,
          conversation_intent: 'booking',
          requested_action: 'check_availability',
          slot_updates: { service: 'cleaning' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        action: 'created_new_case',
        status: 'open',
        case_type: 'appointment_booking',
        topic: 'cleaning',
      });
      expect(repository.cases).toHaveLength(1);
    } finally {
      await app.close();
    }
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
