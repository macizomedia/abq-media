/**
 * @module config
 * Pipeline configuration schema powered by Zod.
 *
 * Replaces the duplicated `readLocalConfig()` + `.env` + `.abq-module.json`
 * pattern across CLI, pipeline, and TTS adapter with a single validated schema.
 *
 * Load order (later wins):
 *   defaults → .abq-module.json → ~/.abq-media/credentials.json → env vars → explicit overrides
 */

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'openrouter', 'openrouter-agent']).default('openrouter'),
  model: z.string().default('openrouter/auto'),
  apiKey: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.2),
  /** Max input chars sent to LLM for digest. */
  digestTruncation: z.number().int().positive().default(14_000),
  /** Max tokens for LLM response. */
  maxTokens: z.number().int().positive().default(4096),
});

export const ASRConfigSchema = z.object({
  provider: z.enum(['whisper-local', 'openai', 'openrouter']).default('openai'),
  model: z.string().default('whisper-1'),
  apiKey: z.string().default(''),
  /** Max seconds per audio chunk for ASR. */
  chunkSizeSec: z.number().int().positive().default(600),
  /** Audio files above this byte size will be chunked. */
  chunkThresholdBytes: z.number().int().positive().default(20 * 1024 * 1024),
});

export const TTSConfigSchema = z.object({
  provider: z.enum(['elevenlabs']).default('elevenlabs'),
  apiKey: z.string().default(''),
  voiceIdA: z.string().default('pNInz6obpgDQGcFmaJgB'),
  voiceIdB: z.string().default('EXAVITQu4vr4xnSDxMaL'),
  model: z.string().default('eleven_multilingual_v2'),
  outputFormat: z.string().default('mp3_44100_128'),
  stability: z.number().min(0).max(1).default(0.5),
  similarity: z.number().min(0).max(1).default(0.75),
});

export const TranscriptConfigSchema = z.object({
  /** Minimum character length to consider a transcript valid. */
  minLengthChars: z.number().int().positive().default(40),
  /** Characters of transcript used in the research-prompt excerpt. */
  excerptLength: z.number().int().positive().default(2200),
  /** Max talking points extracted from heuristic. */
  maxTalkingPoints: z.number().int().positive().default(7),
});

export const OutputConfigSchema = z.object({
  /** Base directory for output artifacts. */
  baseDir: z.string().default('output'),
  /** Which content formats to generate. */
  formats: z
    .array(z.enum(['article', 'podcast_script', 'reel_script', 'social_posts']))
    .default(['article', 'podcast_script', 'reel_script', 'social_posts']),
});

export const YtdlpWorkaroundsSchema = z.object({
  /** Force connections through IPv4. Maps to --force-ipv4. */
  forceIpv4: z.boolean().default(false),
  /** Bypass geographic restriction via faking X-Forwarded-For. Maps to --geo-bypass. */
  geoBypass: z.boolean().default(false),
  /** Seconds to sleep between requests. Maps to --sleep-interval. */
  sleepInterval: z.number().int().min(0).default(0),
  /** Seconds to sleep between subtitle requests. Maps to --sleep-subtitles. */
  sleepSubtitles: z.number().int().min(0).default(0),
  /** Number of retries for a download. Maps to --retries. */
  retries: z.number().int().min(0).default(10),
  /** Number of retries for a fragment. Maps to --fragment-retries. */
  fragmentRetries: z.number().int().min(0).default(10),
}).default({
  forceIpv4: false,
  geoBypass: false,
  sleepInterval: 0,
  sleepSubtitles: 0,
  retries: 10,
  fragmentRetries: 10,
});

