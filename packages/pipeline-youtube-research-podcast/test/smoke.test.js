import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CLI = path.resolve(import.meta.dirname, '../src/cli.js');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-smoke-'));

test('doctor returns valid JSON', () => {
  const out = execSync(`node ${CLI} doctor`, { cwd, encoding: 'utf8' });
  const json = JSON.parse(out);
  assert.ok(json.ok !== undefined);
});

test('prep with --text creates output artifacts', () => {
  const text = 'Este es un texto de prueba con suficiente contenido para pasar la verificación de longitud mínima. El video habla sobre geopolítica, minerales raros, y la transición venezolana hacia la democracia.';
  execSync(`node ${CLI} prep --text "${text}"`, { cwd, encoding: 'utf8' });
  const outDir = path.join(cwd, 'output');
  const runs = fs.readdirSync(outDir).filter(d => d.startsWith('prep-'));
  assert.ok(runs.length > 0, 'Should have prep output dir');
  const run = path.join(outDir, runs[0]);
  assert.ok(fs.existsSync(path.join(run, 'metadata.json')));
  assert.ok(fs.existsSync(path.join(run, 'digest.md')));
  assert.ok(fs.existsSync(path.join(run, 'deep_research_prompt.md')));
});

test('prep with --transcript-file creates output artifacts', () => {
  const tmpTxt = path.join(cwd, 'test-transcript.txt');
  fs.writeFileSync(tmpTxt, 'Transcript content about Venezuela mineral policy and geopolitical transitions in Latin America. The rare earth minerals sector is experiencing significant shifts as the United States and China compete for access to lithium and coltan deposits in the region.');
  execSync(`node ${CLI} prep --transcript-file test-transcript.txt`, { cwd, encoding: 'utf8' });
  const outDir = path.join(cwd, 'output');
  const runs = fs.readdirSync(outDir).filter(d => d.startsWith('prep-'));
  assert.ok(runs.length > 0);
});

test('latest returns a path after prep runs', () => {
  const out = execSync(`node ${CLI} latest`, { cwd, encoding: 'utf8' }).trim();
  assert.ok(out.length > 0, 'Should return a path');
  assert.ok(fs.existsSync(out), 'Returned path should exist');
});

test('prep fails when audio file is missing', () => {
  try {
    execSync(`node ${CLI} prep --audio-file missing.mp3`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected prep to fail for missing audio file');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /Audio file not found/i);
  }
});

test('prep with --use-asr fails without ASR config', () => {
  const url = 'https://youtu.be/dQw4w9WgXcQ';
  try {
    execSync(`node ${CLI} prep --url ${url} --use-asr true`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected prep to fail when ASR is not configured');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /ASR not configured/i);
  }
});
