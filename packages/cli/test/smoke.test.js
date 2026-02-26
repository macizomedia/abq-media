import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const CLI = path.resolve(import.meta.dirname, '../dist/cli.js');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-cli-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-home-'));
const baseEnv = { ...process.env, HOME: home };

function writeSetupConfig() {
  const configDir = path.join(home, '.abq-media');
  fs.mkdirSync(configDir, { recursive: true });
  const projectsRoot = path.join(home, '.abq-media', 'projects');
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'credentials.json'), JSON.stringify({
    version: 1,
    api: {
      llm: { provider: 'openrouter', apiKey: 'sk-or-test-placeholder', model: 'anthropic/claude-sonnet-4-20250514' },
      tts: { provider: 'elevenlabs', apiKey: 'test-elevenlabs-key' },
    },
    defaults: {
      language: 'es',
      recipe: 'default',
      outputDir: projectsRoot,
      voice: 'Antoni',
      humanizer: 'abquanta',
    },
    organization: { name: 'TestOrg', handles: {} },
  }, null, 2));
}

test('new command surface exists', () => {
  const out = execSync(`node ${CLI}`, { cwd, encoding: 'utf8' });
  assert.match(out, /transform/);
  assert.match(out, /setup/);
  assert.match(out, /recipes/);
  assert.match(out, /projects/);
  assert.match(out, /prompts/);
});

test('doctor command returns JSON payload', () => {
  const out = execSync(`node ${CLI} doctor`, { cwd, encoding: 'utf8', env: baseEnv });
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.ok, 'boolean');
  assert.equal(typeof parsed.checks, 'object');
});

test('transform dry-run creates planned project and projects filter lists it', () => {
  writeSetupConfig();

  const inputFile = path.join(cwd, 'input.txt');
  fs.writeFileSync(inputFile, 'Sample transcript content for dry run test.', 'utf8');

  execSync(`node ${CLI} transform ${inputFile} --into transcript --dry-run --name demo-project`, {
    cwd,
    encoding: 'utf8',
    env: baseEnv,
  });

  const projectDir = path.join(home, '.abq-media', 'projects', 'demo-project');
  assert.ok(fs.existsSync(projectDir));

  const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'planned');

  const out = execSync(`node ${CLI} projects --status planned`, {
    cwd,
    encoding: 'utf8',
    env: baseEnv,
  });
  assert.match(out, /demo-project/);
});

test('projects continue without id falls back to latest failed project', () => {
  writeSetupConfig();

  const projectsRoot = path.join(home, '.abq-media', 'projects');
  const olderDir = path.join(projectsRoot, 'failed-older');
  const latestDir = path.join(projectsRoot, 'failed-latest');
  fs.mkdirSync(olderDir, { recursive: true });
  fs.mkdirSync(latestDir, { recursive: true });

  fs.writeFileSync(path.join(olderDir, 'manifest.json'), JSON.stringify({
    id: 'failed-older',
    name: 'failed-older',
    createdAt: '2026-02-20T10:00:00.000Z',
    updatedAt: '2026-02-20T10:00:00.000Z',
    targetFormat: 'transcript',
    status: 'failed',
  }, null, 2));

  fs.writeFileSync(path.join(latestDir, 'manifest.json'), JSON.stringify({
    id: 'failed-latest',
    name: 'failed-latest',
    createdAt: '2026-02-22T10:00:00.000Z',
    updatedAt: '2026-02-22T10:00:00.000Z',
    targetFormat: 'transcript',
    status: 'failed',
  }, null, 2));

  const result = spawnSync('node', [CLI, 'projects', 'continue'], {
    cwd,
    env: baseEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /failed-latest/);
  assert.match(result.stdout + result.stderr, /No checkpoint found/);
});

test('projects rerun replays transform using project metadata', () => {
  writeSetupConfig();

  const sourceFile = path.join(cwd, 'rerun-input.txt');
  fs.writeFileSync(sourceFile, 'rerun content', 'utf8');

  const projectDir = path.join(home, '.abq-media', 'projects', 'rerun-project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'manifest.json'), JSON.stringify({
    id: 'rerun-project',
    name: 'rerun-project',
    createdAt: '2026-02-23T10:00:00.000Z',
    targetFormat: 'transcript',
    recipe: 'default',
    status: 'failed',
  }, null, 2));
  fs.writeFileSync(path.join(projectDir, 'source.json'), JSON.stringify({ source: sourceFile }, null, 2));

  const result = spawnSync('node', [CLI, 'projects', 'rerun', 'rerun-project', '--dry-run'], {
    cwd,
    env: baseEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout + result.stderr, /Re-run completed for project: rerun-project/);
});

test('projects delete removes project directory with --yes', () => {
  writeSetupConfig();

  const projectDir = path.join(home, '.abq-media', 'projects', 'delete-project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'manifest.json'), JSON.stringify({
    id: 'delete-project',
    name: 'delete-project',
    createdAt: '2026-02-23T10:00:00.000Z',
    targetFormat: 'transcript',
    status: 'planned',
  }, null, 2));

  const result = spawnSync('node', [CLI, 'projects', 'delete', 'delete-project', '--yes'], {
    cwd,
    env: baseEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout + result.stderr, /Deleted project: delete-project/);
  assert.equal(fs.existsSync(projectDir), false);
});
