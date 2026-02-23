/**
 * @module stages/script-generate
 * SCRIPT_GENERATE — Generate podcast or reel script via the publish pipeline.
 *
 * If the script already exists in runDir, skip generation and go straight
 * to the review gate. Otherwise auto-generate the research prompt (if
 * missing) and run `runPublish()`.
 *
 * Extracted from monolith cmdRun() L1398–L1480.
 *
 * Input context:
 *   - `outputType`          — 'podcast' or other (reel)
 *   - `researchPromptPath`  — may or may not exist yet
 *   - `runDir`, `lang`
 *
 * Output context:
 *   - `podcastScriptPath` / `reelScriptPath` — path to generated script
 *   - updated `legacyState`
 *
 * Next state: Determined by transition map.
 *   podcast → TTS_RENDER
 *   reel    → PACKAGE
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, State, StageResult } from '../machine/types.js';
import { clack, statusNote, previewMarkdown, reviewGate } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, writeRunState } from '../utils/paths.js';
import { runPrep, runPublish } from '../utils/core-bridge.js';
import { getNextState } from '../machine/transitions.js';

export async function scriptGenerate(ctx: CLIContext): Promise<StageResult> {
  const isPodcast = ctx.outputType === 'podcast';
  const outputFile = isPodcast ? 'podcast_script.md' : 'reel_script.md';
  const outputDest = path.join(ctx.runDir, outputFile);

  // Generate only if the script doesn't exist yet
  if (!fs.existsSync(outputDest)) {
    // Ensure research prompt exists
    let promptPath = ctx.researchPromptPath;
    if (!promptPath || !fs.existsSync(promptPath)) {
      const bestSource = [
        path.join(ctx.runDir, 'summary.txt'),
        path.join(ctx.runDir, 'clean.txt'),
        ctx.transcriptPath ?? path.join(ctx.runDir, 'transcript.txt'),
      ].find((f) => f && fs.existsSync(f) && fs.readFileSync(f, 'utf8').trim().length > 0);

      if (!bestSource) {
        clack.log.warn('No transcript or summary found to generate prompt from.');
        return {
          nextState: 'OUTPUT_SELECT',
          context: {
            ...ctx,
            currentState: 'OUTPUT_SELECT',
            stateHistory: [...ctx.stateHistory, 'SCRIPT_GENERATE'],
          },
        };
      }

      statusNote(`Generating research prompt from ${path.basename(bestSource)}…`);
      const prep = await runPrep({ transcriptFile: bestSource, lang: ctx.lang, outputDir: ctx.runDir });
      if (!prep.ok) {
        clack.log.error(prep.error ?? 'Prompt generation failed');
        return {
          nextState: 'OUTPUT_SELECT',
          context: {
            ...ctx,
            currentState: 'OUTPUT_SELECT',
            stateHistory: [...ctx.stateHistory, 'SCRIPT_GENERATE'],
          },
        };
      }
      const pSrc = path.join(ctx.runDir, 'deep_research_prompt.md');
      const pDest = path.join(ctx.runDir, 'prompt.md');
      if (fs.existsSync(pSrc)) fs.copyFileSync(pSrc, pDest);
      promptPath = fs.existsSync(pDest) ? pDest : undefined;

      if (!promptPath) {
        clack.log.warn('Prompt generation completed but output not found.');
        return {
          nextState: 'OUTPUT_SELECT',
          context: {
            ...ctx,
            currentState: 'OUTPUT_SELECT',
            stateHistory: [...ctx.stateHistory, 'SCRIPT_GENERATE'],
          },
        };
      }
    }

    // Run publish to generate scripts
    statusNote('Generating scripts. This can take a minute.');
    const pub = await runPublish({ inputFile: promptPath, lang: ctx.lang, outputDir: ctx.runDir });
    if (!pub.ok) {
      clack.log.error(pub.error ?? 'Script generation failed');
      return {
        nextState: 'OUTPUT_SELECT',
        context: {
          ...ctx,
          currentState: 'OUTPUT_SELECT',
          stateHistory: [...ctx.stateHistory, 'SCRIPT_GENERATE'],
        },
      };
    }
  }

  if (!fs.existsSync(outputDest)) {
    clack.log.warn(`${outputFile} not found in output.`);
    return {
      nextState: 'OUTPUT_SELECT',
      context: {
        ...ctx,
        currentState: 'OUTPUT_SELECT',
        stateHistory: [...ctx.stateHistory, 'SCRIPT_GENERATE'],
      },
    };
  }

  // Preview + review gate
  previewMarkdown(outputDest);
  const credentials = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
  const editorCmd = (credentials.editorCommand ?? '') as string;
  await reviewGate(outputDest, `${outputFile} ready`, editorCmd, 'SCRIPT_GENERATE');

  // Update legacy state
  let legacyState = ctx.legacyState;
  if (legacyState) {
    const stageKey = isPodcast ? 'podcast_script' : 'reel_script';
    legacyState = {
      ...legacyState,
      stages: { ...legacyState.stages, [stageKey]: 'done' },
      updatedAt: new Date().toISOString(),
    };
    writeRunState(ctx.runDir, legacyState);
  }

  // Also pick up article if it was generated as a side-effect
  const articlePath = path.join(ctx.runDir, 'article.md');
  const podcastScriptPath = path.join(ctx.runDir, 'podcast_script.md');
  const reelScriptPath = path.join(ctx.runDir, 'reel_script.md');

  const updated: CLIContext = {
    ...ctx,
    researchPromptPath: ctx.researchPromptPath ?? (fs.existsSync(path.join(ctx.runDir, 'prompt.md')) ? path.join(ctx.runDir, 'prompt.md') : undefined),
    articlePath: fs.existsSync(articlePath) ? articlePath : ctx.articlePath,
    podcastScriptPath: fs.existsSync(podcastScriptPath) ? podcastScriptPath : ctx.podcastScriptPath,
    reelScriptPath: fs.existsSync(reelScriptPath) ? reelScriptPath : ctx.reelScriptPath,
    legacyState,
    currentState: 'SCRIPT_GENERATE',
    stateHistory: [...ctx.stateHistory, 'SCRIPT_GENERATE'],
  };

  const resolved = getNextState('SCRIPT_GENERATE', updated);
  const nextState = (Array.isArray(resolved) ? resolved[0] : resolved) as State;

  return {
    nextState,
    context: { ...updated, currentState: nextState },
  };
}
