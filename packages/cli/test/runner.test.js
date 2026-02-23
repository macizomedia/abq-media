import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PipelineRunner } from '../dist/machine/runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a minimal CLIContext pointing at tmpDir. */
function makeCtx(overrides = {}) {
  return {
    projectName: 'test',
    projectDir: tmpDir,
    runDir: tmpDir,
    runId: 'r1',
    startedAt: new Date(),
    currentState: 'PROJECT_INIT',
    stateHistory: ['PROJECT_INIT'],
    lang: 'es',
    outputFiles: [],
    configPath: path.join(tmpDir, 'config.json'),
    credentialsPath: path.join(tmpDir, 'creds.json'),
    ...overrides,
  };
}

/**
 * Build a mock registry for a transition-valid path.
 * Each entry is { state, nextState, ctxPatch } so the handler
 * sets the right context fields for the real transition map.
 */
function mockRegistryFromSteps(steps) {
  const registry = {};
  for (const { state, nextState, ctxPatch } of steps) {
    if (state === 'COMPLETE' || state === 'ERROR') continue;
    registry[state] = async (ctx) => ({
      nextState,
      context: {
        ...ctx,
        ...ctxPatch,
        currentState: nextState,
        stateHistory: [...ctx.stateHistory, nextState],
      },
    });
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineRunner — happy path', () => {
  test('runs through a valid 3-state path (text input shortcut)', async () => {
    // PROJECT_INIT → INPUT_SELECT (static) → INPUT_TEXT (dynamic, textfile) → PROCESSING_SELECT (static) → PACKAGE (dynamic, export) → COMPLETE (static)
    const steps = [
      { state: 'PROJECT_INIT', nextState: 'INPUT_SELECT', ctxPatch: {} },
      { state: 'INPUT_SELECT', nextState: 'INPUT_TEXT', ctxPatch: { inputType: 'textfile' } },
      { state: 'INPUT_TEXT', nextState: 'PROCESSING_SELECT', ctxPatch: { inputPath: '/tmp/t.txt' } },
      { state: 'PROCESSING_SELECT', nextState: 'PACKAGE', ctxPatch: { processingType: 'export' } },
      { state: 'PACKAGE', nextState: 'COMPLETE', ctxPatch: {} },
    ];
    const registry = mockRegistryFromSteps(steps);
    const ctx = makeCtx();

    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    const result = await runner.run();
    assert.equal(result.currentState, 'COMPLETE');
  });

  test('runs through a longer valid path (youtube → research → package)', async () => {
    // Covers: youtube input + transcription + research + direct package — no revisited states
    const steps = [
      { state: 'PROJECT_INIT', nextState: 'INPUT_SELECT', ctxPatch: {} },
      { state: 'INPUT_SELECT', nextState: 'INPUT_YOUTUBE', ctxPatch: { inputType: 'youtube' } },
      { state: 'INPUT_YOUTUBE', nextState: 'TRANSCRIPTION', ctxPatch: { youtubeUrl: 'https://youtube.com/watch?v=x' } },
      { state: 'TRANSCRIPTION', nextState: 'TRANSCRIPT_REVIEW', ctxPatch: { transcriptPath: '/tmp/t.txt' } },
      { state: 'TRANSCRIPT_REVIEW', nextState: 'PROCESSING_SELECT', ctxPatch: {} },
      { state: 'PROCESSING_SELECT', nextState: 'RESEARCH_PROMPT_GEN', ctxPatch: { processingType: 'article' } },
      { state: 'RESEARCH_PROMPT_GEN', nextState: 'RESEARCH_EXECUTE', ctxPatch: { researchPromptPath: '/tmp/p.md' } },
      { state: 'RESEARCH_EXECUTE', nextState: 'OUTPUT_SELECT', ctxPatch: {} },
      { state: 'OUTPUT_SELECT', nextState: 'PACKAGE', ctxPatch: { outputType: 'export_zip' } },
      { state: 'PACKAGE', nextState: 'COMPLETE', ctxPatch: {} },
    ];
    const registry = mockRegistryFromSteps(steps);
    const ctx = makeCtx();

    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    const result = await runner.run();
    assert.equal(result.currentState, 'COMPLETE');
    assert.ok(result.stateHistory.includes('TRANSCRIPTION'));
    assert.ok(result.stateHistory.includes('RESEARCH_EXECUTE'));
  });
});

