/**
 * @module stages/ingest/youtube
 * Ingest stage: fetch transcript from a YouTube video.
 *
 * Implements the transcript fallback chain:
 *   1. YouTube timedtext captions API
 *   2. yt-dlp subtitle download
 *   3. API ASR (download audio → transcribe)
 *
 * Modeled as a FallbackStage so each attempt emits events.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import { FallbackStage } from '../../stage.js';
import { shell, hasCommand, makeTempDir, rmSafe } from '../../utils/index.js';
import { createASRProvider } from '../../providers/asr.js';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface IngestInput {
  /** YouTube URL. */
  url?: string;
  /** Pre-computed video ID. */
  videoId?: string;
  /** Language code (BCP-47). */
  lang?: string;
  /** Direct text input ("inline text" or path to text file). */
  text?: string;
  /** Path to a .txt transcript file. */
  transcriptFile?: string;
  /** Path to an audio file for ASR. */
  audioFile?: string;
}

export interface IngestOutput {
  transcript: string;
  source: string;
  transcriptMode: string;
  sourceType: string;
  trace: Array<{ step: string; status: string; reason?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers (extracted from pipeline/cli.js)
// ---------------------------------------------------------------------------

export function extractVideoId(input: string): string {
  try {
    const u = new URL(
      String(input || '')
        .replace(/\\\?/g, '?')
        .replace(/\\&/g, '&')
        .replace(/\\=/g, '=')
        .trim(),
    );
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '').trim();
    }
    if (u.searchParams.get('v')) return u.searchParams.get('v')!;
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('shorts');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  } catch {
    // ignore
  }
  return '';
}

function stripXml(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVtt(raw: string): string {
  return raw
    .replace(/WEBVTT[\s\S]*?\n\n/, '')
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}.*/g, ' ')
    .replace(/\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}.*/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Sub-stage: YouTube captions API
// ---------------------------------------------------------------------------

export const captionsStage: Stage<IngestInput, IngestOutput> = {
  name: 'transcribe:captions',
  description: 'Fetch captions from YouTube timedtext API',

  canRun(input) {
    return !!(input.url || input.videoId);
  },

  async run(input, ctx) {
    const videoId = input.videoId || extractVideoId(input.url!);
    const lang = input.lang ?? ctx.config.lang;
    const minLen = ctx.config.transcript.minLengthChars;

    if (!videoId) throw new Error('Cannot extract video ID from URL');

    const langCandidates = [lang, 'es', 'en', 'en-US'];
    const endpoints: string[] = [];
    for (const l of langCandidates) {
      // Manual captions
      endpoints.push(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(l)}&fmt=srv3`);
      endpoints.push(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(l)}`);
      // Auto-generated captions (kind=asr)
      endpoints.push(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(l)}&kind=asr&fmt=srv3`);
      endpoints.push(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(l)}&kind=asr`);
    }

    for (const endpoint of endpoints) {
      ctx.emitter.emit('stage:progress', {
        stageName: 'transcribe:captions',
        message: `Trying endpoint: lang=${endpoint.match(/lang=([^&]+)/)?.[1]}`,
      });

      const res = await fetch(endpoint, { signal: ctx.signal });
      if (!res.ok) continue;

      const xml = await res.text();
      if (!xml || !xml.includes('<text')) continue;

      const text = stripXml(xml);
      if (text.length > minLen) {
        return {
          transcript: text,
          source: endpoint,
          transcriptMode: 'youtube-captions',
          sourceType: 'YouTube video',
          trace: [{ step: 'youtube-captions', status: 'ok' }],
        };
      }
    }

    throw new Error('No captions found for any language candidate');
  },
};

// ---------------------------------------------------------------------------
// Sub-stage: yt-dlp subtitles
// ---------------------------------------------------------------------------