export const YtdlpConfigSchema = z.object({
  /** Verbosity level for yt-dlp output.
   *  - quiet:   --quiet (suppress most output)
   *  - normal:  no flag (default yt-dlp behaviour)
   *  - verbose: --verbose (print various debugging info)
   *  - debug:   --verbose --print-traffic (full protocol dump)
   */
  verbosity: z.enum(['quiet', 'normal', 'verbose', 'debug']).default('normal'),
  /** When true, run yt-dlp with --simulate --dump-json — no downloads, returns metadata only. */
  simulate: z.boolean().default(false),
  /** Workaround flags for network and geo issues. */
  workarounds: YtdlpWorkaroundsSchema,
  /** Format selector string. Maps to --format / -f. Default varies by purpose. */
  format: z.string().optional(),
  /** Target audio format for post-processing. Maps to --audio-format. */
  audioFormat: z.enum(['mp3', 'wav', 'opus', 'aac', 'flac', 'best']).default('mp3'),
  /** Audio quality for post-processing. Maps to --audio-quality (0=best, 10=worst). */
  audioQuality: z.number().int().min(0).max(10).default(5),
  /** Raw --postprocessor-args strings, e.g. ["FFmpeg:-ac 1 -ar 16000"]. */
  postProcessorArgs: z.array(z.string()).default([]),
  /** Path to a Netscape-format cookies file. Maps to --cookies. */
  cookies: z.string().optional(),
  /** Browser to extract cookies from. Maps to --cookies-from-browser.
   *  Values: 'chrome', 'firefox', 'safari', 'edge', 'opera', 'brave', 'chromium', 'vivaldi'
   *  Can include profile: 'chrome:Profile 1' */
  cookiesFromBrowser: z.string().optional(),
  /** JS runtime spec for yt-dlp challenges. Maps to --js-runtimes. */
  jsRuntimes: z.string().optional(),
  /** HTTP/SOCKS proxy URL. Maps to --proxy. */
  proxy: z.string().optional(),
  /** Download rate limit, e.g. "50K" or "4.2M". Maps to --limit-rate. */
  rateLimit: z.string().optional(),
  /** Preferred subtitle format. Maps to --sub-format. */
  subtitleFormat: z.enum(['vtt', 'srt', 'ass', 'best']).default('vtt'),
  /** Override subtitle language list (BCP-47 codes). Merged with config.lang at runtime. */
  subtitleLangs: z.array(z.string()).default([]),
  /** Timeout in ms for subtitle-download commands. */
  subtitleTimeoutMs: z.number().int().positive().default(60_000),
  /** Timeout in ms for audio-download commands. */
  audioTimeoutMs: z.number().int().positive().default(300_000),
});

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