describe('PipelineRunner — error handling', () => {
  test('handler throw → ERROR state', async () => {
    const registry = {
      PROJECT_INIT: async () => { throw new Error('boom'); },
    };
    const ctx = makeCtx();
    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    const result = await runner.run();
    assert.equal(result.currentState, 'ERROR');
    assert.ok(result.lastError);
    assert.match(result.lastError.message, /boom/);
  });

  test('missing handler → ERROR state', async () => {
    const registry = {}; // no handlers at all
    const ctx = makeCtx();
    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    const result = await runner.run();
    assert.equal(result.currentState, 'ERROR');
    assert.ok(result.lastError);
    assert.match(result.lastError.message, /No handler registered/);
  });

  test('max iterations guard triggers', async () => {
    // Loop: PACKAGE → OUTPUT_SELECT → PACKAGE → OUTPUT_SELECT …
    // Both transitions are valid per the real map
    let callCount = 0;
    const registry = {
      // Start at OUTPUT_SELECT, loop with PACKAGE
      OUTPUT_SELECT: async (ctx) => ({
        nextState: 'PACKAGE',
        context: {
          ...ctx,
          outputType: 'export_zip',
          currentState: 'PACKAGE',
          stateHistory: [...ctx.stateHistory, 'PACKAGE'],
        },
      }),
      PACKAGE: async (ctx) => ({
        nextState: 'OUTPUT_SELECT',
        context: {
          ...ctx,
          currentState: 'OUTPUT_SELECT',
          stateHistory: [...ctx.stateHistory, 'OUTPUT_SELECT'],
        },
      }),
    };
    const ctx = makeCtx({ currentState: 'OUTPUT_SELECT', stateHistory: ['OUTPUT_SELECT'] });
    const runner = new PipelineRunner({
      registry,
      context: ctx,
      skipCheckpoints: true,
      maxIterations: 10,
    });

    const result = await runner.run();
    assert.equal(result.currentState, 'ERROR');
    assert.match(result.lastError.message, /max iterations/i);
  });

  test('invalid transition from handler → ERROR state', async () => {
    const registry = {
      PROJECT_INIT: async (ctx) => ({
        nextState: 'COMPLETE', // not allowed from PROJECT_INIT
        context: { ...ctx, currentState: 'COMPLETE' },
      }),
    };
    const ctx = makeCtx();
    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    const result = await runner.run();
    assert.equal(result.currentState, 'ERROR');
    assert.match(result.lastError.message, /Invalid transition/);
  });
});

describe('PipelineRunner — checkpoints', () => {
  test('writes checkpoint files when enabled', async () => {
    const steps = [
      { state: 'PROJECT_INIT', nextState: 'INPUT_SELECT', ctxPatch: {} },
      { state: 'INPUT_SELECT', nextState: 'INPUT_TEXT', ctxPatch: { inputType: 'textfile' } },
      { state: 'INPUT_TEXT', nextState: 'PROCESSING_SELECT', ctxPatch: { inputPath: '/tmp/t.txt' } },
      { state: 'PROCESSING_SELECT', nextState: 'PACKAGE', ctxPatch: { processingType: 'export' } },
      { state: 'PACKAGE', nextState: 'COMPLETE', ctxPatch: {} },
    ];
    const registry = mockRegistryFromSteps(steps);
    const ctx = makeCtx();

    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: false });
    await runner.run();

    const cpDir = path.join(tmpDir, 'checkpoints');
    assert.ok(fs.existsSync(cpDir), 'checkpoints directory should exist');
    const files = fs.readdirSync(cpDir).sort();
    assert.ok(files.length >= 2, `Expected ≥2 checkpoints, got ${files.length}: ${files}`);
    assert.ok(files[0].includes('PROJECT_INIT'), `First checkpoint: ${files[0]}`);

    const data = JSON.parse(fs.readFileSync(path.join(cpDir, files[0]), 'utf8'));
    assert.ok(data.currentState, 'checkpoint should have currentState');
    assert.ok(data.checkpointedAt, 'checkpoint should have checkpointedAt');
    assert.equal(typeof data.checkpointIndex, 'number');
  });

  test('skips checkpoints when disabled', async () => {
    const steps = [
      { state: 'PROJECT_INIT', nextState: 'INPUT_SELECT', ctxPatch: {} },
      { state: 'INPUT_SELECT', nextState: 'INPUT_TEXT', ctxPatch: { inputType: 'textfile' } },
      { state: 'INPUT_TEXT', nextState: 'PROCESSING_SELECT', ctxPatch: { inputPath: '/tmp/t.txt' } },
      { state: 'PROCESSING_SELECT', nextState: 'PACKAGE', ctxPatch: { processingType: 'export' } },
      { state: 'PACKAGE', nextState: 'COMPLETE', ctxPatch: {} },
    ];
    const registry = mockRegistryFromSteps(steps);
    const ctx = makeCtx();
    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    await runner.run();
    const cpDir = path.join(tmpDir, 'checkpoints');
    assert.ok(!fs.existsSync(cpDir), 'checkpoints directory should not exist');
  });
});