export const ytdlpSubsStage: Stage<IngestInput, IngestOutput> = {
  name: 'transcribe:ytdlp',
  description: 'Download subtitles via yt-dlp',

  async canRun(input) {
    return !!(input.url) && (await hasCommand('yt-dlp'));
  },

  async run(input, ctx) {
    const url = input.url!;
    const lang = input.lang ?? ctx.config.lang;
    const minLen = ctx.config.transcript.minLengthChars;
    const tmp = makeTempDir('abq-ytdlp-');

    try {
      const cmd = [
        'yt-dlp',
        '--skip-download',
        '--write-auto-sub',
        '--write-sub',
        '--sub-format', 'vtt',
        '--sub-langs', `${lang},es,en,en-US`,
        '-o', '"video.%(ext)s"',
        `"${url}"`,
      ].join(' ');

      ctx.emitter.emit('stage:progress', {
        stageName: 'transcribe:ytdlp',
        message: 'Downloading subtitles with yt-dlp…',
      });

      await shell(cmd, { cwd: tmp, timeoutMs: 60_000, signal: ctx.signal });

      const files = fs.readdirSync(tmp).filter((f) => f.endsWith('.vtt'));
      if (!files.length) throw new Error('yt-dlp produced no subtitle files');

      const best = files.sort((a, b) => a.length - b.length)[0];
      const raw = fs.readFileSync(path.join(tmp, best), 'utf8');
      const transcript = cleanVtt(raw);

      if (transcript.length < minLen) throw new Error('yt-dlp subtitle too short');

      return {
        transcript,
        source: `yt-dlp:${best}`,
        transcriptMode: 'yt-dlp-subs',
        sourceType: 'YouTube video',
        trace: [{ step: 'yt-dlp', status: 'ok' }],
      };
    } finally {
      rmSafe(tmp);
    }
  },
};

// ---------------------------------------------------------------------------
// Sub-stage: API ASR (download audio then transcribe)
// ---------------------------------------------------------------------------

export const ytAsrStage: Stage<IngestInput, IngestOutput> = {
  name: 'transcribe:yt-asr',
  description: 'Download audio via yt-dlp, then transcribe with ASR API',

  async canRun(input, ctx) {
    if (!input.url) return false;
    if (!(await hasCommand('yt-dlp'))) return false;
    return !!(ctx.config.asr.apiKey);
  },

  async run(input, ctx) {
    const url = input.url!;
    const lang = input.lang ?? ctx.config.lang;
    const hasFFmpeg = await hasCommand('ffmpeg');
    const tmp = makeTempDir('abq-yt-asr-');

    try {
      // Download audio
      ctx.emitter.emit('stage:progress', {
        stageName: 'transcribe:yt-asr',
        message: 'Downloading audio with yt-dlp…',
      });

      await shell(
        `yt-dlp -f bestaudio -o "audio.%(ext)s" "${url}"`,
        { cwd: tmp, timeoutMs: 120_000, signal: ctx.signal },
      );

      const audioFile = fs.readdirSync(tmp).find((f) => /^audio\./.test(f));
      if (!audioFile) throw new Error('yt-dlp produced no audio file');

      let audioPath = path.join(tmp, audioFile);

      // Convert to mp3 if ffmpeg available
      if (hasFFmpeg) {
        const mp3Path = path.join(tmp, 'audio.mp3');
        ctx.emitter.emit('stage:progress', {
          stageName: 'transcribe:yt-asr',
          message: 'Converting to MP3…',
        });
        try {
          await shell(
            `ffmpeg -y -i "${audioPath}" -vn -ac 1 -ar 16000 -b:a 64k "${mp3Path}"`,
            { cwd: tmp, timeoutMs: 120_000, signal: ctx.signal },
          );
          if (fs.existsSync(mp3Path)) audioPath = mp3Path;
        } catch {
          // keep original
        }
      }

      // Transcribe
      ctx.emitter.emit('stage:progress', {
        stageName: 'transcribe:yt-asr',
        message: 'Transcribing audio via ASR API…',
      });

      const provider = createASRProvider(ctx.config.asr);
      const result = await provider.transcribe({ audioPath, lang }, ctx);

      if (result.text.length < ctx.config.transcript.minLengthChars) {
        throw new Error('ASR transcript too short');
      }

      return {
        transcript: result.text,
        source: `${provider.name}:${ctx.config.asr.model}`,
        transcriptMode: `asr-${ctx.config.asr.provider}`,
        sourceType: 'YouTube video (ASR)',
        trace: [{ step: 'asr-api', status: 'ok' }],
      };
    } finally {
      rmSafe(tmp);
    }
  },
};

// ---------------------------------------------------------------------------
// Composed: YouTube transcript fallback
// ---------------------------------------------------------------------------

export const youtubeIngestStage = new FallbackStage<IngestInput, IngestOutput>({
  name: 'ingest:youtube',
  description: 'Fetch transcript from YouTube via captions → yt-dlp → ASR fallback',
  alternatives: [captionsStage, ytdlpSubsStage, ytAsrStage],
});
