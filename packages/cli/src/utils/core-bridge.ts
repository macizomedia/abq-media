/**
 * @module utils/core-bridge
 * Shared wrappers for constructing and running `@abquanta/abq-media-core` Pipelines
 * from CLI stage handlers.
 *
 * Centralises:
 *   - Pipeline construction from stage lists
 *   - Config loading (with lang override)
 *   - Spinner feedback driven by core `PipelineEmitter` events
 *   - Error normalisation back to `{ ok, output?, error? }`
 *
 * CLI stages should call `runCorePipeline()` instead of building Pipelines directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  Pipeline,
  loadConfig,
  nowStamp,
  type PipelineResult,
  type Stage,
  // Ingest stages
  youtubeIngestStage,
  captionsStage,
  textFileIngestStage,
  audioFileIngestStage,
  // Processing stages
  digestStage,
  researchPromptStage,
  generateArticleStage,
  generatePodcastScriptStage,
  generateReelScriptStage,
  generateSocialPostsStage,
  ttsRenderStage,
  extractVideoId,
} from '@abquanta/abq-media-core';

import { ensureDir } from './fs.js';
import { withSpinnerAsync } from '../ui/prompts.js';

// ---------------------------------------------------------------------------
// Core result type
// ---------------------------------------------------------------------------

export interface CoreRunResult {
  ok: boolean;
  output?: string;
  error?: string;
  /** The raw core PipelineResult when ok=true. */
  pipelineResult?: PipelineResult;
}

// ---------------------------------------------------------------------------
// Generic pipeline runner
// ---------------------------------------------------------------------------

/**
 * Build and run a core Pipeline with spinner feedback.
 *
 * @param opts.name        Pipeline name for logging.
 * @param opts.stages      Ordered list of core Stage instances.
 * @param opts.input       Initial input object for stage 0.
 * @param opts.lang        BCP-47 language code (passed to config).
 * @param opts.outputDir   Absolute path to the run's output directory.
 * @param opts.spinnerLabel Label shown on the clack spinner.
 */
export async function runCorePipeline(opts: {
  name: string;
  stages: Stage<unknown, unknown>[];
  input: Record<string, unknown>;
  lang: string;
  outputDir: string;
  spinnerLabel?: string;
}): Promise<CoreRunResult> {
  try {
    const config = loadConfig({ lang: opts.lang });
    ensureDir(opts.outputDir);

    const pipeline = new Pipeline({
      name: opts.name,
      stages: opts.stages,
      config,
      outputDir: opts.outputDir,
    });

    const result = await withSpinnerAsync(
      opts.spinnerLabel ?? `Running ${opts.name}…`,
      () => pipeline.run(opts.input),
    );

    return { ok: true, output: `${opts.name} completed`, pipelineResult: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Prep pipeline (ingest + digest + research prompt)
// ---------------------------------------------------------------------------

export interface PrepInput {
  url?: string;
  audioFile?: string;
  textFile?: string;
  transcriptFile?: string;
  lang: string;
  captionsOnly?: boolean;
  outputDir: string;
}

/**
 * Run the "prep" pipeline — ingest → digest → researchPrompt.
 * Matches the monolith's `runPrepDirect()`.
 */
export async function runPrep(opts: PrepInput): Promise<CoreRunResult> {
  // Pick the right ingest stage
  let ingestStage: Stage<unknown, unknown>;
  if (opts.url) {
    ingestStage = opts.captionsOnly
      ? (captionsStage as Stage<unknown, unknown>)
      : (youtubeIngestStage as Stage<unknown, unknown>);
  } else if (opts.textFile || opts.transcriptFile) {
    ingestStage = textFileIngestStage as Stage<unknown, unknown>;
  } else if (opts.audioFile) {
    ingestStage = audioFileIngestStage as Stage<unknown, unknown>;
  } else {
    ingestStage = textFileIngestStage as Stage<unknown, unknown>;
  }

  const videoId = opts.url ? extractVideoId(opts.url) : '';

  const input: Record<string, unknown> = {
    url: opts.url ?? undefined,
    videoId: videoId || undefined,
    lang: opts.lang,
    text: undefined,
    transcriptFile: opts.transcriptFile ?? opts.textFile ?? undefined,
    audioFile: opts.audioFile ?? undefined,
  };

  const result = await runCorePipeline({
    name: 'prep',
    stages: [ingestStage, digestStage as Stage<unknown, unknown>, researchPromptStage as Stage<unknown, unknown>],
    input,
    lang: opts.lang,
    outputDir: opts.outputDir,
    spinnerLabel: 'Transcribing source…',
  });

  // Enrich metadata if successful
  if (result.ok) {
    const metaPath = path.join(opts.outputDir, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        Object.assign(meta, {
          stage: 'prep',
          source: opts.url ? 'YouTube video' : opts.audioFile ? 'audio file' : 'plain text',
          url: opts.url ?? null,
          videoId: videoId || null,
          lang: opts.lang,
        });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      } catch { /* ignore metadata enrichment failures */ }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Publish pipeline (article + podcast + reel + social)
// ---------------------------------------------------------------------------

export interface PublishInput {
  inputFile: string;
  lang: string;
  outputDir: string;
}

/**
 * Run the "publish" pipeline — article → podcast script → reel script → social posts.
 * Matches the monolith's `runPublishDirect()`.
 */
export async function runPublish(opts: PublishInput): Promise<CoreRunResult> {
  const config = loadConfig({ lang: opts.lang });
  if (!config.llm.apiKey) {
    return { ok: false, error: 'LLM API key not configured. Set llmApiKey / OPENROUTER_API_KEY.' };
  }

  const researchPrompt = fs.readFileSync(opts.inputFile, 'utf8').trim();
  if (!researchPrompt) {
    return { ok: false, error: 'Input file is empty.' };
  }

  return runCorePipeline({
    name: 'publish',
    stages: [
      generateArticleStage as Stage<unknown, unknown>,
      generatePodcastScriptStage as Stage<unknown, unknown>,
      generateReelScriptStage as Stage<unknown, unknown>,
      generateSocialPostsStage as Stage<unknown, unknown>,
    ],
    input: { researchPrompt, lang: opts.lang },
    lang: opts.lang,
    outputDir: opts.outputDir,
    spinnerLabel: 'Generating content…',
  });
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export {
  youtubeIngestStage,
  captionsStage,
  textFileIngestStage,
  audioFileIngestStage,
  digestStage,
  researchPromptStage,
  generateArticleStage,
  generatePodcastScriptStage,
  generateReelScriptStage,
  generateSocialPostsStage,
  ttsRenderStage,
  extractVideoId,
  loadConfig,
  Pipeline,
  nowStamp,
};
