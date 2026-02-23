/**
 * @module machine/transitions
 * State transition map — defines valid next states for each CLI state.
 *
 * Design decisions (Phase 3):
 *   D1: `browse` removed from INPUT_SELECT → future `abq-media browse` command.
 *   D2: TTS only reachable via SCRIPT_GENERATE → TTS_RENDER (no shortcut).
 *   D3: RESEARCH_EXECUTE → OUTPUT_SELECT always (user picks what to do with report).
 *   D4: Invalid transitions throw ValidationError (hard fail).
 *   D5: Exports both the raw TRANSITIONS map and a getNextState() helper.
 *
 * @see {@link ../../.github/instructions/REFACTOR_PLAN.md} Phase 3
 */

import type { CLIContext, State, TransitionMap } from './types.js';
import { ValidationError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Transition map
// ---------------------------------------------------------------------------

/**
 * The complete transition map for the CLI state machine.
 *
 * - Static transitions: `State[]` — fixed set of valid next states.
 * - Dynamic transitions: `(ctx: CLIContext) => State` — picks based on context.
 *
 * Terminal states (`COMPLETE`, `ERROR`) map to empty arrays.
 */
export const TRANSITIONS: TransitionMap = {
  // ── Bootstrap ───────────────────────────────────────────────────────

  PROJECT_INIT: ['INPUT_SELECT'],

  // ── Input routing ───────────────────────────────────────────────────

  INPUT_SELECT: (ctx: CLIContext): State => {
    switch (ctx.inputType) {
      case 'youtube': return 'INPUT_YOUTUBE';
      case 'audio': return 'INPUT_AUDIO';
      case 'textfile':
      case 'raw': return 'INPUT_TEXT';
      default:
        throw new ValidationError(
          `Unknown inputType '${ctx.inputType}' at INPUT_SELECT`,
          'inputType',
          ctx.inputType,
        );
    }
  },

  INPUT_YOUTUBE: ['TRANSCRIPTION'],
  INPUT_AUDIO: ['TRANSCRIPTION'],
  INPUT_TEXT: ['PROCESSING_SELECT'],   // skip transcription

  // ── Transcription ───────────────────────────────────────────────────

  TRANSCRIPTION: ['TRANSCRIPT_REVIEW', 'ERROR'],
  TRANSCRIPT_REVIEW: ['PROCESSING_SELECT'],

  // ── Processing routing ──────────────────────────────────────────────

  PROCESSING_SELECT: (ctx: CLIContext): State => {
    switch (ctx.processingType) {
      case 'prompt':
      case 'article':
        return 'RESEARCH_PROMPT_GEN';

      case 'podcast_script':
      case 'reel_script':
        return 'SCRIPT_GENERATE';

      case 'translate':
        return 'TRANSLATE';

      case 'export':
      case 'export_zip':
        return 'PACKAGE';

      default:
        throw new ValidationError(
          `Unknown processingType '${ctx.processingType}' at PROCESSING_SELECT`,
          'processingType',
          ctx.processingType,
        );
    }
  },

  // ── Research flow ───────────────────────────────────────────────────

  RESEARCH_PROMPT_GEN: (ctx: CLIContext): State => {
    // Prompt-only: skip execution, go straight to output select.
    if (ctx.processingType === 'prompt') return 'OUTPUT_SELECT';
    // Article (or future flows): execute the research.
    return 'RESEARCH_EXECUTE';
  },

  // D3: always → OUTPUT_SELECT — user decides what to do with the report.
  RESEARCH_EXECUTE: ['OUTPUT_SELECT'],

  // ── Article flow ────────────────────────────────────────────────────

  ARTICLE_GENERATE: ['ARTICLE_REVIEW'],

  ARTICLE_REVIEW: (ctx: CLIContext): State => {
    const attempts = ctx.articleAttempts ?? 0;
    // If last error indicates a retry request AND we haven't exhausted retries:
    if (ctx.lastError && attempts < 3) return 'ARTICLE_GENERATE';
    // Otherwise (approved or max retries): move on.
    return 'OUTPUT_SELECT';
  },

  // ── Translation ─────────────────────────────────────────────────────

  TRANSLATE: ['OUTPUT_SELECT'],

  // ── Output routing ──────────────────────────────────────────────────

  OUTPUT_SELECT: (ctx: CLIContext): State => {
    switch (ctx.outputType) {
      case 'podcast': return 'SCRIPT_GENERATE';
      case 'article': return 'ARTICLE_GENERATE';
      case 'social_kit':
      case 'export_zip': return 'PACKAGE';
      default:
        throw new ValidationError(
          `Unknown outputType '${ctx.outputType}' at OUTPUT_SELECT`,
          'outputType',
          ctx.outputType,
        );
    }
  },

  // ── Script + TTS flow ──────────────────────────────────────────────

  SCRIPT_GENERATE: (ctx: CLIContext): State => {
    // Podcast scripts proceed to TTS; reel scripts go straight to package.
    if (ctx.outputType === 'podcast') return 'TTS_RENDER';
    return 'PACKAGE';
  },

  TTS_RENDER: ['PACKAGE'],

  // ── Packaging + loop ───────────────────────────────────────────────

  // The stage handler decides: user picks "more" → OUTPUT_SELECT, "done" → COMPLETE.
  // Both are valid next states; the stage returns one or the other.
  PACKAGE: ['OUTPUT_SELECT', 'COMPLETE'],

  // ── Terminal ────────────────────────────────────────────────────────

  COMPLETE: [],
  ERROR: [],
};

// ---------------------------------------------------------------------------
// Helper: resolve next state
// ---------------------------------------------------------------------------

/**
 * Resolve the next state for a given current state and context.
 *
 * - For static transitions (arrays), returns the array of valid next states.
 * - For dynamic transitions (functions), executes the function and returns
 *   the single computed next state.
 *
 * @throws {ValidationError} if the state has no entry in the map, or if a
 *   dynamic transition throws.
 */
export function getNextState(
  currentState: State,
  ctx: CLIContext,
): State | State[] {
  const rule = TRANSITIONS[currentState];

  if (rule === undefined) {
    throw new ValidationError(
      `No transition rule for state '${currentState}'`,
      'currentState',
      currentState,
    );
  }

  if (typeof rule === 'function') {
    return rule(ctx);
  }

  return rule;
}

/**
 * Validate that a proposed next state is legal from the current state.
 *
 * @throws {ValidationError} if the transition is not allowed.
 */
export function assertValidTransition(
  from: State,
  to: State,
  ctx: CLIContext,
): void {
  const allowed = getNextState(from, ctx);

  const valid = Array.isArray(allowed)
    ? allowed.includes(to)
    : allowed === to;

  if (!valid) {
    throw new ValidationError(
      `Invalid transition: '${from}' → '${to}'. Allowed: ${JSON.stringify(allowed)}`,
      'nextState',
      to,
    );
  }
}
