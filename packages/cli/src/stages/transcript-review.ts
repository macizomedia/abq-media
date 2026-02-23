/**
 * @module stages/transcript-review
 * TRANSCRIPT_REVIEW — Three sequential review gates:
 *   1. Transcript  (view / edit / continue)
 *   2. Cleaned transcript  (copy from transcript, then gate)
 *   3. Summary / digest  (copy from digest.md or clean.txt, then gate)
 *
 * Extracted from monolith cmdRun() L1125–L1220.
 *
 * Input context:
 *   - `transcriptPath` — set by TRANSCRIPTION
 *   - `runDir`, `legacyState`
 *
 * Output context:
 *   - `cleanedTranscriptPath` — path to clean.txt
 *   - `summaryPath`           — path to summary.txt
 *   - updated `legacyState`
 *
 * Next state: PROCESSING_SELECT
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { reviewGate } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, writeRunState } from '../utils/paths.js';

export async function transcriptReview(ctx: CLIContext): Promise<StageResult> {
  const credentials = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
  const editorCmd = (credentials.editorCommand ?? '') as string;

  // ── 1. Transcript gate ──────────────────────────────────────────────
  if (ctx.transcriptPath) {
    await reviewGate(ctx.transcriptPath, 'Transcript ready', editorCmd, 'TRANSCRIPT_REVIEW');
  }

  // ── 2. Cleaned transcript gate ──────────────────────────────────────
  const cleanDest = path.join(ctx.runDir, 'clean.txt');
  let legacyState = ctx.legacyState;

  if (!legacyState || legacyState.stages.clean !== 'done') {
    // Seed clean.txt from transcript
    if (ctx.transcriptPath && !fs.existsSync(cleanDest)) {
      fs.copyFileSync(ctx.transcriptPath, cleanDest);
    }
    if (fs.existsSync(cleanDest)) {
      await reviewGate(cleanDest, 'Cleaned transcript', editorCmd, 'TRANSCRIPT_REVIEW');
    }
    if (legacyState) {
      legacyState = {
        ...legacyState,
        stages: { ...legacyState.stages, clean: 'done' },
        updatedAt: new Date().toISOString(),
      };
      writeRunState(ctx.runDir, legacyState);
    }
  }

  // ── 3. Summary / digest gate ────────────────────────────────────────
  const summaryDest = path.join(ctx.runDir, 'summary.txt');

  if (!legacyState || legacyState.stages.summarize !== 'done') {
    const digestSrc = path.join(ctx.runDir, 'digest.md');
    if (fs.existsSync(digestSrc) && !fs.existsSync(summaryDest)) {
      fs.copyFileSync(digestSrc, summaryDest);
    } else if (!fs.existsSync(summaryDest) && fs.existsSync(cleanDest)) {
      fs.writeFileSync(summaryDest, fs.readFileSync(cleanDest, 'utf8'));
    }
    if (fs.existsSync(summaryDest)) {
      await reviewGate(summaryDest, 'Summary ready', editorCmd, 'TRANSCRIPT_REVIEW');
    }
    if (legacyState) {
      legacyState = {
        ...legacyState,
        stages: { ...legacyState.stages, summarize: 'done' },
        updatedAt: new Date().toISOString(),
      };
      writeRunState(ctx.runDir, legacyState);
    }
  }

  return {
    nextState: 'PROCESSING_SELECT',
    context: {
      ...ctx,
      cleanedTranscriptPath: fs.existsSync(cleanDest) ? cleanDest : ctx.cleanedTranscriptPath,
      summaryPath: fs.existsSync(summaryDest) ? summaryDest : ctx.summaryPath,
      legacyState,
      currentState: 'PROCESSING_SELECT',
      stateHistory: [...ctx.stateHistory, 'TRANSCRIPT_REVIEW'],
    },
  };
}
