#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync, spawnSync } from 'node:child_process';
import * as prompts from '@clack/prompts';

function arg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ask(question, fallback = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const v = answer.trim();
      resolve(v || fallback);
    });
  });
}

async function cmdInit() {
  const nonInteractive = hasFlag('--non-interactive');
  const force = hasFlag('--force') || hasFlag('--overwrite');
  const targetDir = arg('--path');
  const baseDir = targetDir ? path.resolve(process.cwd(), targetDir) : process.cwd();
  const configPath = path.resolve(baseDir, '.abq-module.json');

  if (fs.existsSync(configPath) && !force) {
    console.error(`Config already exists: ${configPath}. Use --force to overwrite.`);
    process.exit(1);
  }

  let llmProvider = arg('--llm-provider');
  let llmApiKey = arg('--llm-key');
  let asrProvider = arg('--asr-provider');
  let asrApiKey = arg('--asr-key');
  let lang = arg('--lang', 'es');
  let timezone = arg('--timezone', 'UTC');
  let asrModel = arg('--asr-model', 'whisper-1');

  if (!nonInteractive && process.stdin.isTTY) {
    if (!llmProvider) llmProvider = await ask('LLM provider (openai|openrouter) [openai]: ', 'openai');
    if (!llmApiKey) llmApiKey = await ask('LLM API key (leave blank to skip): ');
    if (!asrProvider) asrProvider = await ask('ASR provider (openai|openrouter) [openai]: ', 'openai');
    if (!asrApiKey) asrApiKey = await ask('ASR API key (leave blank to skip): ');
    if (!lang) lang = await ask('Default language [es]: ', 'es');
    if (!timezone) timezone = await ask('Timezone [UTC]: ', 'UTC');
    if (!asrModel) asrModel = await ask('ASR model [whisper-1]: ', 'whisper-1');
  } else {
    if (!llmProvider && !nonInteractive) llmProvider = 'openai';
  }

  if (nonInteractive && (!llmProvider || !lang || !timezone)) {
    console.error('Missing required fields for non-interactive init. Provide --llm-provider, --lang, --timezone.');
    process.exit(1);
  }

  const config = {
    llmProvider: llmProvider || '',
    llmApiKey: llmApiKey || '',
    asrProvider: asrProvider || llmProvider || '',
    asrApiKey: asrApiKey || '',
    asrModel: asrModel || 'whisper-1',
    lang,
    timezone
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Config written: ${configPath}`);
}

function runCommand(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { stdio: 'pipe', ...opts });
    return { ok: true, output: out.toString() };
  } catch (err) {
    const stderr = String(err?.stderr || err?.message || err);
    return { ok: false, error: stderr };
  }
}

function openInEditor(filePath) {
  const editor = process.env.EDITOR || 'nano';
  const res = spawnSync(editor, [filePath], { stdio: 'inherit' });
  return res.status === 0;
}

function resolveLatestPrepPrompt(cwd) {
  const outDir = path.resolve(cwd, 'output');
  if (!fs.existsSync(outDir)) return null;
  const runs = fs.readdirSync(outDir)
    .filter((d) => d.startsWith('prep-'))
    .map((d) => path.join(outDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!runs.length) return null;
  const prompt = path.join(runs[0], 'deep_research_prompt.md');
  return fs.existsSync(prompt) ? prompt : null;
}

function resolveLatestPublishPrompt(cwd) {
  const outDir = path.resolve(cwd, 'output');
  if (!fs.existsSync(outDir)) return null;
  const runs = fs.readdirSync(outDir)
    .filter((d) => d.startsWith('publish-'))
    .map((d) => path.join(outDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!runs.length) return null;
  const prompt = path.join(runs[0], 'podcast_script.md');
  return fs.existsSync(prompt) ? prompt : null;
}

async function cmdRun() {
  prompts.intro('abq-media');

  const mode = await prompts.select({
    message: 'What do you want to create?',
    options: [
      { value: 'full', label: 'Full package (podcast + article + socials)' },
      { value: 'text', label: 'Article + socials only' },
      { value: 'podcast', label: 'Podcast only' }
    ]
  });
  if (prompts.isCancel(mode)) return prompts.cancel('Aborted.');

  const inputType = await prompts.select({
    message: 'Select input type',
    options: [
      { value: 'youtube', label: 'YouTube URL' },
      { value: 'audio', label: 'Audio file' },
      { value: 'textfile', label: 'Text file' },
      { value: 'raw', label: 'Raw text' }
    ]
  });
  if (prompts.isCancel(inputType)) return prompts.cancel('Aborted.');

  let inputArg = '';
  if (inputType === 'youtube') {
    const url = await prompts.text({ message: 'Paste YouTube URL' });
    if (prompts.isCancel(url) || !url) return prompts.cancel('Aborted.');
    inputArg = `--url "${url}"`;
  } else if (inputType === 'audio') {
    const p = await prompts.text({ message: 'Path to audio file' });
    if (prompts.isCancel(p) || !p) return prompts.cancel('Aborted.');
    inputArg = `--audio-file "${p}"`;
  } else if (inputType === 'textfile') {
    const p = await prompts.text({ message: 'Path to text file' });
    if (prompts.isCancel(p) || !p) return prompts.cancel('Aborted.');
    inputArg = `--text-file "${p}"`;
  } else {
    const t = await prompts.text({ message: 'Paste text' });
    if (prompts.isCancel(t) || !t) return prompts.cancel('Aborted.');
    const tmp = path.join(os.tmpdir(), `abq-raw-${Date.now()}.txt`);
    fs.writeFileSync(tmp, t);
    inputArg = `--text-file "${tmp}"`;
  }

  const lang = await prompts.select({
    message: 'Language',
    options: [
      { value: 'es', label: 'Spanish (es)' },
      { value: 'en', label: 'English (en)' }
    ]
  });
  if (prompts.isCancel(lang)) return prompts.cancel('Aborted.');

  let captions = true;
  let asr = true;
  if (inputType === 'youtube') {
    captions = await prompts.confirm({ message: 'Try captions first?', initialValue: true });
    if (prompts.isCancel(captions)) return prompts.cancel('Aborted.');
    asr = await prompts.confirm({ message: 'If no captions, use ASR?', initialValue: true });
    if (prompts.isCancel(asr)) return prompts.cancel('Aborted.');
  }

  prompts.log.info('Running prep...');
  let prepCmd = `npm run yt:prep -- ${inputArg} --lang ${lang}`.trim();
  if (inputType === 'youtube' && captions && !asr) {
    prepCmd = `${prepCmd} --use-captions`;
  }
  if (inputType === 'youtube' && !captions && asr) {
    prepCmd = `${prepCmd} --use-asr`;
  }
  if (inputType === 'youtube' && !captions && !asr) {
    prompts.log.error('You must choose captions or ASR for YouTube input.');
    return prompts.cancel('Aborted.');
  }

  let prep = runCommand(prepCmd, { cwd: process.cwd() });
  if (!prep.ok && inputType === 'youtube' && captions && asr) {
    const wantsAsr = await prompts.confirm({
      message: 'No captions found. Use ASR instead? (may consume credits)',
      initialValue: true
    });
    if (prompts.isCancel(wantsAsr) || !wantsAsr) {
      prompts.log.error(prep.error || 'Prep failed');
      return prompts.cancel('Aborted.');
    }
    prep = runCommand(`${`npm run yt:prep -- ${inputArg} --lang ${lang}`} --use-asr`, { cwd: process.cwd() });
  }
  if (!prep.ok) {
    prompts.log.error(prep.error || 'Prep failed');
    return prompts.cancel('Aborted.');
  }

  const promptPath = resolveLatestPrepPrompt(process.cwd());
  if (promptPath) {
    const edit = await prompts.confirm({ message: 'Edit the research prompt before publish?', initialValue: false });
    if (prompts.isCancel(edit)) return prompts.cancel('Aborted.');
    if (edit) {
      const ok = openInEditor(promptPath);
      if (!ok) {
        prompts.log.warn('Editor exited with non-zero status.');
      }
    }
  }

  prompts.log.info('Running publish...');
  const publishCmd = `npm run yt:publish -- --latest --lang ${lang}`;
  const pub = runCommand(publishCmd, { cwd: process.cwd() });
  if (!pub.ok) {
    prompts.log.error(pub.error || 'Publish failed');
    return prompts.cancel('Aborted.');
  }

  let renderAudio = false;
  if (mode === 'full' || mode === 'podcast') {
    const r = await prompts.confirm({ message: 'Render podcast audio now?', initialValue: false });
    if (prompts.isCancel(r)) return prompts.cancel('Aborted.');
    renderAudio = r;
  }

  if (renderAudio) {
    prompts.log.info('Rendering TTS...');
    const tts = runCommand('npm run tts:render -- --latest', { cwd: process.cwd() });
    if (!tts.ok) {
      prompts.log.error(tts.error || 'TTS render failed');
      return prompts.cancel('Aborted.');
    }
  }

  const latestPrompt = resolveLatestPrepPrompt(process.cwd());
  const latestPodcast = resolveLatestPublishPrompt(process.cwd());
  prompts.outro(`Done.\\nPrompt: ${latestPrompt || 'n/a'}\\nPodcast script: ${latestPodcast || 'n/a'}`);
}

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'run':
      await cmdRun();
      break;
    default:
      console.log('abq-media commands:');
      console.log('  init [--path <dir>] [--llm-provider openai|openrouter] [--llm-key <key>] [--asr-provider openai|openrouter] [--asr-key <key>] [--asr-model whisper-1] [--lang es] [--timezone UTC] [--force|--overwrite] [--non-interactive]');
      console.log('  run');
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
