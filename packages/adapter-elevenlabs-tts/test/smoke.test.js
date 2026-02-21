import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CLI = path.resolve(import.meta.dirname, '../src/cli.js');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-el-tts-'));

test('doctor returns valid JSON', () => {
  const out = execSync(`node ${CLI} doctor`, { cwd, encoding: 'utf8' });
  const json = JSON.parse(out);
  assert.ok(json.ok !== undefined);
  assert.ok(json.checks);
  assert.ok(Array.isArray(json.hints));
});

test('render without input fails with clear error', () => {
  try {
    execSync(`node ${CLI} render`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected render to fail without input');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /Usage: abq-el-tts render/i);
  }
});

test('render fails when input file is missing', () => {
  try {
    execSync(`node ${CLI} render --input missing.md`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected render to fail for missing input');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /Input file not found/i);
  }
});

test('render --latest fails when no publish runs exist', () => {
  try {
    execSync(`node ${CLI} render --latest`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected render --latest to fail without publish outputs');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /(No publish runs found|No output directory found)/i);
  }
});
