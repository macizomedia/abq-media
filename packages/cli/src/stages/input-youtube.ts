/**
 * @module stages/input-youtube
 * INPUT_YOUTUBE — Prompt for YouTube URL, validate, check transcript reuse.
 *
 * Extracted from monolith cmdRun() L997–L1040.
 *
 * Input context:
 *   - `inputType === 'youtube'`
 *   - `projectName`, `runDir`, `lang`
 *
 * Output context:
 *   - `youtubeUrl` — validated URL
 *   - `inputPath`  — undefined (not a local file)
 *
 * Next state: TRANSCRIPTION
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, unwrapCancel, statusNote } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, getProjectConfigPath } from '../utils/paths.js';
import { getYouTubeId, isValidYouTubeUrl } from '../utils/validation.js';
import { findRegistryEntry } from '../utils/registry.js';

export async function inputYoutube(ctx: CLIContext): Promise<StageResult> {
  // Prompt for URL
  const url = await clack.text({ message: 'Paste YouTube URL' });
  const urlStr = String(unwrapCancel(url, 'INPUT_YOUTUBE')).trim();

  if (!isValidYouTubeUrl(urlStr)) {
    clack.log.error('Invalid YouTube URL.');
    return {
      nextState: 'INPUT_SELECT',
      context: {
        ...ctx,
        currentState: 'INPUT_SELECT',
        stateHistory: [...ctx.stateHistory, 'INPUT_YOUTUBE'],
      },
    };
  }

  // Language selection
  const projectConfig = readJson<Record<string, unknown>>(getProjectConfigPath(ctx.projectName)) ?? {};
  const credentials = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
  const defaultLang = (projectConfig.defaultLanguage ?? credentials.lang ?? 'es') as string;

  const langChoice = await clack.select({
    message: 'Language',
    options: [
      { value: 'es', label: 'Spanish (es)' },
      { value: 'en', label: 'English (en)' },
    ],
    initialValue: defaultLang,
  });
  const lang = unwrapCancel(langChoice, 'INPUT_YOUTUBE') as string;

  // Check for existing transcript (reuse)
  const videoId = getYouTubeId(urlStr) ?? '';
  const sourceInfo = { sourceType: 'youtube' as const, source: urlStr, sourceId: videoId, lang };

  let reusedTranscript: string | undefined;
  const existing = findRegistryEntry(ctx.projectName, sourceInfo);
  if (existing && fs.existsSync(existing.transcriptPath)) {
    const reuseChoice = await clack.confirm({
      message: 'Transcript already exists for this video. Reuse it?',
      initialValue: true,
    });
    if (!clack.isCancel(reuseChoice) && reuseChoice) {
      const dest = path.join(ctx.runDir, 'transcript.txt');
      fs.copyFileSync(existing.transcriptPath, dest);

      // Write source metadata
      fs.writeFileSync(
        path.join(ctx.runDir, 'source.json'),
        JSON.stringify({ ...sourceInfo, reused: true, createdAt: new Date().toISOString() }, null, 2),
      );

      reusedTranscript = dest;
      statusNote('Reusing cached transcript.');
    }
  }

  return {
    nextState: 'TRANSCRIPTION',
    context: {
      ...ctx,
      youtubeUrl: urlStr,
      inputPath: undefined,
      rawText: undefined,
      lang,
      transcriptPath: reusedTranscript,
      currentState: 'TRANSCRIPTION',
      stateHistory: [...ctx.stateHistory, 'INPUT_YOUTUBE'],
    },
  };
}
