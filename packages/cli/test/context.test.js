import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createInitialContext, validateContextForState } from '../dist/machine/context.js';
import { ALL_STATES } from '../dist/machine/types.js';

// ---------------------------------------------------------------------------
// createInitialContext
// ---------------------------------------------------------------------------

describe('createInitialContext', () => {
  test('produces a context with correct defaults', () => {
    const ctx = createInitialContext({ projectName: 'test-proj' });

    assert.equal(ctx.projectName, 'test-proj');
    assert.equal(ctx.lang, 'es');
    assert.equal(ctx.currentState, 'PROJECT_INIT');
    assert.deepStrictEqual(ctx.stateHistory, ['PROJECT_INIT']);
    assert.ok(ctx.runDir, 'runDir should be set');
    assert.ok(ctx.runId, 'runId should be set');
    assert.ok(ctx.startedAt instanceof Date, 'startedAt should be a Date');
    assert.deepStrictEqual(ctx.outputFiles, []);
    assert.equal(ctx.inputType, undefined);
    assert.equal(ctx.lastError, undefined);
  });

  test('respects lang override', () => {
    const ctx = createInitialContext({ projectName: 'p', lang: 'en' });
    assert.equal(ctx.lang, 'en');
  });

  test('respects initialState override', () => {
    const ctx = createInitialContext({ projectName: 'p', initialState: 'INPUT_SELECT' });
    assert.equal(ctx.currentState, 'INPUT_SELECT');
    assert.deepStrictEqual(ctx.stateHistory, ['INPUT_SELECT']);
  });

  test('creates the run directory on disk', () => {
    const ctx = createInitialContext({ projectName: 'disk-test' });
    assert.ok(fs.existsSync(ctx.runDir), 'runDir should exist on disk');
  });

  test('configPath and credentialsPath are set', () => {
    const ctx = createInitialContext({ projectName: 'paths-test' });
    assert.ok(ctx.configPath.endsWith('config.json'), `configPath: ${ctx.configPath}`);
    assert.ok(ctx.credentialsPath.endsWith('credentials.json'), `credentialsPath: ${ctx.credentialsPath}`);
  });
});

// ---------------------------------------------------------------------------
// validateContextForState
// ---------------------------------------------------------------------------

/** Minimal valid context for validation tests. */
function validCtx(overrides = {}) {
  return {
    projectName: 'v',
    projectDir: '/tmp/v',
    runDir: '/tmp/v/runs/r1',
    runId: 'r1',
    startedAt: new Date(),
    currentState: 'PROJECT_INIT',
    stateHistory: [],
    lang: 'es',
    outputFiles: [],
    configPath: '/tmp/config.json',
    credentialsPath: '/tmp/creds.json',
    ...overrides,
  };
}

describe('validateContextForState — meta fields', () => {
  test('throws if projectName is missing', () => {
    assert.throws(
      () => validateContextForState(validCtx({ projectName: '' }), 'INPUT_SELECT'),
      /projectName/,
    );
  });

  test('throws if runDir is missing', () => {
    assert.throws(
      () => validateContextForState(validCtx({ runDir: '' }), 'INPUT_SELECT'),
      /runDir/,
    );
  });

  test('throws if runId is missing', () => {
    assert.throws(
      () => validateContextForState(validCtx({ runId: '' }), 'INPUT_SELECT'),
      /runId/,
    );
  });
});

describe('validateContextForState — state-specific', () => {
  test('INPUT_YOUTUBE requires inputType and youtubeUrl', () => {
    assert.throws(
      () => validateContextForState(validCtx(), 'INPUT_YOUTUBE'),
      /inputType/,
    );
    assert.throws(
      () => validateContextForState(validCtx({ inputType: 'youtube' }), 'INPUT_YOUTUBE'),
      /youtubeUrl/,
    );
    assert.doesNotThrow(
      () => validateContextForState(
        validCtx({ inputType: 'youtube', youtubeUrl: 'https://youtube.com/watch?v=x' }),
        'INPUT_YOUTUBE',
      ),
    );
  });

  test('TRANSCRIPT_REVIEW requires transcriptPath', () => {
    assert.throws(
      () => validateContextForState(validCtx(), 'TRANSCRIPT_REVIEW'),
      /transcriptPath/,
    );
    assert.doesNotThrow(
      () => validateContextForState(validCtx({ transcriptPath: '/tmp/t.txt' }), 'TRANSCRIPT_REVIEW'),
    );
  });

  test('RESEARCH_EXECUTE requires researchPromptPath', () => {
    assert.throws(
      () => validateContextForState(validCtx(), 'RESEARCH_EXECUTE'),
      /researchPromptPath/,
    );
  });

  test('SCRIPT_GENERATE requires outputType', () => {
    assert.throws(
      () => validateContextForState(validCtx(), 'SCRIPT_GENERATE'),
      /outputType/,
    );
    assert.doesNotThrow(
      () => validateContextForState(validCtx({ outputType: 'podcast' }), 'SCRIPT_GENERATE'),
    );
  });

  test('PROJECT_INIT with valid meta passes (no extra preconditions)', () => {
    assert.doesNotThrow(() => validateContextForState(validCtx(), 'PROJECT_INIT'));
  });
});
