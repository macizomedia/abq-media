/**
 * @module commands/init
 * `abq-media init` — Interactive project + credential setup.
 *
 * Supports both interactive (TTY) and non-interactive (--non-interactive)
 * modes. Writes credentials globally and project config per-project.
 *
 * Extracted from monolith cmdInit() L48–L130.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { readJson, writeJson } from '../utils/fs.js';
import { getCredentialsPath, getProjectConfigPath } from '../utils/paths.js';
import { detectEditorCommand } from '../ui/prompts.js';

// ---------------------------------------------------------------------------
// argv helpers
// ---------------------------------------------------------------------------

function arg(flag: string, fallback = ''): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function ask(question: string, fallback = ''): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const v = (answer ?? '').trim();
      resolve(v || fallback);
    });
  });
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function cmdInit(): Promise<void> {
  const nonInteractive = hasFlag('--non-interactive');
  const force = hasFlag('--force') || hasFlag('--overwrite');
  let projectName = arg('--project');

  let llmProvider = arg('--llm-provider');
  let llmApiKey = arg('--llm-key');
  let asrProvider = arg('--asr-provider');
  let asrApiKey = arg('--asr-key');
  let lang = arg('--lang', 'es');
  let timezone = arg('--timezone', 'UTC');
  let asrModel = arg('--asr-model', 'whisper-1');
  let handle = arg('--handle');
  let cta = arg('--cta');
  let tone = arg('--tone', 'informative');
  let editorCommand = arg('--editor');
  let elevenLabsApiKey = arg('--elevenlabs-key');
  let ytdlpCookies = arg('--ytdlp-cookies');
  let ytdlpCookiesFromBrowser = arg('--ytdlp-cookies-from-browser');
  let ytdlpJsRuntimes = arg('--ytdlp-js-runtimes');

  if (!nonInteractive && process.stdin.isTTY) {
    if (!projectName) projectName = await ask(`Project name [${path.basename(process.cwd())}]: `, path.basename(process.cwd()));
    if (!llmProvider) llmProvider = await ask('LLM provider (openai|openrouter) [openai]: ', 'openai');
    if (!llmApiKey) llmApiKey = await ask('LLM API key (leave blank to skip): ');
    if (!asrProvider) asrProvider = await ask('ASR provider (openai|openrouter) [openai]: ', 'openai');
    if (!asrApiKey) asrApiKey = await ask('ASR API key (leave blank to skip): ');
    if (!elevenLabsApiKey) elevenLabsApiKey = await ask('ElevenLabs API key (leave blank to skip): ');
    if (!lang) lang = await ask('Default language [es]: ', 'es');
    if (!timezone) timezone = await ask('Timezone [UTC]: ', 'UTC');
    if (!asrModel) asrModel = await ask('ASR model [whisper-1]: ', 'whisper-1');
    if (!handle) handle = await ask('Publishing handle (e.g. @you): ', '');
    if (!cta) cta = await ask('CTA (one sentence): ', '');
    if (!tone) tone = await ask('Tone preset [informative]: ', 'informative');
    if (!editorCommand) editorCommand = await ask('Preferred editor command (e.g. "code --wait") [auto]: ', '');
    if (!ytdlpCookies) ytdlpCookies = await ask('yt-dlp cookies file (optional): ', '');
    if (!ytdlpCookiesFromBrowser) ytdlpCookiesFromBrowser = await ask('yt-dlp cookies from browser (optional, e.g. "chrome"): ', '');
    if (!ytdlpJsRuntimes) ytdlpJsRuntimes = await ask('yt-dlp js runtimes (optional, e.g. "bun:/path/to/bun"): ', '');
  } else {
    if (!llmProvider && !nonInteractive) llmProvider = 'openai';
  }

  if (!projectName) projectName = path.basename(process.cwd());

  const projectConfigPath = getProjectConfigPath(projectName);
  if (fs.existsSync(projectConfigPath) && !force) {
    if (nonInteractive) {
      console.error(`Project config exists: ${projectConfigPath}. Use --overwrite to update.`);
      process.exit(1);
    }
    const update = await ask('Project config exists. Update it? [y/N]: ', 'n');
    if (!/^y/i.test(update)) process.exit(0);
  }

  if (nonInteractive && (!llmProvider || !lang || !timezone)) {
    console.error('Missing required fields for non-interactive init. Provide --llm-provider, --lang, --timezone.');
    process.exit(1);
  }

  const existingCreds = readJson<Record<string, string>>(getCredentialsPath()) ?? {};
  const detectedEditor = editorCommand || existingCreds.editorCommand || detectEditorCommand() || '';

  // Auto-detect ASR provider from key prefix when not explicitly set
  const resolvedAsrKey = asrApiKey || existingCreds.asrApiKey || '';
  let resolvedAsrProvider = asrProvider || existingCreds.asrProvider || '';
  if (!resolvedAsrProvider && resolvedAsrKey) {
    resolvedAsrProvider = resolvedAsrKey.startsWith('sk-or-') ? 'openrouter' : 'openai';
  }
  if (!resolvedAsrProvider) resolvedAsrProvider = llmProvider || '';

  const credentials = {
    llmProvider: llmProvider || existingCreds.llmProvider || '',
    llmApiKey: llmApiKey || existingCreds.llmApiKey || '',
    asrProvider: resolvedAsrProvider,
    asrApiKey: resolvedAsrKey,
    asrModel: asrModel || existingCreds.asrModel || 'whisper-1',
    elevenLabsApiKey: elevenLabsApiKey || existingCreds.elevenLabsApiKey || '',
    editorCommand: detectedEditor,
    ytdlpCookies: ytdlpCookies || existingCreds.ytdlpCookies || '',
    ytdlpCookiesFromBrowser: ytdlpCookiesFromBrowser || existingCreds.ytdlpCookiesFromBrowser || '',
    ytdlpJsRuntimes: ytdlpJsRuntimes || existingCreds.ytdlpJsRuntimes || '',
    lang,
    timezone,
    updatedAt: new Date().toISOString(),
  };

  const projectConfig = {
    projectName,
    handle: handle || '',
    cta: cta || '',
    tone: tone || 'informative',
    defaultLanguage: lang,
    defaultOutputs: ['full'],
    updatedAt: new Date().toISOString(),
  };

  writeJson(getCredentialsPath(), credentials);
  writeJson(projectConfigPath, projectConfig);
  console.log(`Credentials written: ${getCredentialsPath()}`);
  console.log(`Project config written: ${projectConfigPath}`);
}
