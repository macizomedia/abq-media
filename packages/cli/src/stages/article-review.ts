/**
 * @module stages/article-review
 * ARTICLE_REVIEW — Preview the generated article, then approve, retry, or edit.
 *
 * Extracted from monolith cmdRun() L1615–L1660.
 *
 * Input context:
 *   - `articlePath`     — path to article.md
 *   - `articleAttempts` — current attempt count
 *   - `runDir`
 *
 * Output context:
 *   - `lastError`  — set if user requests retry (used by transition map)
 *   - updated `legacyState`
 *
 * Next state: Determined by transition map.
 *   approve / edit / max retries → OUTPUT_SELECT
 *   retry (attempts < 3)         → ARTICLE_GENERATE
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, State, StageResult } from '../machine/types.js';
import { clack, unwrapCancel, previewMarkdown, openInEditor, editInTerminal } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, getProjectExportsDir, writeRunState } from '../utils/paths.js';
import { ensureDir } from '../utils/fs.js';
import { getNextState } from '../machine/transitions.js';

export async function articleReview(ctx: CLIContext): Promise<StageResult> {
  if (!ctx.articlePath || !fs.existsSync(ctx.articlePath)) {
    clack.log.error('Article file not found.');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('articlePath missing'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'ARTICLE_REVIEW'],
      },
    };
  }

  previewMarkdown(ctx.articlePath);

  const decision = await clack.select({
    message: 'Approve this article?',
    options: [
      { value: 'approve' as const, label: 'Approve' },
      { value: 'retry' as const, label: 'Retry with note' },
      { value: 'edit' as const, label: 'Edit in terminal' },
    ],
  });
  const picked = unwrapCancel(decision, 'ARTICLE_REVIEW');

  let lastError: Error | undefined;

  if (picked === 'edit') {
    const credentials = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
    const editorCmd = (credentials.editorCommand ?? '') as string;
    const ok = openInEditor(ctx.articlePath, editorCmd);
    if (!ok) await editInTerminal(ctx.articlePath);
    // Treat edit as approval
  } else if (picked === 'retry') {
    // Signal retry via lastError — the transition map checks this
    lastError = new Error('User requested article revision');
  }
  // 'approve' → no lastError, transition map routes to OUTPUT_SELECT

  // Update legacy state on approval
  let legacyState = ctx.legacyState;
  if (!lastError && legacyState) {
    legacyState = {
      ...legacyState,
      stages: { ...legacyState.stages, final: 'done' },
      updatedAt: new Date().toISOString(),
    };
    writeRunState(ctx.runDir, legacyState);

    // Export approved article
    const exportDir = getProjectExportsDir(ctx.projectName);
    ensureDir(exportDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.join(exportDir, `article-${stamp}.md`);
    fs.copyFileSync(ctx.articlePath, exportPath);
    clack.log.info(`Exported article: ${exportPath}`);
  }

  const updated: CLIContext = {
    ...ctx,
    lastError,
    legacyState,
    currentState: 'ARTICLE_REVIEW',
    stateHistory: [...ctx.stateHistory, 'ARTICLE_REVIEW'],
  };

  const resolved = getNextState('ARTICLE_REVIEW', updated);
  const nextState = (Array.isArray(resolved) ? resolved[0] : resolved) as State;

  return {
    nextState,
    context: { ...updated, currentState: nextState },
  };
}
