/**
 * @module context
 * PipelineContext — the shared state object threaded through every stage.
 */

import type { PipelineConfig } from './config.js';
import type { PipelineEmitter } from './events.js';

// ---------------------------------------------------------------------------
// Logger interface (swappable by consumers)
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Minimal console-based logger with level filtering.
 * Used as the default when no custom logger is supplied.
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly debugEnabled: boolean = false) { }
  debug(msg: string, ...args: unknown[]) {
    if (this.debugEnabled) console.debug(`[debug] ${msg}`, ...args);
  }
  info(msg: string, ...args: unknown[]) {
    console.info(`[info]  ${msg}`, ...args);
  }
  warn(msg: string, ...args: unknown[]) {
    console.warn(`[warn]  ${msg}`, ...args);
  }
  error(msg: string, ...args: unknown[]) {
    console.error(`[error] ${msg}`, ...args);
  }
}

// ---------------------------------------------------------------------------
// PipelineContext
// ---------------------------------------------------------------------------

export interface PipelineContext {
  /** Validated, merged configuration. */
  readonly config: PipelineConfig;
  /** Typed event emitter for progress / status. */
  readonly emitter: PipelineEmitter;
  /** Unique run identifier (ISO timestamp). */
  readonly runId: string;
  /** Absolute path for output artifacts. */
  readonly outputDir: string;
  /** AbortSignal for cooperative cancellation. */
  readonly signal: AbortSignal;
  /** Structured logger. */
  readonly logger: Logger;
  /**
   * Accumulator for produced artifact paths.
   * Key = logical name (e.g. "transcript", "article"), value = absolute file path.
   */
  readonly artifacts: Map<string, string>;
  /**
   * Open-ended metadata bag accumulated across stages.
   * Written to metadata.json at the end of a run.
   */
  readonly metadata: Record<string, unknown>;
}
