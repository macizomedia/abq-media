/**
 * @module stages/research-execute
 * RESEARCH_EXECUTE — Execute the research prompt via the publish pipeline.
 *
 * This calls `runPublish()` which generates:
 *   article.md, podcast_script.md, reel_script.md, social_posts.md
 *
 * Includes brand injection (format, tone, brand notes) before calling the LLM.
 *
 * Extracted from monolith cmdRun() L1555–L1610.
 *
 * Input context:
 *   - `researchPromptPath` — path to prompt.md
 *   - `runDir`, `lang`, `projectName`
 *
 * Output context:
 *   - `articlePath`, `podcastScriptPath`, `reelScriptPath`, `socialPostsPath`
 *   - `brandNotesPath`, `tonePreset`
 *   - updated `legacyState`
 *
 * Next state: OUTPUT_SELECT (always — D3 decision)
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, TonePreset, StageResult } from '../machine/types.js';
import { clack, unwrapCancel, statusNote, reviewGate } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import {
  getCredentialsPath,
  getProjectConfigPath,
  writeRunState,
} from '../utils/paths.js';
import { runPublish } from '../utils/core-bridge.js';

export async function researchExecute(ctx: CLIContext): Promise<StageResult> {
  if (!ctx.researchPromptPath || !fs.existsSync(ctx.researchPromptPath)) {
    clack.log.error('Research prompt not found. Generate one first.');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('researchPromptPath missing'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'RESEARCH_EXECUTE'],
      },
    };
  }

  // ── Format & Tone selection ──────────────────────────────────────────
  const formatChoice = await clack.select({
    message: 'Format template',
    options: [
      { value: 'newsletter', label: 'Newsletter' },
      { value: 'twitter', label: 'Twitter thread' },
      { value: 'linkedin', label: 'LinkedIn post' },
    ],
  });
  const formatTemplate = unwrapCancel(formatChoice, 'RESEARCH_EXECUTE') as string;

  const toneChoice = await clack.select({
    message: 'Tone template',
    options: [
      { value: 'formal', label: 'Formal' },
      { value: 'casual', label: 'Casual' },
      { value: 'urgent', label: 'Urgent' },
    ],
  });
  const toneTemplate = unwrapCancel(toneChoice, 'RESEARCH_EXECUTE') as string;

  // ── Brand injection ──────────────────────────────────────────────────
  const projectConfig = readJson<Record<string, unknown>>(getProjectConfigPath(ctx.projectName)) ?? {};
  const brandNotes = [
    `Brand handle: ${(projectConfig.handle as string) || 'n/a'}`,
    `CTA: ${(projectConfig.cta as string) || 'n/a'}`,
    `Tone preset: ${(projectConfig.tone as string) || 'informative'}`,
  ].join('\n');

  const brandDest = path.join(ctx.runDir, 'brand.txt');
  fs.writeFileSync(brandDest, brandNotes + '\n');

  const credentials = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
  const editorCmd = (credentials.editorCommand ?? '') as string;
  await reviewGate(brandDest, 'Brand injection notes', editorCmd, 'RESEARCH_EXECUTE');

  let legacyState = ctx.legacyState;
  if (legacyState) {
    legacyState = {
      ...legacyState,
      stages: { ...legacyState.stages, brand_inject: 'done' },
      updatedAt: new Date().toISOString(),
    };
    writeRunState(ctx.runDir, legacyState);
  }

  // ── Build enriched prompt ────────────────────────────────────────────
  const promptBase = fs.readFileSync(ctx.researchPromptPath, 'utf8');
  const enrichedPrompt = [
    promptBase.trim(),
    '',
    `Format template: ${formatTemplate}`,
    `Tone template: ${toneTemplate}`,
    brandNotes,
  ].filter(Boolean).join('\n') + '\n';

  const tempPrompt = path.join(ctx.runDir, 'prompt_render.md');
  fs.writeFileSync(tempPrompt, enrichedPrompt);

  // ── Run publish pipeline ─────────────────────────────────────────────
  statusNote('Generating content. This can take a minute.');
  const pub = await runPublish({
    inputFile: tempPrompt,
    lang: ctx.lang,
    outputDir: ctx.runDir,
  });

  if (!pub.ok) {
    clack.log.error(pub.error ?? 'Content generation failed');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error(pub.error ?? 'Publish failed'),
        currentState: 'ERROR',
        stateHistory: [...ctx.stateHistory, 'RESEARCH_EXECUTE'],
      },
    };
  }

  // ── Resolve output paths ─────────────────────────────────────────────
  const articlePath = path.join(ctx.runDir, 'article.md');
  const podcastScriptPath = path.join(ctx.runDir, 'podcast_script.md');
  const reelScriptPath = path.join(ctx.runDir, 'reel_script.md');
  const socialPostsPath = path.join(ctx.runDir, 'social_posts.md');

  return {
    nextState: 'OUTPUT_SELECT',
    context: {
      ...ctx,
      articlePath: fs.existsSync(articlePath) ? articlePath : ctx.articlePath,
      podcastScriptPath: fs.existsSync(podcastScriptPath) ? podcastScriptPath : ctx.podcastScriptPath,
      reelScriptPath: fs.existsSync(reelScriptPath) ? reelScriptPath : ctx.reelScriptPath,
      socialPostsPath: fs.existsSync(socialPostsPath) ? socialPostsPath : ctx.socialPostsPath,
      brandNotesPath: brandDest,
      tonePreset: toneTemplate as TonePreset,
      legacyState,
      currentState: 'OUTPUT_SELECT',
      stateHistory: [...ctx.stateHistory, 'RESEARCH_EXECUTE'],
    },
  };
}
