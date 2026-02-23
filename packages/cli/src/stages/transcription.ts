/**
 * @module stages/transcription
 * TRANSCRIPTION — Delegates to core Pipeline for ingest + digest.
 *
 * Extracted from monolith cmdRun() L1078–L1120.
 *
 * Input context:
 *   - `youtubeUrl` OR `inputPath` — set by INPUT_YOUTUBE / INPUT_AUDIO
 *   - `transcriptPath` — may already be set if transcript was reused
 *   - `runDir`, `lang`, `projectName`
 *
 * Output context:
 *   - `transcriptPath`        — path to transcript.txt
 *   - `cleanedTranscriptPath` — path to clean.txt
 *   - `summaryPath`           — path to summary.txt / digest.md
 *   - `researchPromptPath`    — path to prompt.md (if generated)
 *   - updated `legacyState`
 *
 * Next state: TRANSCRIPT_REVIEW
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, statusNote, withSpinnerAsync } from '../ui/prompts.js';
import { writeRunState } from '../utils/paths.js';
import { upsertRegistryEntry } from '../utils/registry.js';
import { runPrep, type PrepInput } from '../utils/core-bridge.js';

export async function transcription(ctx: CLIContext): Promise<StageResult> {
  const transcriptDest = path.join(ctx.runDir, 'transcript.txt');

  // If transcript was already reused (cache hit in INPUT_YOUTUBE), skip prep.
  if (ctx.transcriptPath && fs.existsSync(ctx.transcriptPath)) {
    statusNote('Using cached transcript.');
  } else {
    // Build prep input from context
    const prepInput: PrepInput = {
      url: ctx.youtubeUrl,
      audioFile: ctx.inputPath && !ctx.youtubeUrl ? ctx.inputPath : undefined,
      lang: ctx.lang,
      captionsOnly: !!ctx.youtubeUrl,
      outputDir: ctx.runDir,
    };

    if (ctx.youtubeUrl) {
      clack.log.info('Checking captions…');
    } else {
      clack.log.info('Running prep…');
    }

    statusNote('Working on your transcript. This can take a few minutes. Please keep this window open.');

    let prep = await runPrep(prepInput);

    // YouTube fallback: if captions-only failed, offer full ASR
    if (!prep.ok && ctx.youtubeUrl) {
      const wantsAsr = await clack.confirm({
        message: 'No captions found. Use ASR instead? (dev mode only, may consume credits)',
        initialValue: true,
      });
      if (clack.isCancel(wantsAsr) || !wantsAsr) {
        clack.log.error(prep.error ?? 'Prep failed');
        return {
          nextState: 'ERROR',
          context: {
            ...ctx,
            lastError: new Error(prep.error ?? 'Prep failed'),
            currentState: 'ERROR',
            stateHistory: [...ctx.stateHistory, 'TRANSCRIPTION'],
          },
        };
      }
      statusNote('ASR is running. This may take several minutes depending on audio length.');
      prep = await runPrep({ ...prepInput, captionsOnly: false });
    }

    if (!prep.ok) {
      clack.log.error(prep.error ?? 'Prep failed');
      return {
        nextState: 'ERROR',
        context: {
          ...ctx,
          lastError: new Error(prep.error ?? 'Prep failed'),
          currentState: 'ERROR',
          stateHistory: [...ctx.stateHistory, 'TRANSCRIPTION'],
        },
      };
    }

    // Verify transcript exists
    if (!fs.existsSync(transcriptDest)) {
      clack.log.error('Transcript not found in prep output.');
      return {
        nextState: 'ERROR',
        context: {
          ...ctx,
          lastError: new Error('Transcript not found in prep output'),
          currentState: 'ERROR',
          stateHistory: [...ctx.stateHistory, 'TRANSCRIPTION'],
        },
      };
    }

    // Write source metadata
    const sourceType = ctx.youtubeUrl ? 'youtube' : ctx.inputPath ? 'audio' : 'raw';
    fs.writeFileSync(
      path.join(ctx.runDir, 'source.json'),
      JSON.stringify(
        {
          sourceType,
          source: ctx.youtubeUrl ?? ctx.inputPath ?? 'raw-text',
          sourceId: '',
          lang: ctx.lang,
          reused: false,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  // Register transcript in cache
  upsertRegistryEntry(
    ctx.projectName,
    {
      sourceType: ctx.youtubeUrl ? 'youtube' : ctx.inputPath ? 'audio' : 'raw',
      source: ctx.youtubeUrl ?? ctx.inputPath ?? 'raw-text',
      sourceId: '',
      lang: ctx.lang,
    },
    transcriptDest,
  );

  // Update legacy state
  const legacyState = ctx.legacyState
    ? { ...ctx.legacyState, stages: { ...ctx.legacyState.stages, transcribe: 'done' as const }, updatedAt: new Date().toISOString() }
    : undefined;
  if (legacyState) writeRunState(ctx.runDir, legacyState);

  // Resolve auxiliary paths
  const cleanDest = path.join(ctx.runDir, 'clean.txt');
  const summaryDest = path.join(ctx.runDir, 'summary.txt');
  const digestSrc = path.join(ctx.runDir, 'digest.md');
  const promptPath = path.join(ctx.runDir, 'prompt.md');

  return {
    nextState: 'TRANSCRIPT_REVIEW',
    context: {
      ...ctx,
      transcriptPath: transcriptDest,
      cleanedTranscriptPath: fs.existsSync(cleanDest) ? cleanDest : undefined,
      summaryPath: fs.existsSync(digestSrc) ? digestSrc : fs.existsSync(summaryDest) ? summaryDest : undefined,
      researchPromptPath: fs.existsSync(promptPath) ? promptPath : undefined,
      legacyState,
      currentState: 'TRANSCRIPT_REVIEW',
      stateHistory: [...ctx.stateHistory, 'TRANSCRIPTION'],
    },
  };
}
