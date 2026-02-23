import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Pipeline, definePipeline } from '../dist/pipeline.js';
import { PipelineConfigSchema } from '../dist/config.js';

/**
 * Pipeline creates output dirs in cwd — use a temp dir to avoid clutter.
 */
function tmpOutputDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'core-test-'));
}

describe('Pipeline', () => {
  it('runs stages sequentially and stores artifacts', async () => {
    const outDir = tmpOutputDir();
    const pipeline = new Pipeline({
      name: 'test-pipe',
      stages: [
        {
          name: 's1',
          description: 'add-a',
          run: async (input, ctx) => {
            ctx.artifacts.set('step1', input + '-a');
            return input + '-a';
          },
        },
        {
          name: 's2',
          description: 'add-b',
          run: async (input, ctx) => {
            ctx.artifacts.set('step2', input + '-b');
            return input + '-b';
          },
        },
      ],
      outputDir: outDir,
    });
    const result = await pipeline.run('start');
    assert.equal(result.completedStages.length, 2);
    assert.ok(result.durationMs >= 0);
    assert.equal(result.artifacts.get('step1'), 'start-a');
    assert.equal(result.artifacts.get('step2'), 'start-a-b');
    // Cleanup
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('skips stages with falsy canRun guard', async () => {
    const outDir = tmpOutputDir();
    const pipeline = new Pipeline({
      name: 'test-guard',
      stages: [
        {
          name: 'skipped',
          description: 'will be skipped',
          run: async () => 'nope',
          canRun: () => false,
        },
        {
          name: 'kept',
          description: 'stays',
          run: async (input, ctx) => {
            ctx.artifacts.set('out', input + '-kept');
            return input + '-kept';
          },
        },
      ],
      outputDir: outDir,
    });
    const result = await pipeline.run('in');
    assert.equal(result.completedStages.length, 1);
    assert.equal(result.completedStages[0], 'kept');
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('emits pipeline events in order', async () => {
    const outDir = tmpOutputDir();
    const events = [];
    const pipeline = new Pipeline({
      name: 'evt-test',
      stages: [
        { name: 's1', description: '', run: async (input) => input },
      ],
      outputDir: outDir,
    });
    pipeline.on('pipeline:start', () => events.push('start'));
    pipeline.on('stage:start', (e) => events.push(`s:${e.stageName}`));
    pipeline.on('stage:complete', (e) => events.push(`c:${e.stageName}`));
    pipeline.on('pipeline:complete', () => events.push('done'));
    await pipeline.run('x');
    assert.deepEqual(events, ['start', 's:s1', 'c:s1', 'done']);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('aborts on signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const pipeline = new Pipeline({
      name: 'abort-test',
      signal: ac.signal,
      stages: [
        { name: 's1', description: '', run: async (input) => input },
      ],
    });
    await assert.rejects(() => pipeline.run('x'), /abort/i);
  });
});

describe('definePipeline', () => {
  it('is a factory for Pipeline', async () => {
    const outDir = tmpOutputDir();
    const pipeline = definePipeline({
      name: 'factory',
      stages: [
        {
          name: 'echo',
          description: '',
          run: async (i, ctx) => { ctx.artifacts.set('echo', i); return i; },
        },
      ],
      outputDir: outDir,
    });
    assert.ok(pipeline instanceof Pipeline);
    const r = await pipeline.run('test');
    assert.equal(r.artifacts.get('echo'), 'test');
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
