/**
 * @module stages/input-text
 * INPUT_TEXT — Prompt for text file path OR inline raw text.
 *
 * Extracted from monolith cmdRun() L1007–L1028.
 * Handles both `inputType === 'textfile'` and `inputType === 'raw'`.
 *
 * Input context:
 *   - `inputType` — 'textfile' or 'raw'
 *   - `projectName`, `runDir`
 *
 * Output context:
 *   - `inputPath` — absolute path to text file (textfile) or temp file (raw)
 *   - `rawText`   — original raw text when `inputType === 'raw'`
 *   - `lang`      — selected language
 *
 * Next state: TRANSCRIPTION
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, unwrapCancel } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, getProjectConfigPath } from '../utils/paths.js';
import { isValidTextFile } from '../utils/validation.js';

export async function inputText(ctx: CLIContext): Promise<StageResult> {
  let filePath: string;
  let rawText: string | undefined;

  if (ctx.inputType === 'raw') {
    // Inline text entry
    const text = await clack.text({ message: 'Paste text' });
    const content = String(unwrapCancel(text, 'INPUT_TEXT')).trim();

    if (!content) {
      clack.log.error('No text provided.');
      return {
        nextState: 'INPUT_SELECT',
        context: {
          ...ctx,
          currentState: 'INPUT_SELECT',
          stateHistory: [...ctx.stateHistory, 'INPUT_TEXT'],
        },
      };
    }

    // Write to temp file so downstream stages can treat it as a file
    const tmp = path.join(os.tmpdir(), `abq-raw-${Date.now()}.txt`);
    fs.writeFileSync(tmp, content);
    filePath = tmp;
    rawText = content;
  } else {
    // File path entry
    const filePrompt = await clack.text({ message: 'Path to text file' });
    filePath = path.resolve(String(unwrapCancel(filePrompt, 'INPUT_TEXT')).trim());

    if (!fs.existsSync(filePath)) {
      clack.log.error(`File not found: ${filePath}`);
      return {
        nextState: 'INPUT_SELECT',
        context: {
          ...ctx,
          currentState: 'INPUT_SELECT',
          stateHistory: [...ctx.stateHistory, 'INPUT_TEXT'],
        },
      };
    }

    if (!isValidTextFile(filePath)) {
      clack.log.warn('File does not appear to be a supported text format (.txt/.md/.json).');
    }
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
  const lang = unwrapCancel(langChoice, 'INPUT_TEXT') as string;

  return {
    nextState: 'TRANSCRIPTION',
    context: {
      ...ctx,
      inputPath: filePath,
      youtubeUrl: undefined,
      rawText,
      lang,
      currentState: 'TRANSCRIPTION',
      stateHistory: [...ctx.stateHistory, 'INPUT_TEXT'],
    },
  };
}
