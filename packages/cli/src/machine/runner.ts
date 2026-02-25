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

import {
  SourceEngine,
  TranscriptionEngine,
  TextToSpeechEngine,
  VideoEngine,
} from '../../../core/src/engines';
import { EngineRegistry } from '../../../core/src/engine-registry';
import { Recipe } from '../../../core/src/recipe';

import type {
  CLIContext,
  State,
  StageResult,
  StageHandler,
  SerializedCLIContext,
} from './types.js';
import { TERMINAL_STATES } from './types.js';
import { assertValidTransition } from './transitions.js';
import { validateContextForState } from './context.js';
import { PipelineError, UserCancelledError, CheckpointError } from '../utils/errors.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { YouTubeUrl } from '../utils/youtube-url.js';
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
  // Serialize Error → { message, stack, state? }
  if (raw.lastError instanceof Error) {
    raw.lastError = {
      message: raw.lastError.message,
      stack: raw.lastError.stack,
      // Preserve PipelineError.state for diagnostics on resume
      state: (raw.lastError as unknown as Record<string, unknown>).state,
    };
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
  // Restore Error (including PipelineError.state if present)
  if (raw.lastError && typeof raw.lastError === 'object' && 'message' in raw.lastError) {
    const saved = raw.lastError as { message: string; stack?: string; state?: string };
    const err = new Error(saved.message);
    err.stack = saved.stack;
    // Re-attach state property for diagnostics (PipelineError compat)
    if (saved.state) (err as unknown as Record<string, unknown>).state = saved.state;
    raw.lastError = err;
  }

  // Defensive defaults for required non-optional fields
  raw.outputFiles = raw.outputFiles ?? [];

  // Restore YouTubeUrl value object from serialized string
  if (typeof raw.youtubeUrl === 'string') {
    raw.youtubeUrl = YouTubeUrl.parse(raw.youtubeUrl) ?? undefined;
  }

  // Clear transient flags that should not survive a resume
  raw.articleRetryRequested = undefined;

  // Remove checkpoint-only fields
  delete raw.checkpointedAt;
  delete raw.checkpointIndex;
  return raw as unknown as CLIContext;
}

// ---------------------------------------------------------------------------
// PipelineRunner
// ---------------------------------------------------------------------------

export interface RunnerOptions {
  /** The engine registry. */
  registry: EngineRegistry;
  /** Initial context (for a fresh run). */
  context: CLIContext;
  /** The recipe to execute. */
  recipe: Recipe;
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
  private registry: EngineRegistry;
  private ctx: CLIContext;
  private recipe: Recipe;
  private skipCheckpoints: boolean;
  private maxIterations: number;
  private iteration = 0;

  constructor(opts: RunnerOptions) {
    this.registry = opts.registry;
    this.ctx = opts.context;
    this.recipe = opts.recipe;
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

      // Validate context preconditions for the upcoming state
      try {
        validateContextForState(this.ctx, state);
      } catch (err) {
        const wrapped = err instanceof PipelineError
          ? err
          : new PipelineError(
            err instanceof Error ? err.message : String(err),
            state,
            err instanceof Error ? err : undefined,
          );
        clack.log.error(`Precondition failed for '${state}': ${wrapped.message}`);
        this.ctx = {
          ...this.ctx,
          currentState: 'ERROR',
          lastError: wrapped,
          stateHistory: [...this.ctx.stateHistory, 'ERROR'],
        };
        break;
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
      // ERROR is a universal escape hatch — handlers may return it from any
      // state. Skip transition validation for ERROR so the handler's original
      // error context is preserved (otherwise assertValidTransition would
      // overwrite lastError with a generic "Invalid transition" error).
      if (result.nextState !== 'ERROR') {
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
    registry: EngineRegistry,
    recipe: Recipe,
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
      recipe,
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

    const handler = async (context: CLIContext): Promise<StageResult> => {
      let nextState: State = 'ERROR';
      let newContext = { ...context };

      switch (state) {
        case 'INPUT_YOUTUBE': {
          const engine = this.registry.get<SourceEngine>(this.recipe.source.engine);
          const result = await engine.fetch(new URL(this.recipe.source.url));
          // In a real implementation, we would save the transcript to a file
          // and update the context with the file path.
          newContext = {
            ...context,
            // Placeholder for where the audio file path would be stored
            audioFilePath: result.audioFilePath,
          };
          nextState = 'TRANSCRIPTION';
          break;
        }
        case 'TRANSCRIPTION': {
          const engine = this.registry.get<TranscriptionEngine>(this.recipe.transcription.engine);
          const transcript = await engine.transcribe(context.audioFilePath);
          // In a real implementation, we would save the transcript to a file
          // and update the context with the file path.
          newContext = {
            ...context,
            transcript,
          };
          nextState = 'TTS_RENDER';
          break;
        }
        case 'TTS_RENDER': {
          const engine = this.registry.get<TextToSpeechEngine>(this.recipe.tts.engine);
          const outputFilePath = path.join(context.runDir, 'output.mp3');
          await engine.synthesize(context.transcript, 'voiceId-placeholder', outputFilePath);
          newContext = {
            ...context,
            outputFiles: [outputFilePath],
          };
          nextState = 'COMPLETE';
          break;
        }
        default:
          throw new PipelineError(`No handler for state: ${state}`, state);
      }

      return {
        nextState,
        context: newContext,
      };
    };

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
export async function createDefaultRegistry(): Promise<EngineRegistry> {
  return new EngineRegistry();
}
