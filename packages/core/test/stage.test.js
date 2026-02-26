import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FallbackStage, ParallelStage } from '../dist/stage.js';
import { PipelineEmitter } from '../dist/events.js';
import { ConsoleLogger } from '../dist/context.js';

/**
 * Minimal context for testing.
 */
function fakeCtx() {
  return /** @type {any} */ ({
    config: {},
    emitter: new PipelineEmitter(),
    runId: 'test-run',
    outputDir: '/tmp/test',
    logger: new ConsoleLogger(false),
    artifacts: new Map(),
    metadata: {},
  });
}

describe('FallbackStage', () => {
  it('returns result from first successful alternative', async () => {
    const stage = new FallbackStage({
      name: 'fb',
      description: 'test fallback',
      alternatives: [
        {
          name: 'ok',
          description: 'succeeds',
          run: async () => 'ok-result',
        },
        {
          name: 'never',
          description: 'should not run',
          run: async () => { throw new Error('should not reach'); },
        },
      ],
    });
    const result = await stage.run('input', fakeCtx());
    assert.equal(result, 'ok-result');
  });

  it('falls through to next on failure', async () => {
    const stage = new FallbackStage({
      name: 'fb',
      description: 'test',
      alternatives: [
        {
          name: 'fail1',
          description: 'always fails',
          run: async () => { throw new Error('fail1'); },
        },
        {
          name: 'ok2',
          description: 'succeeds',
          run: async () => 'fallback-result',
        },
      ],
    });
    const result = await stage.run('input', fakeCtx());
    assert.equal(result, 'fallback-result');
  });

  it('throws if all alternatives fail', async () => {
    const stage = new FallbackStage({
      name: 'fb',
      description: 'all fail',
      alternatives: [
        { name: 'f1', description: '', run: async () => { throw new Error('a'); } },
        { name: 'f2', description: '', run: async () => { throw new Error('b'); } },
      ],
    });
    await assert.rejects(() => stage.run('x', fakeCtx()), /all.*failed/i);
  });
});

describe('ParallelStage', () => {
  it('runs stages concurrently and returns map', async () => {
    const stage = new ParallelStage({
      name: 'par',
      description: 'test parallel',
      stages: [
        { name: 'a', description: '', run: async (input) => `${input}-A` },
        { name: 'b', description: '', run: async (input) => `${input}-B` },
      ],
    });
    const result = await stage.run('in', fakeCtx());
    // ParallelStage returns a Map<string, { ok, value } | { ok, error }>
    assert.equal(result.get('a').value, 'in-A');
    assert.equal(result.get('b').value, 'in-B');
    assert.equal(result.get('a').ok, true);
  });

  it('collects errors when failFast is false', async () => {
    const stage = new ParallelStage({
      name: 'par',
      description: 'test',
      stages: [
        { name: 'ok', description: '', run: async () => 'fine' },
        { name: 'bad', description: '', run: async () => { throw new Error('oops'); } },
      ],
      failFast: false,
    });
    const result = await stage.run('x', fakeCtx());
    assert.equal(result.get('ok').ok, true);
    assert.equal(result.get('ok').value, 'fine');
    assert.equal(result.get('bad').ok, false);
    assert.equal(result.get('bad').error.message, 'oops');
  });
});
