import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  TRANSITIONS,
  getNextState,
  assertValidTransition,
} from '../dist/machine/transitions.js';
import { ALL_STATES, TERMINAL_STATES } from '../dist/machine/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal context factory for transition testing. */
function ctx(overrides = {}) {
  return {
    projectName: 'test',
    projectDir: '/tmp/test',
    runDir: '/tmp/test/runs/r1',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transition map completeness', () => {
  test('every state in ALL_STATES has a transition entry', () => {
    for (const state of ALL_STATES) {
      assert.ok(
        state in TRANSITIONS,
        `Missing transition entry for state '${state}'`,
      );
    }
  });

  test('terminal states map to empty arrays', () => {
    for (const state of TERMINAL_STATES) {
      const rule = TRANSITIONS[state];
      assert.ok(Array.isArray(rule), `Terminal state '${state}' should be an array`);
      assert.equal(rule.length, 0, `Terminal state '${state}' should have no targets`);
    }
  });

  test('no orphan states — every target is a valid state', () => {
    for (const [from, rule] of Object.entries(TRANSITIONS)) {
      if (typeof rule === 'function') continue; // dynamic — tested below
      for (const to of rule) {
        assert.ok(
          ALL_STATES.includes(to),
          `State '${from}' transitions to unknown state '${to}'`,
        );
      }
    }
  });
});

describe('Static transitions', () => {
  const staticCases = [
    ['PROJECT_INIT', 'INPUT_SELECT'],
    ['INPUT_YOUTUBE', 'TRANSCRIPTION'],
    ['INPUT_AUDIO', 'TRANSCRIPTION'],
    ['INPUT_TEXT', 'PROCESSING_SELECT'],
    ['TRANSCRIPTION', 'TRANSCRIPT_REVIEW'],
    ['TRANSCRIPT_REVIEW', 'PROCESSING_SELECT'],
    ['RESEARCH_EXECUTE', 'OUTPUT_SELECT'],
    ['ARTICLE_GENERATE', 'ARTICLE_REVIEW'],
    ['TRANSLATE', 'OUTPUT_SELECT'],
    ['TTS_RENDER', 'PACKAGE'],
  ];

  for (const [from, expected] of staticCases) {
    test(`${from} → [${expected}]`, () => {
      const result = getNextState(from, ctx());
      assert.ok(Array.isArray(result), `Expected array for static transition from '${from}'`);
      assert.ok(result.includes(expected));
    });
  }
});

describe('Dynamic transitions — INPUT_SELECT', () => {
  test('youtube → INPUT_YOUTUBE', () => {
    const result = getNextState('INPUT_SELECT', ctx({ inputType: 'youtube' }));
    assert.equal(result, 'INPUT_YOUTUBE');
  });

  test('audio → INPUT_AUDIO', () => {
    const result = getNextState('INPUT_SELECT', ctx({ inputType: 'audio' }));
    assert.equal(result, 'INPUT_AUDIO');
  });

  test('textfile → INPUT_TEXT', () => {
    const result = getNextState('INPUT_SELECT', ctx({ inputType: 'textfile' }));
    assert.equal(result, 'INPUT_TEXT');
  });

  test('raw → INPUT_TEXT', () => {
    const result = getNextState('INPUT_SELECT', ctx({ inputType: 'raw' }));
    assert.equal(result, 'INPUT_TEXT');
  });

  test('unknown inputType throws', () => {
    assert.throws(
      () => getNextState('INPUT_SELECT', ctx({ inputType: 'bogus' })),
      /Unknown inputType/,
    );
  });
});

describe('Static transitions — PROCESSING_SELECT', () => {
  test('returns static array with all valid targets', () => {
    const result = getNextState('PROCESSING_SELECT', ctx());
    assert.ok(Array.isArray(result), 'Expected static array');
    assert.ok(result.includes('RESEARCH_PROMPT_GEN'));
    assert.ok(result.includes('SCRIPT_GENERATE'));
    assert.ok(result.includes('TRANSLATE'));
    assert.ok(result.includes('PACKAGE'));
    assert.ok(result.includes('COMPLETE'));
  });
});

