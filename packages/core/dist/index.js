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
export { FallbackStage, ParallelStage, } from './stage.js';
// --- Events ---
export { PipelineEmitter, } from './events.js';
// --- Context ---
export { ConsoleLogger, } from './context.js';
// --- Config ---
export { PipelineConfigSchema, LLMConfigSchema, ASRConfigSchema, TTSConfigSchema, TranscriptConfigSchema, OutputConfigSchema, YtdlpConfigSchema, YtdlpWorkaroundsSchema, loadConfig, } from './config.js';
// --- Pipeline runner ---
export { Pipeline, definePipeline, } from './pipeline.js';
// --- Registry ---
export { StageRegistry, withLogging, } from './registry.js';
// --- Providers ---
export { OpenAICompatibleProvider, createLLMProvider, ElevenLabsProvider, createTTSProvider, OpenAIWhisperProvider, createASRProvider, } from './providers/index.js';
// --- Stages ---
export { extractVideoId, 
// ingest stages
youtubeIngestStage, captionsStage, ytdlpSubsStage, ytAsrStage, textFileIngestStage, audioFileIngestStage, 
// process stages
digestStage, researchPromptStage, 
// generate stages
generateArticleStage, generatePodcastScriptStage, generateReelScriptStage, generateSocialPostsStage, 
// yt-dlp sub-stage additions
probeStage, resolveYtdlpConfig, buildYtdlpArgs, formatCommandPreview, topTalkingPoints, createGenerateStage, createParallelGenerateStage, } from './stages/index.js';
// --- Utilities ---
export { shell, shellStrict, hasCommand, shellStreaming, ensureDir, nowStamp, makeTempDir, rmSafe, readJsonSafe, writeJson, writeText, loadDotenv, } from './utils/index.js';
//# sourceMappingURL=index.js.map