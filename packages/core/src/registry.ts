/**
 * @module registry
 * Stage registry — a container for registering, replacing, and wrapping stages.
 *
 * This is the "make it easier to move, remove, or add parts" layer.
 * Consumers can swap out stages (e.g., replace `transcribe:asr` with a custom provider),
 * wrap stages with middleware (logging, caching, metrics), or introspect the registry.
 */

import type { Stage } from './stage.js';
import type { PipelineContext } from './context.js';

// ---------------------------------------------------------------------------
// Middleware type
// ---------------------------------------------------------------------------

export type StageMiddleware<TInput = any, TOutput = any> = (
  next: Stage<TInput, TOutput>,
) => Stage<TInput, TOutput>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class StageRegistry {
  private stages = new Map<string, Stage<any, any>>();

  /** Register a stage. Throws if a stage with the same name already exists (use replace() for that). */
  register<TInput, TOutput>(stage: Stage<TInput, TOutput>): this {
    if (this.stages.has(stage.name)) {
      throw new Error(
        `StageRegistry: stage "${stage.name}" is already registered. Use replace() to override.`,
      );
    }
    this.stages.set(stage.name, stage);
    return this;
  }

  /** Get a stage by name, or undefined. */
  get<TInput = unknown, TOutput = unknown>(name: string): Stage<TInput, TOutput> | undefined {
    return this.stages.get(name) as Stage<TInput, TOutput> | undefined;
  }

  /** Get a stage by name, or throw. */
  require<TInput = unknown, TOutput = unknown>(name: string): Stage<TInput, TOutput> {
    const stage = this.get<TInput, TOutput>(name);
    if (!stage) {
      throw new Error(`StageRegistry: stage "${name}" not found. Available: ${this.names().join(', ')}`);
    }
    return stage;
  }

  /** Replace an existing stage. Throws if the name doesn't exist (use register() for new stages). */
  replace<TInput, TOutput>(name: string, newStage: Stage<TInput, TOutput>): this {
    if (!this.stages.has(name)) {
      throw new Error(
        `StageRegistry: cannot replace "${name}" — not registered. Use register() first.`,
      );
    }
    this.stages.set(name, newStage);
    return this;
  }

  /** Register or replace — upsert semantics. */
  set<TInput, TOutput>(stage: Stage<TInput, TOutput>): this {
    this.stages.set(stage.name, stage);
    return this;
  }

  /** Remove a stage by name. Returns true if it was found and removed. */
  remove(name: string): boolean {
    return this.stages.delete(name);
  }

  /**
   * Wrap an existing stage with middleware.
   * The middleware receives the current stage and must return a new stage
   * (with the same name) that delegates to the original.
   */
  wrap(name: string, middleware: StageMiddleware): this {
    const current = this.require(name);
    const wrapped = middleware(current);
    // Ensure the wrapper keeps the original name
    if (wrapped.name !== current.name) {
      throw new Error(
        `StageRegistry.wrap: middleware must preserve stage name "${current.name}", got "${wrapped.name}"`,
      );
    }
    this.stages.set(name, wrapped);
    return this;
  }

  /** List all registered stage names. */
  names(): string[] {
    return Array.from(this.stages.keys());
  }

  /** Iterate all registered stages. */
  [Symbol.iterator](): IterableIterator<Stage<any, any>> {
    return this.stages.values();
  }

  /** Get count of registered stages. */
  get size(): number {
    return this.stages.size;
  }

  /** Clear all registered stages. */
  clear(): void {
    this.stages.clear();
  }

  /** Create a shallow clone of this registry. */
  clone(): StageRegistry {
    const copy = new StageRegistry();
    for (const [name, stage] of this.stages) {
      copy.stages.set(name, stage);
    }
    return copy;
  }
}

// ---------------------------------------------------------------------------
// Convenience: logging middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a middleware that logs stage start/end via the context logger.
 * Useful as an example and for debugging.
 */
export function withLogging<TInput, TOutput>(
  next: Stage<TInput, TOutput>,
): Stage<TInput, TOutput> {
  return {
    name: next.name,
    description: next.description,
    retryPolicy: next.retryPolicy,
    canRun: next.canRun?.bind(next),
    async run(input: TInput, ctx: PipelineContext): Promise<TOutput> {
      ctx.logger.debug(`→ ${next.name} starting`);
      const t0 = Date.now();
      const result = await next.run(input, ctx);
      ctx.logger.debug(`← ${next.name} completed (${Date.now() - t0}ms)`);
      return result;
    },
  };
}