describe('Dynamic transitions — RESEARCH_PROMPT_GEN', () => {
  test('prompt-only → OUTPUT_SELECT', () => {
    assert.equal(getNextState('RESEARCH_PROMPT_GEN', ctx({ processingType: 'prompt' })), 'OUTPUT_SELECT');
  });

  test('article → RESEARCH_EXECUTE', () => {
    assert.equal(getNextState('RESEARCH_PROMPT_GEN', ctx({ processingType: 'article' })), 'RESEARCH_EXECUTE');
  });
});

describe('Dynamic transitions — ARTICLE_REVIEW', () => {
  test('retry (articleRetryRequested + attempts < 3) → ARTICLE_GENERATE', () => {
    assert.equal(
      getNextState('ARTICLE_REVIEW', ctx({ articleRetryRequested: true, articleAttempts: 1 })),
      'ARTICLE_GENERATE',
    );
  });

  test('approved (no retry requested) → OUTPUT_SELECT', () => {
    assert.equal(
      getNextState('ARTICLE_REVIEW', ctx({ articleRetryRequested: undefined, articleAttempts: 1 })),
      'OUTPUT_SELECT',
    );
  });

  test('exhausted retries → OUTPUT_SELECT', () => {
    assert.equal(
      getNextState('ARTICLE_REVIEW', ctx({ articleRetryRequested: true, articleAttempts: 3 })),
      'OUTPUT_SELECT',
    );
  });
});

describe('Static transitions — OUTPUT_SELECT', () => {
  test('returns static array with all valid targets', () => {
    const result = getNextState('OUTPUT_SELECT', ctx());
    assert.ok(Array.isArray(result), 'Expected static array');
    assert.ok(result.includes('SCRIPT_GENERATE'));
    assert.ok(result.includes('ARTICLE_GENERATE'));
    assert.ok(result.includes('PACKAGE'));
    assert.ok(result.includes('COMPLETE'));
  });
});

describe('Static transitions — SCRIPT_GENERATE', () => {
  test('returns static array with all valid targets', () => {
    const result = getNextState('SCRIPT_GENERATE', ctx());
    assert.ok(Array.isArray(result), 'Expected static array');
    assert.ok(result.includes('TTS_RENDER'));
    assert.ok(result.includes('PACKAGE'));
    assert.ok(result.includes('OUTPUT_SELECT'));
  });
});

describe('PACKAGE allows two targets', () => {
  test('OUTPUT_SELECT is valid', () => {
    assert.doesNotThrow(() => assertValidTransition('PACKAGE', 'OUTPUT_SELECT', ctx()));
  });

  test('COMPLETE is valid', () => {
    assert.doesNotThrow(() => assertValidTransition('PACKAGE', 'COMPLETE', ctx()));
  });

  test('ERROR is invalid', () => {
    assert.throws(
      () => assertValidTransition('PACKAGE', 'ERROR', ctx()),
      /Invalid transition/,
    );
  });
});

describe('assertValidTransition', () => {
  test('valid static transition passes', () => {
    assert.doesNotThrow(() => assertValidTransition('PROJECT_INIT', 'INPUT_SELECT', ctx()));
  });

  test('invalid static transition throws', () => {
    assert.throws(
      () => assertValidTransition('PROJECT_INIT', 'COMPLETE', ctx()),
      /Invalid transition/,
    );
  });

  test('valid dynamic transition passes', () => {
    assert.doesNotThrow(
      () => assertValidTransition('INPUT_SELECT', 'INPUT_YOUTUBE', ctx({ inputType: 'youtube' })),
    );
  });

  test('mismatched dynamic transition throws', () => {
    assert.throws(
      () => assertValidTransition('INPUT_SELECT', 'INPUT_AUDIO', ctx({ inputType: 'youtube' })),
      /Invalid transition/,
    );
  });
});
