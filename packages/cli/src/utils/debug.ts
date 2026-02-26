/**
 * @module utils/debug
 * Debugging helpers for inspecting pipeline context during development.
 *
 * Usage:
 *   import { trace, dumpContext, assertField } from '../utils/debug.js';
 *   trace(ctx);                   // log key context fields
 *   dumpContext(ctx, 'After TTS'); // full context snapshot
 *   assertField(ctx, 'transcriptPath'); // throw if missing
 *
 * These utilities are for development and debugging only.
 * They should NOT be used in production handler logic.
 */

import type { CLIContext, State } from '../machine/types.js';

// ---------------------------------------------------------------------------
// trace — compact one-line snapshot of key context fields
// ---------------------------------------------------------------------------

/**
 * Log a compact summary of the current pipeline context.
 *
 * Shows: current state, input type, processing type, output type,
 * key file paths (transcript, article, podcast script, audio),
 * state history length, and output file count.
 *
 * @param ctx   The current CLIContext
 * @param label Optional label to prefix the output (e.g. stage name)
 */
export function trace(ctx: Readonly<CLIContext>, label?: string): void {
  const prefix = label ? `[${label}]` : `[${ctx.currentState}]`;

  const fields: Record<string, unknown> = {
    state: ctx.currentState,
    inputType: ctx.inputType ?? '—',
    processingType: ctx.processingType ?? '—',
    outputType: ctx.outputType ?? '—',
    youtubeUrl: ctx.youtubeUrl?.url ?? '—',
    transcriptPath: ctx.transcriptPath ? '✓' : '—',
    articlePath: ctx.articlePath ? '✓' : '—',
    podcastScriptPath: ctx.podcastScriptPath ? '✓' : '—',
    audioPath: ctx.audioPath ? '✓' : '—',
    researchPromptPath: ctx.researchPromptPath ? '✓' : '—',
    reportPath: ctx.reportPath ? '✓' : '—',
    historyLen: ctx.stateHistory.length,
    outputFiles: (ctx.outputFiles ?? []).length,
  };

  const summary = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' | ');

  console.log(`${prefix} ${summary}`);
}

// ---------------------------------------------------------------------------
// dumpContext — full context snapshot to console
// ---------------------------------------------------------------------------

/**
 * Pretty-print the entire CLIContext for debugging.
 *
 * Serializes all fields including Date, Error, and YouTubeUrl.
 * Useful for comparing context before/after a handler.
 *
 * @param ctx   The context to dump
 * @param label Optional heading for the dump
 */
export function dumpContext(ctx: Readonly<CLIContext>, label?: string): void {
  const heading = label ?? `Context @ ${ctx.currentState}`;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${heading}`);
  console.log(`${'═'.repeat(60)}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serializable: Record<string, any> = {};

  for (const [key, value] of Object.entries(ctx)) {
    if (value instanceof Date) {
      serializable[key] = value.toISOString();
    } else if (value instanceof Error) {
      serializable[key] = { message: value.message, stack: value.stack?.split('\n')[0] };
    } else if (value && typeof value === 'object' && 'url' in value) {
      // YouTubeUrl value object
      serializable[key] = (value as { url: string }).url;
    } else {
      serializable[key] = value;
    }
  }

  console.log(JSON.stringify(serializable, null, 2));
  console.log(`${'─'.repeat(60)}\n`);
}

// ---------------------------------------------------------------------------
// assertField — guard that a context field is truthy
// ---------------------------------------------------------------------------

/**
 * Assert that a context field is truthy. Throws with a descriptive message
 * including the current state, which is easier to debug than a plain
 * `if (!ctx.field)` check.
 *
 * @param ctx   The current context
 * @param field The field name to check
 * @param msg   Optional custom message
 * @throws {Error} if the field is falsy
 */
export function assertField(
  ctx: Readonly<CLIContext>,
  field: keyof CLIContext,
  msg?: string,
): void {
  if (!ctx[field]) {
    const detail = msg ?? `Expected ctx.${field} to be truthy`;
    throw new Error(
      `[DEBUG] ${detail} (state=${ctx.currentState}, ` +
      `history=[${ctx.stateHistory.slice(-3).join(' → ')}])`,
    );
  }
}

// ---------------------------------------------------------------------------
// traceTransition — log a state transition
// ---------------------------------------------------------------------------

/**
 * Log a state transition for debugging.
 *
 * @param from The state being exited
 * @param to   The state being entered
 * @param ctx  The context at transition time
 */
export function traceTransition(from: State, to: State, ctx: Readonly<CLIContext>): void {
  const changedFields: string[] = [];

  // Detect which optional fields became truthy since the previus state
  const optionalKeys: (keyof CLIContext)[] = [
    'inputType', 'inputPath', 'youtubeUrl', 'rawText',
    'transcriptPath', 'cleanedTranscriptPath', 'summaryPath',
    'processingType', 'researchPromptPath', 'reportPath', 'articlePath',
    'translatedText', 'outputType', 'podcastScriptPath', 'reelScriptPath',
    'socialPostsPath', 'audioPath', 'zipPath', 'lastError',
  ];

  for (const key of optionalKeys) {
    if (ctx[key]) changedFields.push(key);
  }

  console.log(
    `[TRANSITION] ${from} → ${to}  ` +
    `(populated: ${changedFields.join(', ') || 'none'})`,
  );
}
