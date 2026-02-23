/**
 * @module stages/output-select
 * OUTPUT_SELECT — Choose what to do next with existing artifacts:
 *   generate more content, export, or finish.
 *
 * This is the "hub" state that users return to after every processing
 * pass. It mirrors the monolith's keep-going loop menu.
 *
 * Input context:
 *   - artifact paths (articlePath, podcastScriptPath, etc.)
 *   - `runDir`, `researchPromptPath`
 *
 * Output context:
 *   - `outputType` — selected output action
 *
 * Next state: Determined by transition map.
 *   podcast   → SCRIPT_GENERATE
 *   article   → ARTICLE_GENERATE
 *   social_kit / export_zip → PACKAGE
 *   ("Finish" short-circuits to COMPLETE)
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, OutputType, State, StageResult } from '../machine/types.js';
import { clack, unwrapCancel } from '../ui/prompts.js';
import { getNextState } from '../machine/transitions.js';

export async function outputSelect(ctx: CLIContext): Promise<StageResult> {
  const hasPrompt = !!ctx.researchPromptPath || fs.existsSync(path.join(ctx.runDir, 'prompt.md'));
  const hasPodcastScript = !!ctx.podcastScriptPath || fs.existsSync(path.join(ctx.runDir, 'podcast_script.md'));
  const hasAnyContent = !!(ctx.articlePath || ctx.podcastScriptPath || ctx.reelScriptPath);

  type MenuValue = OutputType | 'done';

  const options: { value: MenuValue; label: string }[] = [];

  if (hasPrompt) {
    options.push(
      { value: 'article', label: 'Generate / regenerate article' },
      { value: 'podcast', label: 'Generate podcast script + audio' },
    );
  }

  if (hasAnyContent) {
    options.push(
      { value: 'social_kit', label: 'View / export social posts' },
      { value: 'export_zip', label: 'Export package (zip)' },
    );
  }

  options.push({ value: 'done', label: 'Finish' });

  // Status summary
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
  const picked = unwrapCancel(choice, 'OUTPUT_SELECT') as MenuValue;

  // "Finish" → COMPLETE
  if (picked === 'done') {
    return {
      nextState: 'COMPLETE',
      context: {
        ...ctx,
        currentState: 'COMPLETE',
        stateHistory: [...ctx.stateHistory, 'OUTPUT_SELECT'],
      },
    };
  }

  const outputType = picked as OutputType;

  const updated: CLIContext = {
    ...ctx,
    outputType,
    currentState: 'OUTPUT_SELECT',
    stateHistory: [...ctx.stateHistory, 'OUTPUT_SELECT'],
  };

  const resolved = getNextState('OUTPUT_SELECT', updated);
  const nextState = (Array.isArray(resolved) ? resolved[0] : resolved) as State;

  return {
    nextState,
    context: { ...updated, currentState: nextState },
  };
}
