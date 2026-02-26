import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StageRegistry, withLogging } from '../dist/registry.js';

describe('StageRegistry', () => {
  /** @type {StageRegistry} */
  let reg;

  /** Simple pass-through stage for testing. */
  const echoStage = {
    name: 'echo',
    description: 'returns input as output',
    run: async (input, _ctx) => input,
  };

  const upperStage = {
    name: 'upper',
    description: 'uppercases string',
    run: async (input, _ctx) => String(input).toUpperCase(),
  };

  beforeEach(() => {
    reg = new StageRegistry();
  });

  it('register + get', () => {
    reg.register(echoStage);
    assert.equal(reg.get('echo'), echoStage);
  });

  it('get returns undefined for unknown', () => {
    assert.equal(reg.get('nope'), undefined);
  });

  it('require throws for unknown', () => {
    assert.throws(() => reg.require('nope'), /not found/i);
  });

  it('replace swaps stage', () => {
    reg.register(echoStage);
    const replacement = { ...upperStage, name: 'echo' };
    reg.replace('echo', replacement);
    assert.equal(reg.get('echo'), replacement);
  });

  it('replace throws for unknown name', () => {
    assert.throws(() => reg.replace('nope', echoStage), /not registered/i);
  });

  it('remove deletes stage', () => {
    reg.register(echoStage);
    reg.remove('echo');
    assert.equal(reg.get('echo'), undefined);
  });

  it('names returns registered names', () => {
    reg.register(echoStage);
    reg.register(upperStage);
    const names = reg.names();
    assert.ok(names.includes('echo'));
    assert.ok(names.includes('upper'));
  });

  it('clone produces independent copy', () => {
    reg.register(echoStage);
    const copy = reg.clone();
    copy.register(upperStage);
    assert.equal(reg.get('upper'), undefined);
    assert.ok(copy.get('upper'));
  });

  it('wrap wraps existing stage run', async () => {
    reg.register(echoStage);
    reg.wrap('echo', (original) => ({
      ...original,
      name: original.name,
      run: async (input, ctx) => {
        const result = await original.run(input, ctx);
        return `wrapped:${result}`;
      },
    }));
    const wrapped = reg.get('echo');
    const result = await wrapped.run('hi', /** @type {any} */({}));
    assert.equal(result, 'wrapped:hi');
  });
});

describe('withLogging', () => {
  it('wraps a stage with logging middleware', async () => {
    const original = {
      name: 'test',
      description: 'test stage',
      run: async (input, _ctx) => input + '!',
    };
    const logged = withLogging(original);
    assert.equal(logged.name, 'test');
    const result = await logged.run('hello', /** @type {any} */({
      logger: { info: () => { }, debug: () => { } },
      emitter: { emit: () => { } },
    }));
    assert.equal(result, 'hello!');
  });
});
