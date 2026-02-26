/**
 * @module providers/llm
 * LLM provider abstraction — unified interface for text generation.
 */

import type { PipelineContext } from '../context.js';
import type { LLMConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface LLMProvider {
  readonly name: string;
  generate(req: LLMRequest, ctx: PipelineContext): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (works for OpenAI & OpenRouter)
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    extraHeaders?: Record<string, string>;
  }) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  async generate(req: LLMRequest, ctx: PipelineContext): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const messages: Array<{ role: string; content: string }> = [];

    if (req.systemPrompt) {
      messages.push({ role: 'system', content: req.systemPrompt });
    }
    messages.push({ role: 'user', content: req.prompt });

    const body = {
      model: this.model,
      messages,
      temperature: req.temperature ?? ctx.config.llm.temperature,
      max_tokens: req.maxTokens ?? ctx.config.llm.maxTokens,
    };

    ctx.logger.debug(`LLM request to ${this.name} (${this.model})`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LLM ${this.name} HTTP ${res.status}: ${errBody}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new Error(`LLM ${this.name} returned empty response`);
    }

    return {
      text,
      model: json.model ?? this.model,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create an LLM provider from PipelineConfig.llm */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAICompatibleProvider({
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: config.apiKey,
        model: config.model,
      });
    case 'openrouter':
    case 'openrouter-agent':
      return new OpenAICompatibleProvider({
        name: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: config.apiKey,
        model: config.model,
        extraHeaders: {
          'HTTP-Referer': 'https://github.com/abquanta/abq-media-workspace',
          'X-Title': 'abq-media',
        },
      });
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
