/**
 * @module machine/runner
 * PipelineRunner — executes the CLI state machine loop.
 *
 * Responsibilities:
 *   1. Look up the handler for the current state from the stage registry.
 *   2. Save a checkpoint before each stage (Phase 6 will flesh this out).
 *   3. Execute the handler.
 *   4. Validate the returned transition.
 *   5. Update context and loop until a terminal state is reached.
 *
 * The runner does NOT import stage handlers directly — it receives a
 * `StageRegistry` at construction time so that tests can inject mocks.
 *
 * @see {@link ../../.github/instructions/REFACTOR_PLAN.md} Phase 5
 */

import fs from 'node:fs';
import path from 'node:path';

import type {
  CLIContext,
  State,
  StageResult,
  StageHandler,
  StageRegistry,
  SerializedCLIContext,
} from './types.js';
import { TERMINAL_STATES } from './types.js';
import { assertValidTransition } from './transitions.js';
import { PipelineError, UserCancelledError, CheckpointError } from '../utils/errors.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { clack } from '../ui/prompts.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max iterations before the runner assumes an infinite loop. */
const MAX_ITERATIONS = 200;

/** Subdirectory inside runDir where checkpoints are stored. */
const CHECKPOINT_DIR = 'checkpoints';

// ---------------------------------------------------------------------------
// Checkpoint helpers (lightweight — Phase 6 will add replay/resume)
// ---------------------------------------------------------------------------

function checkpointPath(runDir: string, index: number, state: State): string {
  const dir = path.join(runDir, CHECKPOINT_DIR);
  ensureDir(dir);
  const padded = String(index).padStart(3, '0');
  return path.join(dir, `${padded}-${state}.json`);
}

function serializeContext(ctx: CLIContext, index: number): SerializedCLIContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: Record<string, any> = { ...ctx };

  // Serialize Date → ISO string
  if (raw.startedAt instanceof Date) {
    raw.startedAt = raw.startedAt.toISOString();
  }
  // Serialize Error → { message, stack }
  if (raw.lastError instanceof Error) {
    raw.lastError = { message: raw.lastError.message, stack: raw.lastError.stack };
  }

  return {
    ...raw,
    currentState: ctx.currentState,
    checkpointedAt: new Date().toISOString(),
    checkpointIndex: index,
  } as SerializedCLIContext;
}

function saveCheckpoint(ctx: CLIContext, index: number): void {
  const filePath = checkpointPath(ctx.runDir, index, ctx.currentState);
  try {
    writeJson(filePath, serializeContext(ctx, index));
  } catch (err) {
    // Checkpoint failures are non-fatal — log and continue.
    clack.log.warn(`Checkpoint write failed: ${filePath}`);
  }
}

function deserializeContext(data: SerializedCLIContext): CLIContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: Record<string, any> = { ...data };
  // Restore Date
  if (typeof raw.startedAt === 'string') {
    raw.startedAt = new Date(raw.startedAt);
  }
  // Restore Error
  if (raw.lastError && typeof raw.lastError === 'object' && 'message' in raw.lastError) {
    const err = new Error((raw.lastError as { message: string }).message);
    err.stack = (raw.lastError as { stack?: string }).stack;
    raw.lastError = err;
  }
  // Remove checkpoint-only fields
  delete raw.checkpointedAt;
  delete raw.checkpointIndex;
  return raw as unknown as CLIContext;
}

// ---------------------------------------------------------------------------
// PipelineRunner
// ---------------------------------------------------------------------------

export interface RunnerOptions {
  /** The stage registry mapping State → StageHandler. */
  registry: StageRegistry;
  /** Initial context (for a fresh run). */
  context: CLIContext;
  /**
   * If true, skip checkpoint writes (useful in tests or --debugger mode).
   * Default: false.
   */
  skipCheckpoints?: boolean;
  /**
   * Maximum state transitions before forced abort.
   * Default: 200.
   */
  maxIterations?: number;
}

/**
 * Executes the CLI state machine.
 *
 * ```ts
 * const runner = new PipelineRunner({ registry, context });
 * const finalCtx = await runner.run();
 * ```
 */
export class PipelineRunner {
  private registry: StageRegistry;
  private ctx: CLIContext;
  private skipCheckpoints: boolean;
  private maxIterations: number;
  private iteration = 0;

