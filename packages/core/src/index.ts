/**
 * @abquanta/abq-media-core
 *
 * Core contracts, pipeline runner, typed stages, and provider abstractions
 * for the Abquanta media content pipeline.
 *
 * Usage:
 *   import { youtubeToFullSuite, loadConfig } from '@abquanta/abq-media-core';
 *   const pipeline = youtubeToFullSuite({ config: loadConfig() });
 *   pipeline.on('stage:progress', (e) => console.log(e.message));
 *   const result = await pipeline.run({ url: 'https://youtube.com/watch?v=...' });
 */

// --- Stage contracts ---
export {
  type Stage,
  type RetryPolicy,
  FallbackStage,
  type FallbackStageOptions,
  ParallelStage,
  type ParallelStageOptions,
  type ParallelResult,
} from './stage.js';

// --- Events ---
export {
  PipelineEmitter,
  type PipelineEventMap,
  type StageStartEvent,
  type StageProgressEvent,
  type StageCompleteEvent,
  type StageErrorEvent,
  type StageSkipEvent,
  type PipelineStartEvent,
  type PipelineCompleteEvent,
  type PipelineErrorEvent,
} from './events.js';

// --- Context ---
export {
  type PipelineContext,
  type Logger,
  ConsoleLogger,
} from './context.js';

// --- Config ---
export {
  PipelineConfigSchema,
  LLMConfigSchema,
  ASRConfigSchema,
  TTSConfigSchema,
  TranscriptConfigSchema,
  OutputConfigSchema,
  YtdlpConfigSchema,
  YtdlpWorkaroundsSchema,
  loadConfig,
  type PipelineConfig,
  type LLMConfig,
  type ASRConfig,
  type TTSConfig,
  type TranscriptConfig,
  type OutputConfig,
  type YtdlpConfig,
  type YtdlpWorkarounds,
} from './config.js';

// --- Pipeline runner ---
export {
  Pipeline,
  definePipeline,
  type PipelineOptions,
  type PipelineResult,
} from './pipeline.js';

// --- Registry ---
export {
  StageRegistry,
  type StageMiddleware,
  withLogging,
} from './registry.js';

// --- Providers ---
export {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  OpenAICompatibleProvider,
  createLLMProvider,
  type TTSProvider,
  type TTSRequest,
  type TTSResponse,
  ElevenLabsProvider,
  createTTSProvider,
  type ASRProvider,
  type ASRRequest,
  type ASRResponse,
  OpenAIWhisperProvider,
  createASRProvider,
} from './providers/index.js';

// --- Stages ---
export {
  type IngestInput,
  type IngestOutput,
  extractVideoId,
  // ingest stages
  youtubeIngestStage,
  captionsStage,
  ytdlpSubsStage,
  ytAsrStage,
  textFileIngestStage,
  audioFileIngestStage,
  // process stages
  digestStage,
  researchPromptStage,
  // generate stages
  generateArticleStage,
  generatePodcastScriptStage,
  generateReelScriptStage,
  generateSocialPostsStage,
  // yt-dlp sub-stage additions
  probeStage,
  type YtdlpOverrides,
  type YtdlpProbeResult,
  type YtdlpFormat,
  type YtdlpSubtitleTrack,
  type YtdlpProgressDetail,
  type ResolvedYtdlpConfig,
  resolveYtdlpConfig,
  buildYtdlpArgs,
  formatCommandPreview,
  type DigestOutput,
  topTalkingPoints,
  type ResearchPromptOutput,
  type ContentType,
  type GenerateInput,
  type GenerateOutput,
  createGenerateStage,
  createParallelGenerateStage,
  type TTSRenderInput,
  type TTSRenderOutput,
} from './stages/index.js';

// --- Presets ---
export {
  type PresetOptions,
} from './presets.js';

// --- Utilities ---
export {
  shell,
  shellStrict,
  hasCommand,
  shellStreaming,
  type ShellResult,
  type ShellOptions,
  type ShellStreamingOptions,
  ensureDir,
  nowStamp,
  makeTempDir,
  rmSafe,
  readJsonSafe,
  writeJson,
  writeText,
  loadDotenv,
} from './utils/index.js';
