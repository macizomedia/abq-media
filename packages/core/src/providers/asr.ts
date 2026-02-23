/**
 * @module providers/asr
 * ASR (Automatic Speech Recognition) provider abstraction.
 *
 * Supports automatic chunking of large audio files via ffmpeg's
 * segment muxer. Config-driven thresholds: `chunkThresholdBytes`
 * (default 20 MB) and `chunkSizeSec` (default 600 s / 10 min).
 */

import type { PipelineContext } from '../context.js';
import type { ASRConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ASRRequest {
  /** Absolute path to audio file (WAV, MP3, etc.). */
  audioPath: string;
  /** BCP-47 language code. */
  lang: string;
}

export interface ASRResponse {
  text: string;
  /** Duration of audio in seconds (if available). */
  durationSec?: number;
}

export interface ASRProvider {
  readonly name: string;
  transcribe(req: ASRRequest, ctx: PipelineContext): Promise<ASRResponse>;
}

// ---------------------------------------------------------------------------
// Helpers: audio chunking via ffmpeg
// ---------------------------------------------------------------------------

/**
 * Split an audio file into fixed-duration segments using ffmpeg.
 * Returns sorted list of absolute paths to chunk files.
 */
async function splitAudioIntoChunks(
  audioPath: string,
  chunkDir: string,
  segmentSeconds: number,
): Promise<string[]> {
  const { execSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  const pattern = join(chunkDir, 'chunk-%03d.mp3');
  execSync(
    `ffmpeg -y -i "${audioPath}" -f segment -segment_time ${segmentSeconds} -c copy -reset_timestamps 1 "${pattern}"`,
    { stdio: 'pipe', timeout: 300_000 },
  );

  return readdirSync(chunkDir)
    .filter((f) => f.startsWith('chunk-') && f.endsWith('.mp3'))
    .sort()
    .map((f) => join(chunkDir, f));
}

/**
 * Check if ffmpeg is available on the system.
 */
async function hasFFmpeg(): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process');
    execSync('ffmpeg -version', { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// OpenAI Whisper API provider
// ---------------------------------------------------------------------------

export class OpenAIWhisperProvider implements ASRProvider {
  readonly name = 'openai-whisper';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly chunkThresholdBytes: number;
  private readonly chunkSizeSec: number;

  constructor(config: ASRConfig, opts?: { baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (opts?.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.chunkThresholdBytes = config.chunkThresholdBytes;
    this.chunkSizeSec = config.chunkSizeSec;
    if (!this.apiKey) {
      throw new Error('ASR API key is required (config.asr.apiKey)');
    }
  }

  async transcribe(req: ASRRequest, ctx: PipelineContext): Promise<ASRResponse> {
    const { statSync, mkdtempSync, rmSync } = await import('node:fs');
    const { basename, join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const stat = statSync(req.audioPath);
    ctx.logger.debug(
      `ASR request: ${basename(req.audioPath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB), lang=${req.lang}`,
    );

    // ── Proactive chunking for files above threshold ──────────────────
    if (stat.size >= this.chunkThresholdBytes && (await hasFFmpeg())) {
      ctx.logger.info(
        `Audio file ${(stat.size / 1024 / 1024).toFixed(1)} MB ≥ ${(this.chunkThresholdBytes / 1024 / 1024).toFixed(0)} MB threshold — splitting into ${this.chunkSizeSec}s chunks`,
      );
      return this.transcribeInChunks(req, ctx);
    }

    // ── Single-file upload attempt ─────────────────────────────────────
    try {
      return await this.transcribeSingle(req, ctx);
    } catch (err) {
      // Reactive fallback: if the API returns 413 / inputTooLarge, retry with chunks
      const msg = err instanceof Error ? err.message : String(err);
      const isTooLarge = /413|too.?large|payload|input_too_large/i.test(msg);
      if (isTooLarge && (await hasFFmpeg())) {
        ctx.logger.warn(
          `ASR returned payload-too-large — retrying with ${this.chunkSizeSec}s chunks`,
        );
        return this.transcribeInChunks(req, ctx);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: single-file upload
  // ---------------------------------------------------------------------------

  private async transcribeSingle(req: ASRRequest, ctx: PipelineContext): Promise<ASRResponse> {
    const { basename } = await import('node:path');

    const url = `${this.baseUrl}/audio/transcriptions`;
    const fileBuffer = await readFileAsBuffer(req.audioPath);
    const blob = new Blob([fileBuffer as unknown as BlobPart], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('file', blob, basename(req.audioPath));
    form.append('model', this.model);
    form.append('language', req.lang);
    form.append('response_format', 'text');

    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: ctx.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`ASR ${this.name} HTTP ${res.status}: ${errBody}`);
    }

    const text = await res.text();
    return { text: text.trim() };
  }

  // ---------------------------------------------------------------------------
  // Internal: chunked transcription
  // ---------------------------------------------------------------------------

  private async transcribeInChunks(req: ASRRequest, ctx: PipelineContext): Promise<ASRResponse> {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const chunkDir = mkdtempSync(join(tmpdir(), 'abq-asr-chunks-'));
    try {
      const chunks = await splitAudioIntoChunks(req.audioPath, chunkDir, this.chunkSizeSec);
      if (!chunks.length) {
        throw new Error('ffmpeg produced no audio chunks');
      }

      ctx.logger.info(`Split audio into ${chunks.length} chunk(s)`);
      const parts: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        ctx.logger.debug(`Transcribing chunk ${i + 1}/${chunks.length}`);
        const result = await this.transcribeSingle(
          { audioPath: chunks[i], lang: req.lang },
          ctx,
        );
        parts.push(result.text);
      }

      return { text: parts.join('\n\n') };
    } finally {
      try { rmSync(chunkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

async function readFileAsBuffer(filepath: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(filepath);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createASRProvider(config: ASRConfig): ASRProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIWhisperProvider(config);
    case 'openrouter':
      return new OpenAIWhisperProvider(config, {
        baseUrl: 'https://openrouter.ai/api/v1',
      });
    case 'whisper-local':
      // Local whisper uses shell exec — handled in the transcribe stage directly
      throw new Error('whisper-local provider is handled at the stage level, not via ASRProvider');
    default:
      throw new Error(`Unknown ASR provider: ${config.provider}`);
  }
}
