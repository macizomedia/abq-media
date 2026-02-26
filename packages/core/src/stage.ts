/**
 * @module stage
 * Core stage contracts — the building blocks of every pipeline.
 *
 * A Stage is a typed, async unit of work with explicit input/output,
 * optional guards, and retry policies. Three composite types allow
 * sequencing, fallback chains, and parallel fan-out.
 */

import type { PipelineContext } from './context.js';

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Maximum number of attempts (1 = no retry). Default 1. */
  maxAttempts: number;
  /** Base delay in ms between retries (doubles on each attempt). */
  backoffMs: number;
}

// ---------------------------------------------------------------------------
// Stage — the atomic unit
// ---------------------------------------------------------------------------

export interface Stage<TInput = unknown, TOutput = unknown> {
  /** Unique dot-namespaced identifier, e.g. "ingest:youtube". */
  readonly name: string;
  /** Human-readable description shown in TUI. */
  readonly description?: string;
  /** Optional guard — if it returns false the stage is skipped. */
  canRun?(input: TInput, ctx: PipelineContext): boolean | Promise<boolean>;
  /** Execute the stage. Must be idempotent if retried. */
  run(input: TInput, ctx: PipelineContext): Promise<TOutput>;
  /** Optional retry policy for transient failures. */
  retryPolicy?: RetryPolicy;
}

// ---------------------------------------------------------------------------
// FallbackStage — tries alternatives until one succeeds
// ---------------------------------------------------------------------------

export interface FallbackStageOptions<TInput, TOutput> {
  readonly name: string;
  readonly description?: string;
  /** Ordered list of alternatives to try. First success wins. */
  readonly alternatives: ReadonlyArray<Stage<TInput, TOutput>>;
}

export class FallbackStage<TInput = unknown, TOutput = unknown>
  implements Stage<TInput, TOutput> {
  readonly name: string;
  readonly description?: string;
  private readonly alternatives: ReadonlyArray<Stage<TInput, TOutput>>;

  constructor(opts: FallbackStageOptions<TInput, TOutput>) {
    this.name = opts.name;
    this.description = opts.description;
    this.alternatives = opts.alternatives;
    if (this.alternatives.length === 0) {
      throw new Error(`FallbackStage "${this.name}": at least one alternative required`);
    }
  }

  async run(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    const errors: Array<{ stage: string; error: unknown }> = [];

    for (const alt of this.alternatives) {
      // Guard check
      if (alt.canRun && !(await alt.canRun(input, ctx))) {
        ctx.emitter.emit('stage:skip', { stageName: alt.name, reason: 'guard returned false' });
        continue;
      }

      ctx.emitter.emit('stage:progress', {
        stageName: this.name,
        message: `Trying ${alt.name}…`,
      });

      try {
        const result = await alt.run(input, ctx);
        return result;
      } catch (err) {
        errors.push({ stage: alt.name, error: err });
        ctx.emitter.emit('stage:error', {
          stageName: alt.name,
          error: err instanceof Error ? err : new Error(String(err)),
          willRetry: true,
        });
      }
    }

    const summary = errors
      .map((e) => `  ${e.stage}: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
      .join('\n');
    throw new Error(
      `FallbackStage "${this.name}": all ${errors.length} alternatives failed:\n${summary}`,
    );
  }
}

// ---------------------------------------------------------------------------
// ParallelStage — runs independent stages concurrently
// ---------------------------------------------------------------------------

export interface ParallelStageOptions<TInput> {
  readonly name: string;
  readonly description?: string;
  /** Stages to execute concurrently. All receive the same input. */
  readonly stages: ReadonlyArray<Stage<TInput, unknown>>;
  /**
   * If true, a single failure aborts all. If false, failures are collected
   * and successful results are still returned. Default: false.
   */
  readonly failFast?: boolean;
}

/** Result map keyed by stage name → output or error. */
export type ParallelResult = Map<string, { ok: true; value: unknown } | { ok: false; error: Error }>;

export class ParallelStage<TInput = unknown>
  implements Stage<TInput, ParallelResult> {
  readonly name: string;
  readonly description?: string;
  private readonly stages: ReadonlyArray<Stage<TInput, unknown>>;
  private readonly failFast: boolean;

  constructor(opts: ParallelStageOptions<TInput>) {
    this.name = opts.name;
    this.description = opts.description;
    this.stages = opts.stages;
    this.failFast = opts.failFast ?? false;
  }

  async run(input: TInput, ctx: PipelineContext): Promise<ParallelResult> {
    const result: ParallelResult = new Map();

    const promises = this.stages.map(async (stage) => {
      ctx.emitter.emit('stage:start', { stageName: stage.name, input });
      const t0 = Date.now();
      try {
        const value = await stage.run(input, ctx);
        result.set(stage.name, { ok: true, value });
        ctx.emitter.emit('stage:complete', {
          stageName: stage.name,
          output: value,
          durationMs: Date.now() - t0,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        result.set(stage.name, { ok: false, error });
        ctx.emitter.emit('stage:error', { stageName: stage.name, error, willRetry: false });
        if (this.failFast) throw error;
      }
    });

    if (this.failFast) {
      await Promise.all(promises);
    } else {
      await Promise.allSettled(promises);
    }

    return result;
  }
}
