/**
 * @module pipeline
 * Pipeline runner — defines and executes ordered stage sequences.
 *
 * Usage:
 *   const p = definePipeline({ name: 'yt-to-podcast', stages: [...] });
 *   p.on('stage:progress', (e) => updateSpinner(e));
 *   const result = await p.run(input);
 */

import fs from 'node:fs';
import path from 'node:path';
import { PipelineEmitter } from './events.js';
import { ConsoleLogger } from './context.js';
import { loadConfig, type PipelineConfig } from './config.js';
import type { PipelineContext, Logger } from './context.js';
import type { Stage, RetryPolicy } from './stage.js';

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export interface PipelineResult {
  /** Unique run identifier. */
  runId: string;
  /** Map of artifact name → absolute file path. */
  artifacts: Map<string, string>;
  /** Accumulated metadata. */
  metadata: Record<string, unknown>;
  /** Stages that completed successfully (in order). */
  completedStages: string[];
  /** Non-fatal errors collected along the way. */
  errors: Array<{ stageName: string; error: Error }>;
  /** Total wall-clock duration in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  /** Human-readable pipeline name (e.g. "YouTube to Full Suite"). */
  name: string;
  /** Ordered stages to execute. */
  stages: Stage<any, any>[];
  /** Optional config overrides (merged with loadConfig). */
  config?: Partial<PipelineConfig> | PipelineConfig;
  /** Optional custom logger. */
  logger?: Logger;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Optional base output directory (overrides config.output.baseDir). */
  outputDir?: string;
}

// ---------------------------------------------------------------------------
// Pipeline class
// ---------------------------------------------------------------------------

export class Pipeline {
  readonly name: string;
  private readonly stages: Stage<any, any>[];
  private readonly configOverrides: Record<string, unknown>;
  private readonly customLogger?: Logger;
  private readonly customSignal?: AbortSignal;
  private readonly customOutputDir?: string;
  readonly emitter = new PipelineEmitter();

  constructor(opts: PipelineOptions) {
    this.name = opts.name;
    this.stages = [...opts.stages]; // defensive copy
    this.configOverrides = (opts.config ?? {}) as Record<string, unknown>;
    this.customLogger = opts.logger;
    this.customSignal = opts.signal;
    this.customOutputDir = opts.outputDir;
  }

  /** Subscribe to pipeline events. */
  on<K extends Parameters<PipelineEmitter['on']>[0]>(
    event: K,
    listener: Parameters<PipelineEmitter['on']>[1],
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.on(event, listener as any);
    return this;
  }

  /**
   * Execute the pipeline.
   * Each stage receives the previous stage's output as input.
   * The first stage receives `initialInput`.
   */
  async run(initialInput: unknown = {}): Promise<PipelineResult> {
    const t0 = Date.now();
    const config = loadConfig(this.configOverrides);
    const runId = nowStamp();
    const outputDir = this.resolveOutputDir(config, runId);
    fs.mkdirSync(outputDir, { recursive: true });

    const ac = new AbortController();
    const signal = this.customSignal ?? ac.signal;
    const logger = this.customLogger ?? new ConsoleLogger(config.debug);

    const ctx: PipelineContext = {
      config,
      emitter: this.emitter,
      runId,
      outputDir,
      signal,
      logger,
      artifacts: new Map(),
      metadata: {
        pipeline: this.name,
        runId,
        startedAt: new Date().toISOString(),
      },
    };

    const completedStages: string[] = [];
    const errors: PipelineResult['errors'] = [];
    const stageNames = this.stages.map((s) => s.name);

    this.emitter.emit('pipeline:start', { runId, stageNames });
    logger.info(`Pipeline "${this.name}" started — ${stageNames.length} stages`);

    let currentInput: unknown = initialInput;

    for (const stage of this.stages) {
      // Cancellation check
      if (signal.aborted) {
        const abortErr = new Error(`Pipeline aborted before stage "${stage.name}"`);
        this.emitter.emit('pipeline:error', {
          runId,
          error: abortErr,
          completedStages,
        });
        throw abortErr;
      }

      // Guard check
      if (stage.canRun) {
        const ok = await stage.canRun(currentInput, ctx);
        if (!ok) {
          this.emitter.emit('stage:skip', {
            stageName: stage.name,
            reason: 'guard returned false',
          });
          logger.info(`Skipping "${stage.name}" — guard returned false`);
          continue;
        }
      }

      // Execute with optional retry
      const stageT0 = Date.now();
      this.emitter.emit('stage:start', { stageName: stage.name, input: currentInput });

      try {
        currentInput = await executeWithRetry(stage, currentInput, ctx);
        const durationMs = Date.now() - stageT0;
        completedStages.push(stage.name);
        this.emitter.emit('stage:complete', {
          stageName: stage.name,
          output: currentInput,
          durationMs,
        });
        logger.info(`Stage "${stage.name}" completed in ${durationMs}ms`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ stageName: stage.name, error });
        this.emitter.emit('stage:error', {
          stageName: stage.name,
          error,
          willRetry: false,
        });

        // Fatal — stop the pipeline
        const pipelineErr = new Error(
          `Pipeline "${this.name}" failed at stage "${stage.name}": ${error.message}`,
          { cause: error },
        );
        this.emitter.emit('pipeline:error', {
          runId,
          error: pipelineErr,
          completedStages,
        });
        logger.error(`Pipeline failed at "${stage.name}": ${error.message}`);

        // Write partial metadata before throwing
        await this.writeMetadata(ctx, completedStages, errors, Date.now() - t0);
        throw pipelineErr;
      }
    }