  constructor(opts: RunnerOptions) {
    this.registry = opts.registry;
    this.ctx = opts.context;
    this.skipCheckpoints = opts.skipCheckpoints ?? false;
    this.maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Run the state machine from the current context until a terminal state.
   * Returns the final CLIContext.
   */
  async run(): Promise<CLIContext> {
    while (!TERMINAL_STATES.has(this.ctx.currentState)) {
      if (this.iteration >= this.maxIterations) {
        clack.log.error(
          `Runner exceeded ${this.maxIterations} iterations — aborting (possible infinite loop).`,
        );
        this.ctx = {
          ...this.ctx,
          currentState: 'ERROR',
          lastError: new PipelineError(
            `Exceeded max iterations (${this.maxIterations})`,
            this.ctx.currentState,
          ),
        };
        break;
      }

      const state = this.ctx.currentState;

      let handler: StageHandler;
      try {
        handler = this.lookupHandler(state);
      } catch (err) {
        const wrapped = err instanceof PipelineError
          ? err
          : new PipelineError(
            err instanceof Error ? err.message : String(err),
            state,
            err instanceof Error ? err : undefined,
          );
        clack.log.error(`Stage '${state}' failed: ${wrapped.message}`);
        this.ctx = {
          ...this.ctx,
          currentState: 'ERROR',
          lastError: wrapped,
          stateHistory: [...this.ctx.stateHistory, 'ERROR'],
        };
        break;
      }

      // Save checkpoint before each stage
      if (!this.skipCheckpoints) {
        saveCheckpoint(this.ctx, this.iteration);
      }

      let result: StageResult;
      try {
        result = await handler(this.ctx);
      } catch (err) {
        if (err instanceof UserCancelledError) {
          clack.log.warn('Cancelled by user.');
          this.ctx = {
            ...this.ctx,
            currentState: 'COMPLETE',
            stateHistory: [...this.ctx.stateHistory, 'COMPLETE'],
          };
          break;
        }

        const wrapped = err instanceof PipelineError
          ? err
          : new PipelineError(
            err instanceof Error ? err.message : String(err),
            state,
            err instanceof Error ? err : undefined,
          );

        clack.log.error(`Stage '${state}' failed: ${wrapped.message}`);
        this.ctx = {
          ...this.ctx,
          currentState: 'ERROR',
          lastError: wrapped,
          stateHistory: [...this.ctx.stateHistory, 'ERROR'],
        };
        break;
      }

      // Validate transition
      try {
        assertValidTransition(state, result.nextState, result.context);
      } catch (validationErr) {
        clack.log.error(
          `Invalid transition from '${state}' → '${result.nextState}'. ` +
          `${validationErr instanceof Error ? validationErr.message : String(validationErr)}`,
        );
        this.ctx = {
          ...this.ctx,
          currentState: 'ERROR',
          lastError: validationErr instanceof Error ? validationErr : new Error(String(validationErr)),
          stateHistory: [...this.ctx.stateHistory, 'ERROR'],
        };
        break;
      }

      // Advance
      this.ctx = result.context;
      this.iteration++;
    }

    // Final checkpoint
    if (!this.skipCheckpoints) {
      saveCheckpoint(this.ctx, this.iteration);
    }

    return this.ctx;
  }

  /**
   * Resume a run from a checkpoint file.
   *
   * Reads the checkpoint, deserializes the context, and continues
   * from the checkpointed state.
   */
  static async resume(
    checkpointFile: string,
    registry: StageRegistry,
    opts?: { skipCheckpoints?: boolean; maxIterations?: number },
  ): Promise<CLIContext> {
    if (!fs.existsSync(checkpointFile)) {
      throw new CheckpointError(`Checkpoint not found: ${checkpointFile}`, checkpointFile);
    }

    const data = readJson<SerializedCLIContext>(checkpointFile);
    if (!data || !data.currentState) {
      throw new CheckpointError(`Invalid checkpoint: ${checkpointFile}`, checkpointFile);
    }

    const ctx = deserializeContext(data);
    const runner = new PipelineRunner({
      registry,
      context: ctx,
      skipCheckpoints: opts?.skipCheckpoints,
      maxIterations: opts?.maxIterations,
    });
    // Resume iteration count from checkpoint
    runner.iteration = (data.checkpointIndex ?? 0) + 1;

    return runner.run();
  }

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Look up the handler for a state. Throws PipelineError if not registered.
   */
  private lookupHandler(state: State): StageHandler {
    if (TERMINAL_STATES.has(state)) {
      throw new PipelineError(`Cannot look up handler for terminal state '${state}'`, state);
    }

    const key = state as keyof StageRegistry;
    const handler = this.registry[key];

    if (!handler) {
      throw new PipelineError(
        `No handler registered for state '${state}'`,
        state,
      );
    }

    return handler;
  }
}

// ---------------------------------------------------------------------------
// Default registry factory
// ---------------------------------------------------------------------------

/**
 * Build the default stage registry from the implemented stage handlers.
 *
 * This wires every non-terminal state to its handler. Import this in
 * `cli.ts` when constructing the runner.
 *
 * Uses dynamic `import()` to avoid circular dependency at module load time.
 * Each stage file imports types/utils/transitions but not the runner,
 * so the graph is acyclic at runtime.
 */
export async function createDefaultRegistry(): Promise<StageRegistry> {
  const stages = await import('../stages/index.js');

  return {
    PROJECT_INIT: stages.projectInit,
    INPUT_SELECT: stages.inputSelect,
    INPUT_YOUTUBE: stages.inputYoutube,
    INPUT_AUDIO: stages.inputAudio,
    INPUT_TEXT: stages.inputText,
    TRANSCRIPTION: stages.transcription,
    TRANSCRIPT_REVIEW: stages.transcriptReview,
    PROCESSING_SELECT: stages.processingSelect,
    RESEARCH_PROMPT_GEN: stages.researchPromptGen,
    RESEARCH_EXECUTE: stages.researchExecute,
    ARTICLE_GENERATE: stages.articleGenerate,
    ARTICLE_REVIEW: stages.articleReview,
    TRANSLATE: stages.translate,
    OUTPUT_SELECT: stages.outputSelect,
    SCRIPT_GENERATE: stages.scriptGenerate,
    TTS_RENDER: stages.ttsRender,
    PACKAGE: stages.packageOutput,
  };
}
