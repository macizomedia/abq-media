/**
 * @module machine/context
 * CLIContext factory and per-state validation.
 *
 * - `createInitialContext(opts)` — builds a fresh CLIContext with defaults
 * - `validateContextForState(ctx, state)` — guard that required fields exist
 *   before the runner enters a given state
 */

import type { CLIContext, State } from './types.js';
import {
  getProjectConfigPath,
  getProjectRunDir,
  getCredentialsPath,
} from '../utils/paths.js';
import { ensureDir } from '../utils/fs.js';
import { ValidationError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Options accepted by {@link createInitialContext}. */
export interface CreateContextOptions {
  /** Project name (required). */
  projectName: string;
  /** BCP-47 language code. Default: `'es'`. */
  lang?: string;
  /** Override starting state. Default: `'PROJECT_INIT'`. */
  initialState?: State;
}

/**
 * Build a brand-new `CLIContext` with sane defaults.
 *
 * Creates the run directory on disk and resolves all config paths.
 * This is the single entry point for constructing context — stages
 * and the runner should never build one by hand.
 */
export function createInitialContext(opts: CreateContextOptions): CLIContext {
  const projectName = opts.projectName;
  const lang = opts.lang ?? 'es';
  const initialState: State = opts.initialState ?? 'PROJECT_INIT';

  const runDir = getProjectRunDir(projectName);
  ensureDir(runDir);

  const now = new Date();
  const runId = now.toISOString().replace(/[:.]/g, '-');

  return {
    // Meta
    projectName,
    projectDir: runDir.replace(/\/runs\/[^/]+$/, ''),
    runDir,
    runId,
    startedAt: now,
    currentState: initialState,
    stateHistory: [initialState],
    lang,

    // Input — all undefined until INPUT_SELECT
    inputType: undefined,
    inputPath: undefined,
    youtubeUrl: undefined,
    rawText: undefined,

    // Transcription
    transcriptPath: undefined,
    cleanedTranscriptPath: undefined,
    summaryPath: undefined,

    // Processing
    processingType: undefined,
    researchPromptPath: undefined,
    reportPath: undefined,
    articlePath: undefined,
    translatedText: undefined,
    brandNotesPath: undefined,
    tonePreset: undefined,

    // Output
    outputType: undefined,
    podcastScriptPath: undefined,
    reelScriptPath: undefined,
    socialPostsPath: undefined,
    audioPath: undefined,

    // Final
    outputFiles: [],
    zipPath: undefined,

    // Errors
    lastError: undefined,

    // Config paths
    configPath: getProjectConfigPath(projectName),
    credentialsPath: getCredentialsPath(),

    // Article review loop
    articleAttempts: undefined,

    // Legacy compat
    legacyState: undefined,
  };
}

// ---------------------------------------------------------------------------
// Per-state validation
// ---------------------------------------------------------------------------

/**
 * Required context fields for each state (excluding terminal states).
 *
 * Map key = target state the runner is about to enter.
 * Value = list of CLIContext field names that must be truthy.
 *
 * If a state is not listed here, no special preconditions are enforced
 * (only the basic meta fields are always required).
 */
const STATE_PRECONDITIONS: Partial<Record<State, (keyof CLIContext)[]>> = {
  // After PROJECT_INIT, all meta fields must exist (enforced below).
  INPUT_SELECT: ['projectName', 'runDir'],

  // Before entering an input handler, inputType must be set.
  INPUT_YOUTUBE: ['inputType', 'youtubeUrl'],
  INPUT_AUDIO: ['inputType', 'inputPath'],
  INPUT_TEXT: ['inputType', 'inputPath'],

  // Transcription needs an input path or YouTube URL.
  TRANSCRIPTION: ['inputType'],

  // Transcript review needs the transcript.
  TRANSCRIPT_REVIEW: ['transcriptPath'],

  // Processing needs a transcript (or at least text input for textfile mode).
  PROCESSING_SELECT: ['projectName'],

  // Research prompt generation needs a transcript or input.
  RESEARCH_PROMPT_GEN: ['processingType'],

  // Research execution needs the generated prompt.
  RESEARCH_EXECUTE: ['researchPromptPath'],

  // Article generation needs processing type and transcript/prompt.
  ARTICLE_GENERATE: ['processingType'],

  // Article review needs the article.
  ARTICLE_REVIEW: ['articlePath'],

  // Translate needs a transcript.
  TRANSLATE: ['transcriptPath'],

  // Output selection — user must have done some processing first.
  OUTPUT_SELECT: ['projectName'],

  // Script generation (podcast or reel).
  SCRIPT_GENERATE: ['outputType'],

  // TTS needs a podcast script.
  TTS_RENDER: ['podcastScriptPath'],

  // Package needs at least one output file.
  PACKAGE: ['projectName'],
};

/**
 * Validate that the context has the required fields before entering `state`.
 *
 * @throws {ValidationError} if any required field is missing/falsy.
 */
export function validateContextForState(ctx: CLIContext, state: State): void {
  // Always require core meta fields.
  const metaFields: (keyof CLIContext)[] = ['projectName', 'runDir', 'runId'];
  for (const field of metaFields) {
    if (!ctx[field]) {
      throw new ValidationError(
        `Context field '${field}' is required before entering any state`,
        field,
        ctx[field],
      );
    }
  }

  // Check state-specific preconditions.
  const required = STATE_PRECONDITIONS[state];
  if (!required) return;

  for (const field of required) {
    if (!ctx[field]) {
      throw new ValidationError(
        `Context field '${field}' is required before entering state '${state}'`,
        field,
        ctx[field],
      );
    }
  }
}
