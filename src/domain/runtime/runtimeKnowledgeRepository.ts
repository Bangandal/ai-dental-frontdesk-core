import type { RuntimeAIOutput, RuntimeTurnInput } from './runtimeContracts.js';

export interface RuntimeKnowledgeSearchInput {
  clinic_id: string;
  faq_topic: RuntimeAIOutput['faq_topic'];
  service_interest: string | null;
  user_text: string;
  language: string | null;
  channel: RuntimeTurnInput['channel'];
  trace_id: string;
  limit: number;
}

export interface RuntimeKnowledgeSnippet {
  title?: string;
  content: string;
  source_type?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeKnowledgeResult {
  found: boolean;
  snippets: RuntimeKnowledgeSnippet[];
  debug?: Record<string, unknown>;
}

export interface RuntimeKnowledgeRepository {
  searchClinicKnowledge(input: RuntimeKnowledgeSearchInput): Promise<RuntimeKnowledgeResult>;
}

export class NoopRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  async searchClinicKnowledge(): Promise<RuntimeKnowledgeResult> {
    return {
      found: false,
      snippets: [],
      debug: { provider: 'noop', reason: 'kb_repository_not_configured' },
    };
  }
}
