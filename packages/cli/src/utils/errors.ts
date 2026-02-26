/**
 * @module utils/errors
 * Custom error types for the CLI pipeline.
 *
 * All error classes extend `Error`, set `.name`, and preserve cause chains.
 * Use these over bare `Error` so the runner can distinguish user cancels
 * from real failures (e.g. skip-to-ERROR vs retry).
 */

// ---------------------------------------------------------------------------
// PipelineError — wraps a core or I/O error with CLI context
// ---------------------------------------------------------------------------

/**
 * A pipeline-level error that wraps an underlying cause and attaches
 * the CLI state in which the failure occurred.
 */
export class PipelineError extends Error {
  /** The CLI state where this error was thrown. */
  readonly state: string;
  /** The original error, if any. */
  override readonly cause?: Error;

  constructor(message: string, state: string, cause?: Error) {
    super(message, { cause });
    this.name = 'PipelineError';
    this.state = state;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// UserCancelledError — user explicitly cancelled a prompt
// ---------------------------------------------------------------------------

/**
 * Thrown (or returned) when the user cancels a `@clack/prompts` interaction.
 * The runner should treat this as a graceful abort, not a crash.
 */
export class UserCancelledError extends Error {
  /** The CLI state where the cancellation happened. */
  readonly state: string;

  constructor(state: string, message = 'User cancelled') {
    super(message);
    this.name = 'UserCancelledError';
    this.state = state;
  }
}

// ---------------------------------------------------------------------------
// CheckpointError — failed to read/write a checkpoint
// ---------------------------------------------------------------------------

/**
 * Thrown when a checkpoint file cannot be read or written.
 * Includes the path that failed for diagnostics.
 */
export class CheckpointError extends Error {
  /** Absolute path to the checkpoint file. */
  readonly filePath: string;
  override readonly cause?: Error;

  constructor(message: string, filePath: string, cause?: Error) {
    super(message, { cause });
    this.name = 'CheckpointError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// ValidationError — input or context validation failure
// ---------------------------------------------------------------------------

/**
 * Thrown when an input or context field fails validation.
 * Carries the field name and the invalid value for diagnostics.
 */
export class ValidationError extends Error {
  /** The field or param that failed validation. */
  readonly field: string;
  /** The value that was invalid (serialized for safety). */
  readonly value?: string;

  constructor(message: string, field: string, value?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value !== undefined ? String(value) : undefined;
  }
}