describe('PipelineRunner.resume', () => {
  test('resumes from a checkpoint file', async () => {
    const cpDir = path.join(tmpDir, 'checkpoints');
    fs.mkdirSync(cpDir, { recursive: true });
    const cpFile = path.join(cpDir, '001-PROCESSING_SELECT.json');
    const checkpointData = {
      projectName: 'test',
      projectDir: tmpDir,
      runDir: tmpDir,
      runId: 'r1',
      startedAt: new Date().toISOString(),
      currentState: 'PROCESSING_SELECT',
      stateHistory: ['PROJECT_INIT', 'INPUT_SELECT', 'INPUT_TEXT', 'PROCESSING_SELECT'],
      lang: 'es',
      outputFiles: [],
      configPath: path.join(tmpDir, 'config.json'),
      credentialsPath: path.join(tmpDir, 'creds.json'),
      checkpointedAt: new Date().toISOString(),
      checkpointIndex: 3,
    };
    fs.writeFileSync(cpFile, JSON.stringify(checkpointData));

    const registry = mockRegistryFromSteps([
      { state: 'PROCESSING_SELECT', nextState: 'PACKAGE', ctxPatch: { processingType: 'export' } },
      { state: 'PACKAGE', nextState: 'COMPLETE', ctxPatch: {} },
    ]);

    const result = await PipelineRunner.resume(cpFile, registry, { skipCheckpoints: true });
    assert.equal(result.currentState, 'COMPLETE');
  });

  test('throws for missing checkpoint file', async () => {
    await assert.rejects(
      PipelineRunner.resume('/nonexistent.json', {}),
      /Checkpoint not found/,
    );
  });

  test('throws for invalid checkpoint data', async () => {
    const cpFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(cpFile, '{}');
    await assert.rejects(
      PipelineRunner.resume(cpFile, {}),
      /Invalid checkpoint/,
    );
  });
});

describe('PipelineRunner — execution order', () => {
  test('handlers execute in transition order', async () => {
    const order = [];
    const steps = [
      { state: 'PROJECT_INIT', nextState: 'INPUT_SELECT', ctxPatch: {} },
      { state: 'INPUT_SELECT', nextState: 'INPUT_TEXT', ctxPatch: { inputType: 'textfile' } },
      { state: 'INPUT_TEXT', nextState: 'PROCESSING_SELECT', ctxPatch: { inputPath: '/tmp/t.txt' } },
      { state: 'PROCESSING_SELECT', nextState: 'PACKAGE', ctxPatch: { processingType: 'export' } },
      { state: 'PACKAGE', nextState: 'COMPLETE', ctxPatch: {} },
    ];
    const registry = {};
    for (const { state, nextState, ctxPatch } of steps) {
      registry[state] = async (ctx) => {
        order.push(state);
        return {
          nextState,
          context: {
            ...ctx,
            ...ctxPatch,
            currentState: nextState,
            stateHistory: [...ctx.stateHistory, nextState],
          },
        };
      };
    }

    const ctx = makeCtx();
    const runner = new PipelineRunner({ registry, context: ctx, skipCheckpoints: true });
    await runner.run();

    assert.deepStrictEqual(order, [
      'PROJECT_INIT',
      'INPUT_SELECT',
      'INPUT_TEXT',
      'PROCESSING_SELECT',
      'PACKAGE',
    ]);
  });
});
