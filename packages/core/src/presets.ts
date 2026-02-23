/**
 * @module presets
 * Pre-composed pipeline definitions for common workflows.
 *
 * Each preset is a ready-to-run pipeline. Consumers can use them directly
 * or customize by cloning the stage list.
 */

import { definePipeline, type Pipeline } from './pipeline.js';
import { youtubeIngestStage } from './stages/ingest/youtube.js';
import { textFileIngestStage } from './stages/ingest/text-file.js';
import { audioFileIngestStage } from './stages/ingest/audio-file.js';
import { digestStage } from './stages/process/digest.js';
import { researchPromptStage } from './stages/process/research-prompt.js';
import {
  generateArticleStage,
  generatePodcastScriptStage,
  generateReelScriptStage,
  generateSocialPostsStage,
  createParallelGenerateStage,
} from './stages/generate/content.js';
import { ttsRenderStage } from './stages/render/tts.js';
import type { PipelineConfig } from './config.js';
import type { Logger } from './context.js';

// ---------------------------------------------------------------------------
// Options shared by all preset factories
// ---------------------------------------------------------------------------

export interface PresetOptions {
  config?: Partial<PipelineConfig>;
  logger?: Logger;
  signal?: AbortSignal;
  outputDir?: string;
}

// ---------------------------------------------------------------------------
// YouTube → Full Suite (article + podcast + reel + social + TTS audio)
// ---------------------------------------------------------------------------

export function youtubeToFullSuite(opts: PresetOptions = {}): Pipeline {
  return definePipeline({
    name: 'YouTube → Full Suite',
    stages: [
      youtubeIngestStage,
      digestStage,
      researchPromptStage,
      // Parallel generation happens inside this wrapper.
      // Since the pipeline is sequential, we bridge with a stage
      // that fans out and collects results.
      createPublishBridgeStage(),
    ],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Text → Full Suite
// ---------------------------------------------------------------------------

export function textToFullSuite(opts: PresetOptions = {}): Pipeline {
  return definePipeline({
    name: 'Text → Full Suite',
    stages: [
      textFileIngestStage,
      digestStage,
      researchPromptStage,
      createPublishBridgeStage(),
    ],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Audio → Full Suite
// ---------------------------------------------------------------------------

export function audioToFullSuite(opts: PresetOptions = {}): Pipeline {
  return definePipeline({
    name: 'Audio → Full Suite',
    stages: [
      audioFileIngestStage,
      digestStage,
      researchPromptStage,
      createPublishBridgeStage(),
    ],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// YouTube → Article only
// ---------------------------------------------------------------------------

export function youtubeToArticle(opts: PresetOptions = {}): Pipeline {
  return definePipeline({
    name: 'YouTube → Article',
    stages: [
      youtubeIngestStage,
      digestStage,
      researchPromptStage,
      generateArticleStage,
    ],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Script → Audio (just TTS)
// ---------------------------------------------------------------------------

export function scriptToAudio(opts: PresetOptions = {}): Pipeline {
  return definePipeline({
    name: 'Script → Audio',
    stages: [ttsRenderStage],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Bridge stage: adapts ResearchPromptOutput → generates all content
// ---------------------------------------------------------------------------

import type { Stage } from './stage.js';
import type { ResearchPromptOutput } from './stages/process/research-prompt.js';
import type { PipelineContext } from './context.js';

interface PublishBridgeOutput {
  generated: Record<string, { ok: boolean; text?: string; error?: string }>;
  researchPrompt: string;
}

function createPublishBridgeStage(): Stage<ResearchPromptOutput, PublishBridgeOutput> {
  return {
    name: 'generate:publish-all',
    description: 'Generate all content types from research prompt (parallel)',

    canRun(_input, ctx) {
      return !!(ctx.config.llm.apiKey);
    },

    async run(input, ctx) {
      const parallelStage = createParallelGenerateStage(ctx.config.output.formats);
      const results = await parallelStage.run(
        { researchPrompt: input.researchPrompt, lang: ctx.config.lang },
        ctx,
      );

      const generated: PublishBridgeOutput['generated'] = {};
      for (const [name, result] of results) {
        if (result.ok) {
          const val = result.value as { contentType: string; text: string };
          generated[name] = { ok: true, text: val.text };
        } else {
          generated[name] = { ok: false, error: result.error.message };
        }
      }

      return { generated, researchPrompt: input.researchPrompt };
    },
  };
}