    const durationMs = Date.now() - t0;
    ctx.metadata.completedAt = new Date().toISOString();
    ctx.metadata.durationMs = durationMs;

    await this.writeMetadata(ctx, completedStages, errors, durationMs);

    this.emitter.emit('pipeline:complete', {
      runId,
      artifacts: ctx.artifacts,
      metadata: ctx.metadata,
      durationMs,
    });

    logger.info(
      `Pipeline "${this.name}" completed in ${durationMs}ms — ${completedStages.length} stages, ${ctx.artifacts.size} artifacts`,
    );

    return {
      runId,
      artifacts: ctx.artifacts,
      metadata: ctx.metadata,
      completedStages,
      errors,
      durationMs,
    };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private resolveOutputDir(config: PipelineConfig, runId: string): string {
    // When the caller provides an explicit outputDir, use it directly
    // (no run-id subdirectory) so callers control the exact path.
    if (this.customOutputDir) {
      return path.resolve(process.cwd(), this.customOutputDir);
    }
    const base = config.output.baseDir;
    return path.resolve(process.cwd(), base, `run-${runId}`);
  }

  private async writeMetadata(
    ctx: PipelineContext,
    completedStages: string[],
    errors: PipelineResult['errors'],
    durationMs: number,
  ) {
    try {
      const meta = {
        ...ctx.metadata,
        completedStages,
        errors: errors.map((e) => ({ stage: e.stageName, message: e.error.message })),
        artifacts: Object.fromEntries(ctx.artifacts),
        durationMs,
      };
      const metaPath = path.join(ctx.outputDir, 'metadata.json');
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      ctx.artifacts.set('metadata', metaPath);
    } catch {
      ctx.logger.warn('Failed to write metadata.json');
    }
  }
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

async function executeWithRetry(
  stage: Stage<any, any>,
  input: unknown,
  ctx: PipelineContext,
): Promise<unknown> {
  const policy: RetryPolicy = stage.retryPolicy ?? { maxAttempts: 1, backoffMs: 0 };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await stage.run(input, ctx);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const willRetry = attempt < policy.maxAttempts;

      ctx.emitter.emit('stage:error', {
        stageName: stage.name,
        error: lastError,
        willRetry,
      });

      if (willRetry) {
        const delay = policy.backoffMs * Math.pow(2, attempt - 1);
        ctx.logger.warn(
          `Stage "${stage.name}" attempt ${attempt}/${policy.maxAttempts} failed, retrying in ${delay}ms…`,
        );
        await sleep(delay, ctx.signal);
      }
    }
  }

  throw lastError!;
}

/** Abortable sleep. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Convenience factory for creating a Pipeline. */
export function definePipeline(opts: PipelineOptions): Pipeline {
  return new Pipeline(opts);
}

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
