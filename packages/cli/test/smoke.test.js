import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CLI = path.resolve(import.meta.dirname, '../src/cli.js');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-cli-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-home-'));
const baseEnv = { ...process.env, HOME: home };

test('init writes global credentials and project config in non-interactive mode', () => {
  execSync(`node ${CLI} init --project demo --non-interactive --llm-provider openai --llm-key test-key --asr-provider openai --asr-key asr-key --lang en --timezone UTC`, { cwd, encoding: 'utf8', env: baseEnv });
  const credsPath = path.join(home, '.abq-media', 'credentials.json');
  const projPath = path.join(home, '.abq-media', 'projects', 'demo', 'config.json');
  assert.ok(fs.existsSync(credsPath));
  assert.ok(fs.existsSync(projPath));
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  assert.equal(creds.llmProvider, 'openai');
  assert.equal(creds.llmApiKey, 'test-key');
  assert.equal(creds.asrProvider, 'openai');
  assert.equal(creds.asrApiKey, 'asr-key');
  assert.equal(creds.lang, 'en');
  assert.equal(creds.timezone, 'UTC');
});

test('run command exists', () => {
  const out = execSync(`node ${CLI}`, { cwd, encoding: 'utf8' });
  assert.match(out, /run/);
});

test('run --debugger creates sample outputs', () => {
  const out = execSync(`node ${CLI} run --debugger`, { cwd, encoding: 'utf8', env: baseEnv });
  assert.match(out, /Debugger mode/);
});
