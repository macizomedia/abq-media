/**
 * @module stages/article-generate
 * ARTICLE_GENERATE — Generate (or regenerate) an article via the publish
 * pipeline. Supports revision notes for retry attempts.
 *
 * Extracted from monolith cmdRun() L1580–L1610.
 *
 * Input context:
 *   - `researchPromptPath` — base prompt
 *   - `brandNotesPath`, `tonePreset` — brand injection
 *   - `articleAttempts` — current attempt count
 *   - `lastError` — revision note from previous reject (if retrying)
 *   - `runDir`, `lang`
 *
 * Output context:
 *   - `articlePath` — path to generated article.md
 *   - `articleAttempts` — incremented
 *
 * Next state: ARTICLE_REVIEW
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, statusNote } from '../ui/prompts.js';
import { runPublish } from '../utils/core-bridge.js';

export async function articleGenerate(ctx: CLIContext): Promise<StageResult> {
  if (!ctx.researchPromptPath || !fs.existsSync(ctx.researchPromptPath)) {
    clack.log.error('Research prompt not found.');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('researchPromptPath missing'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'ARTICLE_GENERATE'],
      },
    };
  }

  const attempts = (ctx.articleAttempts ?? 0) + 1;

  // Collect revision note if this is a retry
  let revisionNote = '';
  if (attempts > 1) {
    const note = await clack.text({ message: 'Revision note for retry' });
    if (!clack.isCancel(note) && note) {
      revisionNote = String(note).trim();
    }
  }

  // Build enriched prompt
  const promptBase = fs.readFileSync(ctx.researchPromptPath, 'utf8');
  const brandNotes = ctx.brandNotesPath && fs.existsSync(ctx.brandNotesPath)
    ? fs.readFileSync(ctx.brandNotesPath, 'utf8').trim()
    : '';

  const enrichedPrompt = [
    promptBase.trim(),
    '',
    ctx.tonePreset ? `Tone template: ${ctx.tonePreset}` : '',
    brandNotes,
    revisionNote ? `Revision note: ${revisionNote}` : '',
  ].filter(Boolean).join('\n') + '\n';

  const tempPrompt = path.join(ctx.runDir, 'prompt_render.md');
  fs.writeFileSync(tempPrompt, enrichedPrompt);

  statusNote(`Generating article (attempt ${attempts}/3). This can take a minute.`);
  const pub = await runPublish({
    inputFile: tempPrompt,
    lang: ctx.lang,
    outputDir: ctx.runDir,
  });

  if (!pub.ok) {
    clack.log.error(pub.error ?? 'Article generation failed');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error(pub.error ?? 'Publish failed'),
        articleAttempts: attempts,
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'ARTICLE_GENERATE'],
      },
    };
  }

  const articlePath = path.join(ctx.runDir, 'article.md');
  if (!fs.existsSync(articlePath)) {
    clack.log.error('Article not found in publish output.');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('article.md missing after publish'),
        articleAttempts: attempts,
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'ARTICLE_GENERATE'],
      },
    };
  }

  return {
    nextState: 'ARTICLE_REVIEW',
    context: {
      ...ctx,
      articlePath,
      articleAttempts: attempts,
      lastError: undefined,
      currentState: 'ARTICLE_REVIEW',
      stateHistory: [...ctx.stateHistory, 'ARTICLE_GENERATE'],
    },
  };
}
