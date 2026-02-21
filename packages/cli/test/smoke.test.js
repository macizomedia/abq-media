import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CLI = path.resolve(import.meta.dirname, '../src/cli.js');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-cli-'));

test('init writes .abq-module.json in non-interactive mode', () => {
  execSync(`node ${CLI} init --non-interactive --llm-provider openai --llm-key test-key --asr-provider openai --asr-key asr-key --lang en --timezone UTC`, { cwd, encoding: 'utf8' });
  const configPath = path.join(cwd, '.abq-module.json');
  assert.ok(fs.existsSync(configPath));
  const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(json.llmProvider, 'openai');
  assert.equal(json.llmApiKey, 'test-key');
  assert.equal(json.asrProvider, 'openai');
  assert.equal(json.asrApiKey, 'asr-key');
  assert.equal(json.lang, 'en');
  assert.equal(json.timezone, 'UTC');
});
