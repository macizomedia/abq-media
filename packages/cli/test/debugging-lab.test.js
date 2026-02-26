/**
 * @file debugging-lab.test.js
 * Debugging Lab: First Bug Hunt — Session 5
 *
 * Three bug hunts exercised as automated tests:
 *   BH1 — Trace the deep research → podcast path (data flow)
 *   BH2 — Optional fields accessed without guards (preconditions)
 *   BH3 — State transition gaps (ERROR escape hatch)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  TRANSITIONS,
  getNextState,
  assertValidTransition,
} from '../dist/machine/transitions.js';
import {
  createInitialContext,
  validateContextForState,
} from '../dist/machine/context.js';
import { ALL_STATES, TERMINAL_STATES } from '../dist/machine/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides = {}) {
  return {
    projectName: 'lab',
    projectDir: '/tmp/lab',
    runDir: '/tmp/lab/runs/r1',
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
// BH1 — Trace the deep research → podcast path
// ---------------------------------------------------------------------------

describe('BH1: Deep research → podcast path trace', () => {
  test('PROJECT_INIT → INPUT_SELECT is the only exit', () => {
    const result = getNextState('PROJECT_INIT', ctx());
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, ['INPUT_SELECT']);
  });

  test('INPUT_SELECT + youtube → INPUT_YOUTUBE', () => {
    const result = getNextState('INPUT_SELECT', ctx({ inputType: 'youtube' }));
    assert.equal(result, 'INPUT_YOUTUBE');
  });

  test('INPUT_YOUTUBE → TRANSCRIPTION is valid', () => {
    assert.doesNotThrow(() =>
      assertValidTransition('INPUT_YOUTUBE', 'TRANSCRIPTION', ctx({ inputType: 'youtube' })),
    );
  });

  test('TRANSCRIPTION → TRANSCRIPT_REVIEW is valid', () => {
    assert.doesNotThrow(() =>
      assertValidTransition('TRANSCRIPTION', 'TRANSCRIPT_REVIEW', ctx()),
    );
  });

  test('TRANSCRIPT_REVIEW → PROCESSING_SELECT is the only exit', () => {
    const result = getNextState('TRANSCRIPT_REVIEW', ctx());
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, ['PROCESSING_SELECT']);
  });

  test('PROCESSING_SELECT includes RESEARCH_PROMPT_GEN for article flow', () => {
    const result = getNextState('PROCESSING_SELECT', ctx({ processingType: 'article' }));
    assert.ok(Array.isArray(result));
    assert.ok(result.includes('RESEARCH_PROMPT_GEN'));
  });

  test('RESEARCH_PROMPT_GEN + article → RESEARCH_EXECUTE', () => {
    const result = getNextState('RESEARCH_PROMPT_GEN', ctx({ processingType: 'article' }));
    assert.equal(result, 'RESEARCH_EXECUTE');
  });

  test('RESEARCH_EXECUTE → OUTPUT_SELECT is the only static target', () => {
    const result = getNextState('RESEARCH_EXECUTE', ctx());
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, ['OUTPUT_SELECT']);
  });

  test('OUTPUT_SELECT includes SCRIPT_GENERATE for podcast flow', () => {
    const result = getNextState('OUTPUT_SELECT', ctx({ outputType: 'podcast' }));
    assert.ok(Array.isArray(result));
    assert.ok(result.includes('SCRIPT_GENERATE'));
  });

  test('SCRIPT_GENERATE includes TTS_RENDER for podcast', () => {
    const result = getNextState('SCRIPT_GENERATE', ctx({ outputType: 'podcast' }));
    assert.ok(Array.isArray(result));
    assert.ok(result.includes('TTS_RENDER'));
  });

  test('TTS_RENDER → PACKAGE is the only exit', () => {
    const result = getNextState('TTS_RENDER', ctx());
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, ['PACKAGE']);
  });

  test('PACKAGE includes COMPLETE', () => {
    const result = getNextState('PACKAGE', ctx());
    assert.ok(Array.isArray(result));
    assert.ok(result.includes('COMPLETE'));
  });

  test('Full path: each transition is valid', () => {
    const path = [
      'PROJECT_INIT', 'INPUT_SELECT', 'INPUT_YOUTUBE', 'TRANSCRIPTION',
      'TRANSCRIPT_REVIEW', 'PROCESSING_SELECT', 'RESEARCH_PROMPT_GEN',
      'RESEARCH_EXECUTE', 'OUTPUT_SELECT', 'SCRIPT_GENERATE',
      'TTS_RENDER', 'PACKAGE', 'COMPLETE',
    ];

    // Context accumulates what each handler would set
    const pathCtx = ctx({
      inputType: 'youtube',
      processingType: 'article',
      outputType: 'podcast',
      articleRetryRequested: undefined,
    });

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const allowed = getNextState(from, pathCtx);
      const valid = Array.isArray(allowed)
        ? allowed.includes(to)
        : allowed === to;

      assert.ok(valid, `Transition ${from} → ${to} should be valid (allowed: ${JSON.stringify(allowed)})`);
    }
  });
});

// ---------------------------------------------------------------------------
// BH2 — Precondition guard correctness
// ---------------------------------------------------------------------------

describe('BH2: Precondition guards — fixed regressions', () => {
  test('INPUT_YOUTUBE only requires inputType (not youtubeUrl)', () => {
    // youtubeUrl is set BY the handler — it must NOT be a precondition.
    assert.doesNotThrow(
      () => validateContextForState(ctx({ inputType: 'youtube' }), 'INPUT_YOUTUBE'),
      'INPUT_YOUTUBE should pass with just inputType set',
    );
  });

  test('INPUT_AUDIO only requires inputType (not inputPath)', () => {
    // inputPath is set BY the handler — it must NOT be a precondition.
    assert.doesNotThrow(
      () => validateContextForState(ctx({ inputType: 'audio' }), 'INPUT_AUDIO'),
      'INPUT_AUDIO should pass with just inputType set',
    );
  });

  test('INPUT_TEXT requires inputType', () => {
    assert.throws(
      () => validateContextForState(ctx(), 'INPUT_TEXT'),
      /inputType/,
    );
    assert.doesNotThrow(
      () => validateContextForState(ctx({ inputType: 'textfile' }), 'INPUT_TEXT'),
    );
  });

  test('TRANSCRIPTION requires inputType', () => {
    assert.throws(
      () => validateContextForState(ctx(), 'TRANSCRIPTION'),
      /inputType/,
    );
    assert.doesNotThrow(
      () => validateContextForState(ctx({ inputType: 'youtube' }), 'TRANSCRIPTION'),
    );
  });

  test('TTS_RENDER requires podcastScriptPath', () => {
    assert.throws(
      () => validateContextForState(ctx(), 'TTS_RENDER'),
      /podcastScriptPath/,
    );
    assert.doesNotThrow(
      () => validateContextForState(ctx({ podcastScriptPath: '/tmp/ps.md' }), 'TTS_RENDER'),
    );
  });

  test('RESEARCH_EXECUTE requires researchPromptPath', () => {
    assert.throws(
      () => validateContextForState(ctx(), 'RESEARCH_EXECUTE'),
      /researchPromptPath/,
    );
    assert.doesNotThrow(
      () => validateContextForState(ctx({ researchPromptPath: '/tmp/p.md' }), 'RESEARCH_EXECUTE'),
    );
  });

  test('ARTICLE_REVIEW requires articlePath', () => {
    assert.throws(
      () => validateContextForState(ctx(), 'ARTICLE_REVIEW'),
      /articlePath/,
    );
    assert.doesNotThrow(
      () => validateContextForState(ctx({ articlePath: '/tmp/a.md' }), 'ARTICLE_REVIEW'),
    );
  });

  test('TRANSLATE requires transcriptPath', () => {
    assert.throws(
      () => validateContextForState(ctx(), 'TRANSLATE'),
      /transcriptPath/,
    );
    assert.doesNotThrow(
      () => validateContextForState(ctx({ transcriptPath: '/tmp/t.txt' }), 'TRANSLATE'),
    );
  });
});

// ---------------------------------------------------------------------------
// BH3 — Transition gap analysis
// ---------------------------------------------------------------------------

describe('BH3: Transition gap — every non-terminal state has exits', () => {
  for (const state of ALL_STATES) {
    if (TERMINAL_STATES.has(state)) continue;

    test(`${state} has at least one valid target`, () => {
      const rule = TRANSITIONS[state];
      assert.ok(rule !== undefined, `No transition rule for '${state}'`);

      if (typeof rule === 'function') {
        // Dynamic — just verify it's callable (full behavior tested elsewhere)
        assert.equal(typeof rule, 'function');
      } else {
        assert.ok(Array.isArray(rule));
        assert.ok(rule.length > 0, `State '${state}' has empty transition array`);
      }
    });
  }
});

describe('BH3: ERROR is a valid escape from any state (runner skip)', () => {
  // ERROR is handled by the runner (skips assertValidTransition).
  // This test documents the design: handlers MAY return ERROR from any state
  // and the runner preserves the handler's lastError (no double-error).

  const statesWithExplicitError = [];
  const statesWithoutExplicitError = [];

  for (const state of ALL_STATES) {
    if (TERMINAL_STATES.has(state)) continue;
    const rule = TRANSITIONS[state];
    if (Array.isArray(rule) && rule.includes('ERROR')) {
      statesWithExplicitError.push(state);
    } else if (Array.isArray(rule)) {
      statesWithoutExplicitError.push(state);
    }
    // Dynamic functions don't list ERROR explicitly
  }

  test('TRANSCRIPTION explicitly lists ERROR', () => {
    assert.ok(statesWithExplicitError.includes('TRANSCRIPTION'));
  });

  test('States without explicit ERROR still function (runner skips validation)', () => {
    // These states' handlers CAN return ERROR. The runner now skips
    // assertValidTransition for nextState === 'ERROR', so the handler's
    // original error context is preserved.
    const expectedWithout = [
      'PROJECT_INIT', 'INPUT_YOUTUBE', 'INPUT_AUDIO', 'INPUT_TEXT',
      'TRANSCRIPT_REVIEW', 'PROCESSING_SELECT', 'RESEARCH_EXECUTE',
      'ARTICLE_GENERATE', 'TRANSLATE', 'OUTPUT_SELECT',
      'SCRIPT_GENERATE', 'TTS_RENDER', 'PACKAGE',
    ];
    for (const s of expectedWithout) {
      assert.ok(
        statesWithoutExplicitError.includes(s),
        `Expected '${s}' to not have explicit ERROR in transitions`,
      );
    }
  });
});

describe('BH3: Transition validation — assertValidTransition', () => {
  test('valid static transition passes', () => {
    assert.doesNotThrow(() =>
      assertValidTransition('PROJECT_INIT', 'INPUT_SELECT', ctx()),
    );
  });

  test('invalid transition throws ValidationError', () => {
    assert.throws(
      () => assertValidTransition('PROJECT_INIT', 'COMPLETE', ctx()),
      /Invalid transition/,
    );
  });

  test('dynamic transition — correct path passes', () => {
    assert.doesNotThrow(() =>
      assertValidTransition(
        'INPUT_SELECT',
        'INPUT_YOUTUBE',
        ctx({ inputType: 'youtube' }),
      ),
    );
  });

  test('dynamic transition — wrong target throws', () => {
    assert.throws(
      () => assertValidTransition(
        'INPUT_SELECT',
        'INPUT_AUDIO',
        ctx({ inputType: 'youtube' }),
      ),
      /Invalid transition/,
    );
  });

  test('ERROR from non-TRANSCRIPTION state throws (by design — runner skips this)', () => {
    // This test documents that assertValidTransition itself still rejects
    // ERROR from states that don't list it. The runner handles this via
    // the nextState === 'ERROR' check.
    assert.throws(
      () => assertValidTransition('ARTICLE_GENERATE', 'ERROR', ctx()),
      /Invalid transition/,
    );
  });

  test('ERROR from TRANSCRIPTION passes (explicit in map)', () => {
    assert.doesNotThrow(() =>
      assertValidTransition('TRANSCRIPTION', 'ERROR', ctx()),
    );
  });
});

// ---------------------------------------------------------------------------
// BH3: Complete handler is dead code from runner perspective
// ---------------------------------------------------------------------------

describe('BH3: Terminal state analysis', () => {
  test('COMPLETE and ERROR are terminal', () => {
    assert.ok(TERMINAL_STATES.has('COMPLETE'));
    assert.ok(TERMINAL_STATES.has('ERROR'));
  });

  test('COMPLETE has empty transition array (no exits)', () => {
    const rule = TRANSITIONS['COMPLETE'];
    assert.ok(Array.isArray(rule));
    assert.equal(rule.length, 0);
  });

  test('ERROR has empty transition array (no exits)', () => {
    const rule = TRANSITIONS['ERROR'];
    assert.ok(Array.isArray(rule));
    assert.equal(rule.length, 0);
  });
});
