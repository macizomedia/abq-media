#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

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

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    default:
      console.log('abq-media commands:');
      console.log('  init [--path <dir>] [--llm-provider openai|openrouter] [--llm-key <key>] [--asr-provider openai|openrouter] [--asr-key <key>] [--asr-model whisper-1] [--lang es] [--timezone UTC] [--force|--overwrite] [--non-interactive]');
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
