/**
 * @module stages/research-prompt
 * RESEARCH_PROMPT_GEN — Generate deep research prompt from the best
 * available source (summary > clean > transcript), then let the user
 * preview and optionally edit.
 *
 * Extracted from monolith cmdRun() L1497–L1540.
 *
 * Input context:
 *   - `runDir`, `transcriptPath`, `summaryPath`, `cleanedTranscriptPath`
 *   - `lang`, `processingType`
 *
 * Output context:
 *   - `researchPromptPath` — path to prompt.md
 *   - updated `legacyState`
 *
 * Next state: Determined by transition map.
 *   processingType === 'prompt'  → OUTPUT_SELECT  (prompt-only)
 *   processingType === 'article' → RESEARCH_EXECUTE
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, State, StageResult } from '../machine/types.js';
import { clack, statusNote, previewMarkdown, reviewGate } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, writeRunState } from '../utils/paths.js';
import { runPrep } from '../utils/core-bridge.js';
import { getNextState } from '../machine/transitions.js';

export async function researchPromptGen(ctx: CLIContext): Promise<StageResult> {
  // Determine best source file (priority: summary > clean > transcript)
  const candidates = [
    ctx.summaryPath ?? path.join(ctx.runDir, 'summary.txt'),
    ctx.cleanedTranscriptPath ?? path.join(ctx.runDir, 'clean.txt'),
    ctx.transcriptPath ?? path.join(ctx.runDir, 'transcript.txt'),
  ];
  const bestSource = candidates.find(
    (f) => f && fs.existsSync(f) && fs.readFileSync(f, 'utf8').trim().length > 0,
  );

  if (!bestSource) {
    clack.log.error('No transcript or summary found to generate prompt from.');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('No source for prompt generation'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'RESEARCH_PROMPT_GEN'],
      },
    };
  }

  statusNote(`Generating research prompt from ${path.basename(bestSource)}…`);
  const prep = await runPrep({
    transcriptFile: bestSource,
    lang: ctx.lang,
    outputDir: ctx.runDir,
  });

  if (!prep.ok) {
    clack.log.error(prep.error ?? 'Prompt generation failed');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error(prep.error ?? 'Prompt generation failed'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'RESEARCH_PROMPT_GEN'],
      },
    };
  }

  // Copy deep_research_prompt.md → prompt.md (the canonical name)
  const promptSrc = path.join(ctx.runDir, 'deep_research_prompt.md');
  const promptDest = path.join(ctx.runDir, 'prompt.md');
  if (fs.existsSync(promptSrc)) {
    fs.copyFileSync(promptSrc, promptDest);
  }

  if (!fs.existsSync(promptDest)) {
    clack.log.error('Deep research prompt not found in output.');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('Prompt file missing after generation'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'RESEARCH_PROMPT_GEN'],
      },
    };
  }

  // Preview + optional edit
  previewMarkdown(promptDest);
  const editChoice = await clack.confirm({ message: 'Edit the research prompt?', initialValue: false });
  if (!clack.isCancel(editChoice) && editChoice) {
    const credentials = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
    const editorCmd = (credentials.editorCommand ?? '') as string;
    await reviewGate(promptDest, 'Research prompt', editorCmd, 'RESEARCH_PROMPT_GEN');
  }

  // Update legacy state
  let legacyState = ctx.legacyState;
  if (legacyState) {
    legacyState = {
      ...legacyState,
      stages: { ...legacyState.stages, reformat: 'done' },
      updatedAt: new Date().toISOString(),
    };
    writeRunState(ctx.runDir, legacyState);
  }

  if (ctx.processingType === 'prompt') {
    clack.log.info(`Prompt saved: ${promptDest}`);
  }

  const updated: CLIContext = {
    ...ctx,
    researchPromptPath: promptDest,
    legacyState,
    currentState: 'RESEARCH_PROMPT_GEN',
    stateHistory: [...ctx.stateHistory, 'RESEARCH_PROMPT_GEN'],
  };

  const resolved = getNextState('RESEARCH_PROMPT_GEN', updated);
  const nextState = (Array.isArray(resolved) ? resolved[0] : resolved) as State;

  return {
    nextState,
    context: { ...updated, currentState: nextState },
  };
}
