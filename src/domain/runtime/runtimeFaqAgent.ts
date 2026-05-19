import { runtimeFaqAgentOutputSchema, type RuntimeFaqAgentOutput } from './runtimeFaqAgentSchema.js';
import { buildRuntimeFaqAgentPrompt } from './runtimeFaqAgentPrompt.js';

export interface RuntimeFaqMemory {
  last_faq_topic: string | null;
  last_service_interest: string | null;
  last_user_goal: string | null;
  updated_at: string | null;
}

export interface RuntimeFaqAgentKbChunk {
  chunk_id: string;
  title: string | null;
  content: string;
  score: number | null;
}

export interface RuntimeFaqAgentInput {
  trace_id: string;
  clinic_name: string;
  current_user_message: string;
  recent_history: Array<{ role: 'user' | 'assistant'; text: string }>;
  faq_memory: RuntimeFaqMemory;
  kb_chunks: RuntimeFaqAgentKbChunk[];
}

export interface RuntimeFaqAgentModelClient {
  generateStructuredFaq(input: {
    trace_id: string;
    prompt: string;
    context: Record<string, unknown>;
  }): Promise<unknown>;
}

export class RuntimeFaqAgent {
  constructor(private readonly modelClient: RuntimeFaqAgentModelClient) {}

  async run(input: RuntimeFaqAgentInput): Promise<RuntimeFaqAgentOutput> {
    const prompt = buildRuntimeFaqAgentPrompt({ clinicName: input.clinic_name });
    const raw = await this.modelClient.generateStructuredFaq({
      trace_id: input.trace_id,
      prompt,
      context: {
        current_user_message: input.current_user_message,
        recent_history: input.recent_history.slice(-6),
        faq_memory: input.faq_memory,
        kb_chunks: input.kb_chunks,
      },
    });

    return runtimeFaqAgentOutputSchema.parse(raw);
  }
}
