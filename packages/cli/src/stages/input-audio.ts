/**
 * @module stages/input-audio
 * INPUT_AUDIO — Prompt for audio file path, validate existence.
 *
 * Extracted from monolith cmdRun() L1003–L1006.
 *
 * Input context:
 *   - `inputType === 'audio'`
 *   - `projectName`, `runDir`
 *
 * Output context:
 *   - `inputPath` — absolute path to the audio file
 *   - `lang`      — selected language
 *
 * Next state: TRANSCRIPTION
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, unwrapCancel } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, getProjectConfigPath } from '../utils/paths.js';
import { isValidAudioFile } from '../utils/validation.js';

export async function inputAudio(ctx: CLIContext): Promise<StageResult> {
  const filePrompt = await clack.text({ message: 'Path to audio file' });
  const filePath = String(unwrapCancel(filePrompt, 'INPUT_AUDIO')).trim();

  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    clack.log.error(`File not found: ${resolved}`);
    return {
      nextState: 'INPUT_SELECT',
      context: {
        ...ctx,
        currentState: 'INPUT_SELECT',
        stateHistory: [...ctx.stateHistory, 'INPUT_AUDIO'],
      },
    };
  }

  if (!isValidAudioFile(resolved)) {
    clack.log.warn('File does not appear to be a supported audio format (.wav/.mp3/.m4a/.ogg/.flac).');
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
  const lang = unwrapCancel(langChoice, 'INPUT_AUDIO') as string;

  return {
    nextState: 'TRANSCRIPTION',
    context: {
      ...ctx,
      inputPath: resolved,
      youtubeUrl: undefined,
      rawText: undefined,
      lang,
      currentState: 'TRANSCRIPTION',
      stateHistory: [...ctx.stateHistory, 'INPUT_AUDIO'],
    },
  };
}
