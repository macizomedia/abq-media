/**
 * @module events
 * Typed event definitions for the pipeline system.
 *
 * The core uses Node's EventEmitter with string event names.
 * This module defines the payload shapes and a typed emitter wrapper.
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface StageStartEvent {
  stageName: string;
  input?: unknown;
}

export interface StageProgressEvent {
  stageName: string;
  message: string;
  /** Optional 0–100 percentage. */
  percent?: number;
  /** Optional structured detail (e.g. chunk index). */
  detail?: Record<string, unknown>;
}

export interface StageCompleteEvent {
  stageName: string;
  output?: unknown;
  durationMs: number;
}

export interface StageErrorEvent {
  stageName: string;
  error: Error;
  /** True if the runner will retry this stage. */
  willRetry: boolean;
}

export interface StageSkipEvent {
  stageName: string;
  reason: string;
}

export interface PipelineStartEvent {
  runId: string;
  stageNames: string[];
}

export interface PipelineCompleteEvent {
  runId: string;
  artifacts: Map<string, string>;
  metadata: Record<string, unknown>;
  durationMs: number;
}

export interface PipelineErrorEvent {
  runId: string;
  error: Error;
  completedStages: string[];
}

// ---------------------------------------------------------------------------
// Event name → payload mapping
// ---------------------------------------------------------------------------

export interface PipelineEventMap {
  'stage:start': StageStartEvent;
  'stage:progress': StageProgressEvent;
  'stage:complete': StageCompleteEvent;
  'stage:error': StageErrorEvent;
  'stage:skip': StageSkipEvent;
  'pipeline:start': PipelineStartEvent;
  'pipeline:complete': PipelineCompleteEvent;
  'pipeline:error': PipelineErrorEvent;
}

// ---------------------------------------------------------------------------
// Typed emitter
// ---------------------------------------------------------------------------

/**
 * A strongly-typed EventEmitter.
 * Consumers get autocomplete on event names and payloads.
 */
export class PipelineEmitter {
  private ee = new EventEmitter();

  /** Set maximum listeners (default 20 to allow many stage subscriptions). */
  constructor(maxListeners = 20) {
    this.ee.setMaxListeners(maxListeners);
  }

  on<K extends keyof PipelineEventMap>(
    event: K,
    listener: (payload: PipelineEventMap[K]) => void,
  ): this {
    this.ee.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof PipelineEventMap>(
    event: K,
    listener: (payload: PipelineEventMap[K]) => void,
  ): this {
    this.ee.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof PipelineEventMap>(
    event: K,
    listener: (payload: PipelineEventMap[K]) => void,
  ): this {
    this.ee.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof PipelineEventMap>(event: K, payload: PipelineEventMap[K]): boolean {
    return this.ee.emit(event, payload);
  }

  removeAllListeners(event?: keyof PipelineEventMap): this {
    this.ee.removeAllListeners(event);
    return this;
  }
}
