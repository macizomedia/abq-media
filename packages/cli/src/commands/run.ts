/**
 * @module commands/run
 * `abq-media run` — Main pipeline orchestrator.
 *
 * Creates an initial CLIContext, builds the stage registry, and hands
 * everything to PipelineRunner. Supports `--resume` and `--from` flags.
 *
 * Extracted from monolith cmdRun() and wired in Phase 7.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Recipe, RecipeSchema } from '../../../core/src/recipe';
import { ALL_STATES, TERMINAL_STATES } from '../machine/types.js';
import { createInitialContext } from '../machine/context.js';
import { PipelineRunner, createDefaultRegistry } from '../machine/runner.js';
import { YouTubeEngine } from '@abq/engine-youtube';
import { WhisperEngine } from '@abq/engine-whisper';
import { ElevenLabsEngine } from '@abq/engine-elevenlabs';
import { clack } from '../ui/prompts.js';
import { PipelineError } from '../utils/errors.js';
import { readJson } from '../utils/fs';

// ---------------------------------------------------------------------------
// argv helpers
// ---------------------------------------------------------------------------

function arg(flag: string, fallback = ''): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function cmdRun(): Promise<void> {
  const resumeArg = arg('--resume');
  const fromState = arg('--from') as State | '';
  const debugMode = hasFlag('--debugger');
  const projectArg = arg('--project');
  const langArg = arg('--lang', 'es');
  const recipeArg = arg('--recipe');

  if (!recipeArg) {
    clack.log.error('A recipe is required: --recipe ./path/to/recipe.json');
    process.exitCode = 1;
    return;
  }

  let recipe: Recipe;
  try {
    const recipeJson = readJson(recipeArg);
    recipe = RecipeSchema.parse(recipeJson);
  } catch (err) {
    clack.log.error(`Invalid recipe: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // ── Debugger fast-path ────────────────────────────────────────────
  // Mirrors monolith: copy sample artifacts, skip all external calls.
  if (debugMode) {
    clack.intro('abq-media run');
    clack.log.info('Debugger mode: using sample artifacts (no external calls).');

    const samplesDir = path.resolve(import.meta.dirname, '../../samples');
    const tmpRun = path.join(
      process.env.HOME || os.tmpdir(),
      '.abq-media',
      'projects',
      projectArg || 'debug',
      'runs',
      `debug-${Date.now()}`,
    );
    fs.mkdirSync(tmpRun, { recursive: true });

    const filesToCopy: [string, string][] = [
      ['transcript.txt', 'transcript.txt'],
      ['prompt.md', 'deep_research_prompt.md'],
      ['podcast_script.md', 'podcast_script.md'],
      ['article.md', 'article.md'],
      ['reel_script.md', 'reel_script.md'],
      ['social_posts.md', 'social_posts.md'],
    ];
    for (const [src, dest] of filesToCopy) {
      const srcPath = path.join(samplesDir, src);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(tmpRun, dest));
      }
    }
    // Stub media files
    fs.writeFileSync(path.join(tmpRun, 'podcast.mp3'), '');
    fs.writeFileSync(path.join(tmpRun, 'video.mp4'), '');

    clack.log.success(`Debug outputs written to ${tmpRun}`);
    clack.outro('Done (debugger mode).');
    return;
  }

  const registry = await createDefaultRegistry();
  registry.register(new YouTubeEngine());
  // This is a placeholder for where you would get your API keys
  const whisperApiKey = process.env.OPENAI_API_KEY;
  if (whisperApiKey) {
    registry.register(new WhisperEngine(whisperApiKey));
  }
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  if (elevenLabsApiKey) {
    registry.register(new ElevenLabsEngine(elevenLabsApiKey));
  }

  // ── Resume from checkpoint ──────────────────────────────────────────
  if (resumeArg) {
    let checkpointFile = resumeArg;

    // If "--resume" was passed without a path, find the latest checkpoint
    if (!checkpointFile || checkpointFile.startsWith('--')) {
      clack.log.error('Provide a checkpoint path: --resume ./path/to/checkpoint.json');
      process.exitCode = 1;
      return;
    }

    checkpointFile = path.resolve(checkpointFile);
    if (!fs.existsSync(checkpointFile)) {
      clack.log.error(`Checkpoint not found: ${checkpointFile}`);
      process.exitCode = 1;
      return;
    }

    clack.intro('abq-media run (resuming)');
    try {
      const finalCtx = await PipelineRunner.resume(checkpointFile, registry, recipe, {
        skipCheckpoints: debugMode,
      });
      if (finalCtx.currentState === 'ERROR') {
        clack.log.error(`Run ended in ERROR: ${finalCtx.lastError?.message ?? 'unknown'}`);
        process.exitCode = 1;
      }
    } catch (err) {
      clack.log.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
    return;
  }

  // ── Fresh run ──────────────────────────────────────────────────────

  // Determine starting state
  let initialState: State = 'PROJECT_INIT';
  if (fromState) {
    if (!ALL_STATES.includes(fromState as State)) {
      clack.log.error(`Unknown state: '${fromState}'. Valid: ${ALL_STATES.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    if (TERMINAL_STATES.has(fromState as State)) {
      clack.log.error(`Cannot start from terminal state '${fromState}'.`);
      process.exitCode = 1;
      return;
    }
    initialState = fromState as State;
  }

  clack.intro('abq-media run');

  const ctx = createInitialContext({
    projectName: projectArg || 'default',
    lang: langArg,
    initialState,
  });

  const runner = new PipelineRunner({
    registry,
    context: ctx,
    recipe,
    skipCheckpoints: debugMode,
  });

  try {
    const finalCtx = await runner.run();
    if (finalCtx.currentState === 'ERROR') {
      clack.log.error(`Run ended in ERROR: ${finalCtx.lastError?.message ?? 'unknown'}`);
      const checkpointHint = path.join(finalCtx.runDir, 'checkpoints');
      if (fs.existsSync(checkpointHint)) {
        clack.log.info(`Resume with: abq-media run --resume <checkpoint.json>`);
        clack.log.info(`Checkpoints: ${checkpointHint}`);
      }
      process.exitCode = 1;
    }
  } catch (err) {
    clack.log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
