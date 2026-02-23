/**
 * @module stages/processing-select
 * PROCESSING_SELECT — Present the menu of processing options based on
 * what artifacts already exist, then route via the transition map.
 *
 * Extracted from monolith cmdRun() L1220–L1260.
 *
 * Input context:
 *   - `runDir`, `transcriptPath`
 *   - optional: `researchPromptPath`, `articlePath`, `podcastScriptPath`
 *
 * Output context:
 *   - `processingType` — selected processing action
 *
 * Next state: Determined dynamically by the transition map.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, ProcessingType, State, StageResult } from '../machine/types.js';
import { clack, unwrapCancel } from '../ui/prompts.js';
import { getNextState } from '../machine/transitions.js';

export async function processingSelect(ctx: CLIContext): Promise<StageResult> {
  // Derive menu availability from existing artifacts
  const hasPrompt = !!ctx.researchPromptPath || fs.existsSync(path.join(ctx.runDir, 'prompt.md'));
  const hasPodcastScript = !!ctx.podcastScriptPath || fs.existsSync(path.join(ctx.runDir, 'podcast_script.md'));
  const hasAnyContent = !!(ctx.articlePath || ctx.podcastScriptPath || ctx.reelScriptPath);

  type MenuValue = ProcessingType | 'done';

  const options: { value: MenuValue; label: string }[] = [
    { value: 'export', label: 'Use transcript only (export)' },
    { value: 'translate', label: 'Translate transcript (coming soon)' },
    { value: 'prompt', label: hasPrompt ? 'Regenerate research prompt' : 'Generate deep research prompt' },
  ];

  if (hasPrompt) {
    options.push(
      { value: 'article', label: 'Generate article' },
      { value: 'podcast_script', label: 'Generate podcast script' },
      { value: 'reel_script', label: 'Generate video / reel script' },
    );
  }

  if (hasAnyContent) {
    options.push({ value: 'export_zip', label: 'Export package (zip)' });
  }

  options.push({ value: 'done', label: 'Finish' });

  // Build ready-items summary
  const readyItems: string[] = [];
  if (ctx.transcriptPath) readyItems.push('transcript');
  if (ctx.articlePath) readyItems.push('article');
  if (ctx.podcastScriptPath) readyItems.push('podcast script');
  if (ctx.reelScriptPath) readyItems.push('reel script');
  const readyStr = readyItems.length ? `Ready: ${readyItems.join(', ')} — ` : '';

  const choice = await clack.select({
    message: `${readyStr}What do you want to do next?`,
    options,
  });
  const picked = unwrapCancel(choice, 'PROCESSING_SELECT') as MenuValue;

  // "done" short-circuits to COMPLETE
  if (picked === 'done') {
    return {
      nextState: 'COMPLETE',
      context: {
        ...ctx,
        currentState: 'COMPLETE',
        stateHistory: [...ctx.stateHistory, 'PROCESSING_SELECT'],
      },
    };
  }

  const processingType = picked as ProcessingType;

  const updated: CLIContext = {
    ...ctx,
    processingType,
    currentState: 'PROCESSING_SELECT',
    stateHistory: [...ctx.stateHistory, 'PROCESSING_SELECT'],
  };

  const resolved = getNextState('PROCESSING_SELECT', updated);
  const nextState = (Array.isArray(resolved) ? resolved[0] : resolved) as State;

  return {
    nextState,
    context: { ...updated, currentState: nextState },
  };
}
