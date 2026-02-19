#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  const llmProvider = (await ask('LLM provider (openai|openrouter|openrouter-agent): ')).trim();
  const llmApiKey = (await ask('LLM API key (optional for openrouter-agent): ')).trim();
  const model = (await ask('Model (default gpt-4o-mini or openrouter/auto): ')).trim();

  let baseUrl = '';
  let agentEndpoint = '';
  if (llmProvider === 'openai') {
    baseUrl = (await ask('OpenAI-compatible base URL (default https://api.openai.com/v1): ')).trim();
  }
  if (llmProvider === 'openrouter-agent') {
    agentEndpoint = (await ask('Agent endpoint (example http://127.0.0.1:8787/infer): ')).trim();
  }

  const asrProvider = (await ask('ASR provider (optional: openai|openrouter): ')).trim();
  const asrApiKey = (await ask('ASR API key (optional): ')).trim();
  const asrModel = (await ask('ASR model (optional, e.g. gpt-4o-mini-transcribe): ')).trim();
  const asrBaseUrl = (await ask('ASR base URL (optional): ')).trim();

  const projectName = (await ask('Project name: ')).trim();
  const description = (await ask('Description: ')).trim();
  const owner = (await ask('Owner (default: abquanta): ')).trim() || 'abquanta';
  const tags = (await ask('Tags (comma-separated): ')).trim();

  rl.close();

  const config = {
    llmProvider,
    llmApiKey,
    model: model || undefined,
    baseUrl: baseUrl || undefined,
    agentEndpoint: agentEndpoint || undefined,
    asrProvider: asrProvider || undefined,
    asrApiKey: asrApiKey || undefined,
    asrModel: asrModel || undefined,
    asrBaseUrl: asrBaseUrl || undefined,
    projectName,
    description,
    owner,
    tags: tags ? tags.split(',').map((x) => x.trim()).filter(Boolean) : []
  };

  const outPath = path.resolve(process.cwd(), '.abq-module.json');
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));

  console.log(`Saved module config: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