export const PipelineConfigSchema = z.object({
  /** Default language (BCP-47 or short code). */
  lang: z.string().default('es'),
  /** Enable verbose debug logging. */
  debug: z.boolean().default(false),
  llm: LLMConfigSchema.default(() => LLMConfigSchema.parse({})),
  asr: ASRConfigSchema.default(() => ASRConfigSchema.parse({})),
  tts: TTSConfigSchema.default(() => TTSConfigSchema.parse({})),
  transcript: TranscriptConfigSchema.default(() => TranscriptConfigSchema.parse({})),
  output: OutputConfigSchema.default(() => OutputConfigSchema.parse({})),
  ytdlp: YtdlpConfigSchema.default(() => YtdlpConfigSchema.parse({})),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type ASRConfig = z.infer<typeof ASRConfigSchema>;
export type TTSConfig = z.infer<typeof TTSConfigSchema>;
export type TranscriptConfig = z.infer<typeof TranscriptConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type YtdlpConfig = z.infer<typeof YtdlpConfigSchema>;
export type YtdlpWorkarounds = z.infer<typeof YtdlpWorkaroundsSchema>;

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

/**
 * Load and validate configuration by merging layers:
 *   defaults → .abq-module.json → ~/.abq-media/credentials.json → env → overrides
 *
 * Throws a ZodError with detailed messages if the merged config is invalid
 * (fail loudly, not silently).
 */
export function loadConfig(overrides: Record<string, unknown> = {}): PipelineConfig {
  const layers: Record<string, unknown>[] = [];

  // Layer 1: .abq-module.json in CWD
  const localPath = path.resolve(process.cwd(), '.abq-module.json');
  const localJson = readJsonSafe(localPath);
  if (localJson) layers.push(normalizeModuleJson(localJson));

  // Layer 2: ~/.abq-media/credentials.json
  const credPath = path.join(os.homedir(), '.abq-media', 'credentials.json');
  const credJson = readJsonSafe(credPath);
  if (credJson) layers.push(normalizeCredentials(credJson));

  // Layer 3: environment variables
  layers.push(envLayer());

  // Layer 4: explicit overrides
  if (Object.keys(overrides).length > 0) layers.push(overrides);

  // Merge: shallow spread per sub-object
  const merged = deepMerge({}, ...layers);

  return PipelineConfigSchema.parse(merged);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonSafe(filepath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

/** Map .abq-module.json fields to our schema shape. */
function normalizeModuleJson(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (raw.lang) out.lang = raw.lang;
  if (raw.debug !== undefined) out.debug = raw.debug;

  // LLM
  const llm: Record<string, unknown> = {};
  if (raw.llmProvider) llm.provider = raw.llmProvider;
  if (raw.llmModel) llm.model = raw.llmModel;
  if (raw.openrouterApiKey) llm.apiKey = raw.openrouterApiKey;
  if (raw.openaiApiKey) llm.apiKey = raw.openaiApiKey;
  if (raw.llmTemperature) llm.temperature = raw.llmTemperature;
  if (Object.keys(llm).length) out.llm = llm;

  // ASR
  const asr: Record<string, unknown> = {};
  if (raw.asrProvider) asr.provider = raw.asrProvider;
  if (raw.asrModel) asr.model = raw.asrModel;
  if (raw.asrApiKey) asr.apiKey = raw.asrApiKey;
  if (Object.keys(asr).length) out.asr = asr;

  // TTS
  const tts: Record<string, unknown> = {};
  if (raw.elevenLabsApiKey) tts.apiKey = raw.elevenLabsApiKey;
  if (raw.voiceIdA) tts.voiceIdA = raw.voiceIdA;
  if (raw.voiceIdB) tts.voiceIdB = raw.voiceIdB;
  if (raw.elevenLabsModel) tts.model = raw.elevenLabsModel;
  if (raw.outputFormat) tts.outputFormat = raw.outputFormat;
  if (Object.keys(tts).length) out.tts = tts;

  return out;
}

/** Map ~/.abq-media/credentials.json to our schema shape. */
function normalizeCredentials(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const llm: Record<string, unknown> = {};

  if (raw.openrouterApiKey) llm.apiKey = raw.openrouterApiKey;
  if (raw.openaiApiKey) llm.apiKey = raw.openaiApiKey;
  if (raw.llmApiKey) llm.apiKey = raw.llmApiKey;
  if (raw.llmProvider) llm.provider = raw.llmProvider;
  if (raw.llmModel) llm.model = raw.llmModel;
  if (Object.keys(llm).length) out.llm = llm;

  const asr: Record<string, unknown> = {};
  if (raw.asrProvider) asr.provider = raw.asrProvider;
  if (raw.asrModel) asr.model = raw.asrModel;
  if (raw.asrApiKey) asr.apiKey = raw.asrApiKey;
  if (Object.keys(asr).length) out.asr = asr;

  const tts: Record<string, unknown> = {};
  if (raw.elevenLabsApiKey) tts.apiKey = raw.elevenLabsApiKey;
  if (Object.keys(tts).length) out.tts = tts;

  const ytdlp: Record<string, unknown> = {};
  if (raw.ytdlpCookies) ytdlp.cookies = raw.ytdlpCookies;
  if (raw.ytdlpCookiesFromBrowser) ytdlp.cookiesFromBrowser = raw.ytdlpCookiesFromBrowser;
  if (raw.ytdlpJsRuntimes) ytdlp.jsRuntimes = raw.ytdlpJsRuntimes;
  if (Object.keys(ytdlp).length) out.ytdlp = ytdlp;

  return out;
}

/** Map recognized env vars to our schema. */
function envLayer(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const llm: Record<string, unknown> = {};
  const asr: Record<string, unknown> = {};
  const tts: Record<string, unknown> = {};

  if (process.env.OPENROUTER_API_KEY) llm.apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.OPENAI_API_KEY) {
    llm.apiKey ??= process.env.OPENAI_API_KEY;
    asr.apiKey = process.env.OPENAI_API_KEY;
    if (!process.env.OPENROUTER_API_KEY) {
      llm.provider = 'openai';
    }
  }
  if (process.env.ELEVENLABS_API_KEY) tts.apiKey = process.env.ELEVENLABS_API_KEY;
  if (process.env.ABQ_DEBUG === '1') out.debug = true;
  if (process.env.ABQ_LANG) out.lang = process.env.ABQ_LANG;

  // yt-dlp
  const ytdlp: Record<string, unknown> = {};
  if (process.env.YTDLP_VERBOSITY) ytdlp.verbosity = process.env.YTDLP_VERBOSITY;
  if (process.env.YTDLP_SIMULATE === '1') ytdlp.simulate = true;
  if (process.env.YTDLP_COOKIES) ytdlp.cookies = process.env.YTDLP_COOKIES;
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) ytdlp.cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER;
  if (process.env.YTDLP_JS_RUNTIMES) ytdlp.jsRuntimes = process.env.YTDLP_JS_RUNTIMES;
  if (process.env.YTDLP_PROXY) ytdlp.proxy = process.env.YTDLP_PROXY;
  if (process.env.YTDLP_RATE_LIMIT) ytdlp.rateLimit = process.env.YTDLP_RATE_LIMIT;
  if (process.env.YTDLP_AUDIO_FORMAT) ytdlp.audioFormat = process.env.YTDLP_AUDIO_FORMAT;
  if (process.env.YTDLP_SUBTITLE_FORMAT) ytdlp.subtitleFormat = process.env.YTDLP_SUBTITLE_FORMAT;

  if (Object.keys(llm).length) out.llm = llm;
  if (Object.keys(asr).length) out.asr = asr;
  if (Object.keys(tts).length) out.tts = tts;
  if (Object.keys(ytdlp).length) out.ytdlp = ytdlp;

  return out;
}

/** Simple recursive merge for plain objects (arrays are replaced, not merged). */
function deepMerge(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      const sv = source[key];
      const tv = target[key];
      if (isPlainObject(sv) && isPlainObject(tv)) {
        target[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
      } else if (sv !== undefined) {
        target[key] = sv;
      }
    }
  }
  return target;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
