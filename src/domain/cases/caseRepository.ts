import { CaseStatus } from './caseStatus.js';

export interface CaseRecord {
  id: string;
  clinicId: string;
  contactId: string;
  leadId?: string | null;
  caseType: string;
  topic?: string | null;
  status: string;
  currentStage?: string | null;
  summary?: string | null;
  collected: Record<string, unknown>;
  sourceChannel?: string | null;
  openedAt: string;
  closedAt?: string | null;
  lastActivityAt: string;
  meta: Record<string, unknown>;
}

export interface CreateCaseInput {
  clinicId: string;
  contactId: string;
  leadId?: string;
  caseType: string;
  topic?: string;
  status?: string;
  currentStage?: string;
  summary?: string;
  collected?: Record<string, unknown>;
  sourceChannel?: string;
  meta?: Record<string, unknown>;
}

export interface UpdateCaseInput {
  caseId: string;
  status?: string;
  currentStage?: string;
  topic?: string;
  summary?: string;
  collected?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface CaseRepository {
  listRecentCases(clinicId: string, contactId: string): Promise<CaseRecord[]>;
  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  updateCase(input: UpdateCaseInput): Promise<CaseRecord>;
}

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class PgCaseRepository implements CaseRepository {
  constructor(private readonly db: Queryable) {}

  async listRecentCases(clinicId: string, contactId: string): Promise<CaseRecord[]> {
    const result = await this.db.query<CaseRow>(
      `select *
       from core.cases
       where clinic_id = $1
         and contact_id = $2
         and status = any($3)
       order by last_activity_at desc, created_at desc
       limit 10`,
      [clinicId, contactId, [CaseStatus.Open, CaseStatus.AppointmentBookedPendingAdminConfirmation, CaseStatus.HandedOff]],
    );

    return result.rows.map(mapCaseRow);
  }

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const result = await this.db.query<CaseRow>(
      `insert into core.cases (
         clinic_id,
         contact_id,
         lead_id,
         case_type,
         topic,
         status,
         current_stage,
         summary,
         collected,
         source_channel,
         meta
       )
       values ($1, $2, $3, $4, $5, coalesce($6, $12), $7, $8, $9::jsonb, $10, $11::jsonb)
       returning *`,
      [
        input.clinicId,
        input.contactId,
        input.leadId ?? null,
        input.caseType,
        input.topic ?? null,
        input.status ?? null,
        input.currentStage ?? null,
        input.summary ?? null,
        JSON.stringify(input.collected ?? {}),
        input.sourceChannel ?? null,
        JSON.stringify(input.meta ?? {}),
        CaseStatus.Open,
      ],
    );

    return mapCaseRow(result.rows[0]);
  }

  async updateCase(input: UpdateCaseInput): Promise<CaseRecord> {
    const result = await this.db.query<CaseRow>(
      `update core.cases
       set status = coalesce($2, status),
           current_stage = coalesce($3, current_stage),
           topic = coalesce($4, topic),
           summary = coalesce($5, summary),
           collected = collected || $6::jsonb,
           meta = meta || $7::jsonb,
           last_activity_at = now(),
           updated_at = now()
       where id = $1
       returning *`,
      [
        input.caseId,
        input.status ?? null,
        input.currentStage ?? null,
        input.topic ?? null,
        input.summary ?? null,
        JSON.stringify(input.collected ?? {}),
        JSON.stringify(input.meta ?? {}),
      ],
    );

    return mapCaseRow(result.rows[0]);
  }
}

type CaseRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  contact_id: string;
  lead_id: string | null;
  case_type: string;
  topic: string | null;
  status: string;
  current_stage: string | null;
  summary: string | null;
  collected: Record<string, unknown> | null;
  source_channel: string | null;
  opened_at: Date | string;
  closed_at: Date | string | null;
  last_activity_at: Date | string;
  meta: Record<string, unknown> | null;
};

function mapCaseRow(row: CaseRow | undefined): CaseRecord {
  if (row === undefined) {
    throw new Error('Expected case row');
  }

  return {
    id: row.id,
    clinicId: row.clinic_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    caseType: row.case_type,
    topic: row.topic,
    status: row.status,
    currentStage: row.current_stage,
    summary: row.summary,
    collected: row.collected ?? {},
    sourceChannel: row.source_channel,
    openedAt: toIso(row.opened_at),
    closedAt: row.closed_at === null ? null : toIso(row.closed_at),
    lastActivityAt: toIso(row.last_activity_at),
    meta: row.meta ?? {},
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
