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
  loadConfig,
  type PipelineConfig,
  type LLMConfig,
  type ASRConfig,
  type TTSConfig,
  type TranscriptConfig,
  type OutputConfig,
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
  youtubeIngestStage,
  captionsStage,
  ytdlpSubsStage,
  ytAsrStage,
  textFileIngestStage,
  audioFileIngestStage,
  type DigestOutput,
  digestStage,
  topTalkingPoints,
  type ResearchPromptOutput,
  researchPromptStage,
  type ContentType,
  type GenerateInput,
  type GenerateOutput,
  createGenerateStage,
  generateArticleStage,
  generatePodcastScriptStage,
  generateReelScriptStage,
  generateSocialPostsStage,
  createParallelGenerateStage,
  type TTSRenderInput,
  type TTSRenderOutput,
  ttsRenderStage,
} from './stages/index.js';

// --- Presets ---
export {
  youtubeToFullSuite,
  textToFullSuite,
  audioToFullSuite,
  youtubeToArticle,
  scriptToAudio,
  type PresetOptions,
} from './presets.js';

// --- Utilities ---
export {
  shell,
  shellStrict,
  hasCommand,
  type ShellResult,
  type ShellOptions,
  ensureDir,
  nowStamp,
  makeTempDir,
  rmSafe,
  readJsonSafe,
  writeJson,
  writeText,
  loadDotenv,
} from './utils/index.js';
