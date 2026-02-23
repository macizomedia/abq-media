import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PipelineConfigSchema,
  loadConfig,
} from '../dist/config.js';

describe('PipelineConfigSchema', () => {
  it('parses empty object with all defaults', () => {
    const config = PipelineConfigSchema.parse({});
    assert.equal(config.lang, 'es');
    assert.equal(config.debug, false);
    assert.equal(config.llm.provider, 'openrouter');
    assert.equal(config.asr.provider, 'openai');
    assert.equal(config.tts.provider, 'elevenlabs');
    assert.equal(config.output.baseDir, 'output');
  });

  it('accepts partial overrides', () => {
    const config = PipelineConfigSchema.parse({
      lang: 'en',
      llm: { apiKey: 'sk-test', model: 'gpt-4o' },
    });
    assert.equal(config.lang, 'en');
    assert.equal(config.llm.apiKey, 'sk-test');
    assert.equal(config.llm.model, 'gpt-4o');
    // defaults still applied
    assert.equal(config.llm.temperature, 0.2);
  });

  it('rejects invalid provider', () => {
    assert.throws(
      () => PipelineConfigSchema.parse({ llm: { provider: 'invalid' } }),
    );
  });

  it('rejects invalid temperature type', () => {
    assert.throws(
      () => PipelineConfigSchema.parse({ llm: { temperature: 'hot' } }),
    );
  });
});

describe('loadConfig', () => {
  it('returns a valid config with no files present', () => {
    const config = loadConfig({}, '/tmp/nonexistent-dir');
    assert.equal(config.lang, 'es');
    assert.ok(config.llm);
    assert.ok(config.tts);
  });

  it('applies overrides', () => {
    const config = loadConfig({ lang: 'en', debug: true });
    assert.equal(config.lang, 'en');
    assert.equal(config.debug, true);
  });
});
