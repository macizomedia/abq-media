/**
 * @module commands/prompts
 * `abq-media prompts` command family.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { clack } from '../ui/prompts.js';

const STAGES = ['research-prompt', 'research', 'script', 'article', 'translate', 'video-script'] as const;

function userPromptsDir(): string {
  return path.join(os.homedir(), '.abq-media', 'prompts');
}

function defaultPromptPath(stage: string): string {
  return path.join(import.meta.dirname, '..', 'prompts', 'defaults', `${stage}.md`);
}

function userPromptPath(stage: string): string {
  return path.join(userPromptsDir(), `${stage}.md`);
}

function stageFromArg(): string {
  return process.argv[4] || '';
}

function subcommand(): string {
  return process.argv[3] || 'list';
}

function ensureUserPrompt(stage: string): string {
  const target = userPromptPath(stage);
  if (fs.existsSync(target)) return target;

  fs.mkdirSync(userPromptsDir(), { recursive: true });
  const source = defaultPromptPath(stage);
  const content = fs.existsSync(source) ? fs.readFileSync(source, 'utf-8') : '';
  fs.writeFileSync(target, content, 'utf-8');
  return target;
}

async function listPrompts(): Promise<void> {
  clack.intro('Prompt Templates');
  for (const stage of STAGES) {
    const isCustom = fs.existsSync(userPromptPath(stage));
    const icon = isCustom ? '✎' : '○';
    const label = isCustom ? '(custom)' : '(default)';
    clack.log.message(`${icon} ${stage} ${label}`);
  }
  clack.outro('Edit: abq-media prompts edit <stage>');
}

async function showPrompt(stage: string): Promise<void> {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    clack.log.error(`Unknown stage: ${stage}`);
    process.exitCode = 1;
    return;
  }

  const custom = userPromptPath(stage);
  const source = fs.existsSync(custom) ? custom : defaultPromptPath(stage);
  const content = fs.readFileSync(source, 'utf-8');
  console.log(content);
}

async function editPrompt(stage: string): Promise<void> {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    clack.log.error(`Unknown stage: ${stage}`);
    process.exitCode = 1;
    return;
  }

  const filepath = ensureUserPrompt(stage);
  const editor = process.env.EDITOR || 'vi';
  const res = spawnSync(editor, [filepath], { stdio: 'inherit' });
  if (res.status !== 0) {
    clack.log.error(`Editor exited with status ${res.status ?? 'unknown'}`);
    process.exitCode = 1;
    return;
  }
  clack.outro(`Prompt saved: ${filepath}`);
}

async function resetPrompt(stage: string): Promise<void> {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    clack.log.error(`Unknown stage: ${stage}`);
    process.exitCode = 1;
    return;
  }

  const target = userPromptPath(stage);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
  }
  clack.outro(`Prompt reset to default: ${stage}`);
}

export async function cmdPrompts(): Promise<void> {
  const sub = subcommand();

  if (sub === 'list') {
    await listPrompts();
    return;
  }

  if (sub === 'show') {
    await showPrompt(stageFromArg());
    return;
  }

  if (sub === 'edit') {
    await editPrompt(stageFromArg());
    return;
  }

  if (sub === 'reset') {
    await resetPrompt(stageFromArg());
    return;
  }

  clack.log.error(`Unknown prompts subcommand: ${sub}`);
  clack.log.info('Use: abq-media prompts [list|show <stage>|edit <stage>|reset <stage>]');
  process.exitCode = 1;
}
