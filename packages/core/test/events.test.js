import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PipelineEmitter } from '../dist/events.js';

describe('PipelineEmitter', () => {
  /** @type {PipelineEmitter} */
  let emitter;

  beforeEach(() => {
    emitter = new PipelineEmitter();
  });

  it('emits and receives stage:start', () => {
    let received;
    emitter.on('stage:start', (e) => { received = e; });
    emitter.emit('stage:start', { stageName: 'test', input: {} });
    assert.ok(received);
    assert.equal(received.stageName, 'test');
  });

  it('emits and receives stage:progress', () => {
    const events = [];
    emitter.on('stage:progress', (e) => events.push(e));
    emitter.emit('stage:progress', { stageName: 's', message: 'a' });
    emitter.emit('stage:progress', { stageName: 's', message: 'b' });
    assert.equal(events.length, 2);
    assert.equal(events[0].message, 'a');
    assert.equal(events[1].message, 'b');
  });

  it('once fires only once', () => {
    let count = 0;
    emitter.once('stage:complete', () => { count++; });
    emitter.emit('stage:complete', { stageName: 's', output: {}, durationMs: 10 });
    emitter.emit('stage:complete', { stageName: 's', output: {}, durationMs: 20 });
    assert.equal(count, 1);
  });

  it('off removes listener', () => {
    let count = 0;
    const handler = () => { count++; };
    emitter.on('pipeline:start', handler);
    emitter.emit('pipeline:start', { runId: 'r1', stageNames: ['s1'] });
    emitter.off('pipeline:start', handler);
    emitter.emit('pipeline:start', { runId: 'r1', stageNames: ['s1'] });
    assert.equal(count, 1);
  });
});
