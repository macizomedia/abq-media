/**
 * @module providers/tts
 * TTS provider abstraction — converts text to audio buffers.
 */

import type { PipelineContext } from '../context.js';
import type { TTSConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface TTSRequest {
  text: string;
  voiceId: string;
  /** Override model for this request. */
  model?: string;
}

export interface TTSResponse {
  /** Raw audio bytes (MP3). */
  audio: Buffer;
  /** Content type (e.g. "audio/mpeg"). */
  contentType: string;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(req: TTSRequest, ctx: PipelineContext): Promise<TTSResponse>;
}

// ---------------------------------------------------------------------------
// ElevenLabs provider
// ---------------------------------------------------------------------------

export class ElevenLabsProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly outputFormat: string;
  private readonly stability: number;
  private readonly similarity: number;

  constructor(config: TTSConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.outputFormat = config.outputFormat;
    this.stability = config.stability;
    this.similarity = config.similarity;
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key is required (config.tts.apiKey)');
    }
  }

  async synthesize(req: TTSRequest, ctx: PipelineContext): Promise<TTSResponse> {
    const baseUrl = 'https://api.elevenlabs.io/v1/text-to-speech';
    const qs = `?output_format=${encodeURIComponent(this.outputFormat)}`;
    const url = `${baseUrl}/${req.voiceId}${qs}`;

    ctx.logger.debug(`TTS request: voice=${req.voiceId}, text=${req.text.slice(0, 60)}…`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: req.text,
        model_id: req.model ?? this.model,
        voice_settings: {
          stability: this.stability,
          similarity_boost: this.similarity,
        },
      }),
      signal: ctx.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      // Surface specific ElevenLabs error codes
      if (res.status === 401 || res.status === 403) {
        throw new Error(`ElevenLabs auth failed (${res.status}): ${errBody}`);
      }
      throw new Error(`ElevenLabs HTTP ${res.status}: ${errBody}`);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTTSProvider(config: TTSConfig): TTSProvider {
  switch (config.provider) {
    case 'elevenlabs':
      return new ElevenLabsProvider(config);
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}
