/**
 * @module machine/types
 *
 * State definitions, context interface, and handler types for the CLI state machine.
 *
 * The CLI state machine manages user interaction, decisions, and review loops.
 * Heavy processing (LLM, ASR, TTS) is delegated to `@abquanta/abq-media-core`
 * Pipeline stages — those types are NOT duplicated here.
 *
 * @see {@link ../../.github/instructions/REFACTOR_PLAN.md} for architecture rationale
 */

// ---------------------------------------------------------------------------
// State — every possible position in the CLI flow
// ---------------------------------------------------------------------------

/**
 * All valid states the CLI pipeline can occupy.
 *
 * Naming: SCREAMING_SNAKE matches the transition map keys
 * and checkpoint file names (`03-TRANSCRIPTION.json`).
 */
export type State =
  | 'PROJECT_INIT'
  | 'INPUT_SELECT'
  | 'INPUT_YOUTUBE'
  | 'INPUT_AUDIO'
  | 'INPUT_TEXT'
  | 'TRANSCRIPTION'
  | 'TRANSCRIPT_REVIEW'
  | 'PROCESSING_SELECT'
  | 'RESEARCH_PROMPT_GEN'
  | 'RESEARCH_EXECUTE'
  | 'ARTICLE_GENERATE'
  | 'ARTICLE_REVIEW'
  | 'TRANSLATE'
  | 'OUTPUT_SELECT'
  | 'SCRIPT_GENERATE'
  | 'TTS_RENDER'
  | 'PACKAGE'
  | 'COMPLETE'
  | 'ERROR';

/** Terminal states — the runner stops when it reaches one of these. */
export const TERMINAL_STATES: ReadonlySet<State> = new Set<State>([
  'COMPLETE',
  'ERROR',
]);

/** All valid state values — useful for runtime validation. */
export const ALL_STATES: readonly State[] = [
  'PROJECT_INIT',
  'INPUT_SELECT',
  'INPUT_YOUTUBE',
  'INPUT_AUDIO',
  'INPUT_TEXT',
  'TRANSCRIPTION',
  'TRANSCRIPT_REVIEW',
  'PROCESSING_SELECT',
  'RESEARCH_PROMPT_GEN',
  'RESEARCH_EXECUTE',
  'ARTICLE_GENERATE',
  'ARTICLE_REVIEW',
  'TRANSLATE',
  'OUTPUT_SELECT',
  'SCRIPT_GENERATE',
  'TTS_RENDER',
  'PACKAGE',
  'COMPLETE',
  'ERROR',
] as const;

// ---------------------------------------------------------------------------
// Input types — how content enters the pipeline
// ---------------------------------------------------------------------------

/**
 * How the user feeds content into the pipeline.
 *
 * - `youtube` — YouTube URL → ingest + transcribe
 * - `audio` — local audio file → ASR transcription
 * - `textfile` — local `.txt` / `.md` file
 * - `raw` — paste text directly at the prompt
 *
 * `browse` was removed — run browsing will be a separate `abq-media browse` command.
 *
 * Values match the monolith's `prompts.select` option values.
 */
export type InputType =
  | 'youtube'
  | 'audio'
  | 'textfile'
  | 'raw';

// ---------------------------------------------------------------------------
// Processing types — what transformation to apply
// ---------------------------------------------------------------------------

/**
 * The content transformation the user wants.
 *
 * - `prompt` — generate the deep research prompt only
 * - `article` — generate prompt → brand inject → publish article
 * - `podcast_script` — generate or use existing prompt → podcast dialogue
 * - `reel_script` — generate or use existing prompt → short-form video script
 * - `translate` — translate transcript (stub, coming v1.1)
 * - `export` — use transcript only, no LLM processing
 * - `export_zip` — bundle all outputs into a zip
 *
 * `tts` was removed — TTS is only reachable via the SCRIPT_GENERATE → TTS_RENDER flow.
 *
 * Values match the monolith's menu `value` strings.
 */
export type ProcessingType =
  | 'prompt'
  | 'article'
  | 'podcast_script'
  | 'reel_script'
  | 'translate'
  | 'export'
  | 'export_zip';

// ---------------------------------------------------------------------------
// Output types — final deliverable format
// ---------------------------------------------------------------------------

/**
 * What kind of final output to package.
 *
 * - `podcast` — MP3 audio via TTS
 * - `article` — Markdown article
 * - `social_kit` — social posts for multiple platforms
 * - `export_zip` — zip bundle of all session artifacts
 */
export type OutputType =
  | 'podcast'
  | 'article'
  | 'social_kit'
  | 'export_zip';

// ---------------------------------------------------------------------------
// Tone presets — brand voice for article generation
// ---------------------------------------------------------------------------

/**
 * Tone presets available for brand injection before article generation.
 * Matches the monolith's tone selection options.
 */
export type TonePreset =
  | 'informative'
  | 'casual'
  | 'professional'
  | 'urgent';

// ---------------------------------------------------------------------------
// Run state stages — legacy flat checklist (for backward compat)
// ---------------------------------------------------------------------------

/**
 * Stage status in the legacy `state.json` checklist format.
 * Preserved so existing runs can still be read.
 */
export type LegacyStageStatus = 'pending' | 'done';

/** Shape of the legacy `state.json` written by the monolith. */
export interface LegacyRunState {
  stages: {
    transcribe: LegacyStageStatus;
    clean: LegacyStageStatus;
    summarize: LegacyStageStatus;
    reformat: LegacyStageStatus;
    brand_inject: LegacyStageStatus;
    final: LegacyStageStatus;
    /** Dynamic keys added at runtime: tts, podcast_script, reel_script, social_posts */
    [key: string]: LegacyStageStatus;
  };
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// CLI Context — the single state object threaded through every stage
// ---------------------------------------------------------------------------

/**
 * The complete state of a CLI pipeline run.
 *
 * This is NOT the same as core's `PipelineContext`. Core's context is for
 * stage execution (config, emitter, artifacts map). CLI's context tracks
 * the full user session: decisions, review states, file paths, and UI state.
 *
 * Context is serialized to JSON for checkpointing. `Error` fields are
 * converted to `{ message, stack }` during serialization.
 */
export interface CLIContext {
  // ── Meta ──────────────────────────────────────────────────────────────

  /** User-chosen project name. */
  projectName: string;

  /** Absolute path to the project directory (`~/.abq-media/projects/<name>`). */
  projectDir: string;

  /** Absolute path to this run's output directory. */
  runDir: string;

  /** Unique run identifier (ISO timestamp). */
  runId: string;

  /** When this run started. Serializes to ISO string in checkpoints. */
  startedAt: Date;

  /** The state the pipeline is currently in (or about to enter). */
  currentState: State;

  /** Ordered list of states visited so far. */
  stateHistory: State[];

  /** BCP-47 language code (default: `'es'`). */
  lang: string;

  // ── Input ─────────────────────────────────────────────────────────────

  /** How content was provided. Set by INPUT_SELECT. */
  inputType?: InputType;

  /** Absolute path to a local file input (audio or text). */
  inputPath?: string;

  /** YouTube URL when `inputType === 'youtube'`. */
  youtubeUrl?: string;

  /** Raw text content when `inputType === 'raw'`. */
  rawText?: string;

  // ── Transcription ─────────────────────────────────────────────────────

  /** Path to the raw transcript file. */
  transcriptPath?: string;

  /** Path to the cleaned transcript file. */
  cleanedTranscriptPath?: string;

  /** Path to the summary/talking-points file. */
  summaryPath?: string;

  // ── Processing ────────────────────────────────────────────────────────

  /** Which transformation the user selected. Set by PROCESSING_SELECT. */
  processingType?: ProcessingType;

  /** Path to the generated deep research prompt. */
  researchPromptPath?: string;

  /** Path to the executed research report. */
  reportPath?: string;

  /** Path to the generated article. */
  articlePath?: string;

  /** Translated text (future). */
  translatedText?: string;

  /** Brand injection notes path. */
  brandNotesPath?: string;

  /** Tone preset for article generation. */
  tonePreset?: TonePreset;

  // ── Output ────────────────────────────────────────────────────────────

  /** Final output format selection. Set by OUTPUT_SELECT. */
  outputType?: OutputType;

  /** Path to the generated podcast script. */
  podcastScriptPath?: string;

  /** Path to the generated reel/video script. */
  reelScriptPath?: string;

  /** Path to the generated social posts. */
  socialPostsPath?: string;

  /** Path to the rendered audio file (MP3). */
  audioPath?: string;

  // ── Final ─────────────────────────────────────────────────────────────

  /** All output file paths produced during this run. */
  outputFiles: string[];

  /** Path to the final zip package. */
  zipPath?: string;

  // ── Errors ────────────────────────────────────────────────────────────

  /** The last error encountered. Cleared when retrying. */
  lastError?: Error;

  // ── Config paths (resolved once, carried through) ─────────────────────

  /** Absolute path to the project config JSON. */
  configPath: string;

  /** Absolute path to the global credentials JSON. */
  credentialsPath: string;

  // ── Article review loop ───────────────────────────────────────────────

  /** How many article generation attempts have been made (max 3). */
  articleAttempts?: number;

  // ── Legacy compat ─────────────────────────────────────────────────────

  /** Legacy flat state.json — maintained for backward compat with existing runs. */
  legacyState?: LegacyRunState;
}

// ---------------------------------------------------------------------------
// Stage handler contract
// ---------------------------------------------------------------------------

/**
 * The result returned by every stage handler.
 *
 * - `nextState` — the state to transition to (validated against the transition map)
 * - `context` — the updated CLIContext (immutable pattern: spread + override)
 */
export interface StageResult {
  /** The next state to transition to. Must be valid per the transition map. */
  nextState: State;
  /** The updated context. Handlers should spread the input context and override fields. */
  context: CLIContext;
}

/**
 * A stage handler is an async function that:
 *
 * 1. Validates required context fields (guard clauses)
 * 2. Performs user interaction and/or delegates to core
 * 3. Returns the next state + updated context
 *
 * Handlers must NOT call other handlers directly — the runner manages sequencing.
 * Handlers must NOT throw — they return `nextState: 'ERROR'` with `lastError` set.
 */
export type StageHandler = (ctx: CLIContext) => Promise<StageResult>;

// ---------------------------------------------------------------------------
// Stage registry type
// ---------------------------------------------------------------------------

/**
 * Maps every non-terminal state to its handler.
 * Used by the runner to look up handlers at runtime.
 */
export type StageRegistry = {
  [S in Exclude<State, 'COMPLETE' | 'ERROR'>]: StageHandler;
};

// ---------------------------------------------------------------------------
// Transition types
// ---------------------------------------------------------------------------

/**
 * A transition can be either:
 * - A static array of valid next states (for states with fixed successors)
 * - A function that picks the next state based on context (for dynamic branching)
 */
export type TransitionRule = State[] | ((ctx: CLIContext) => State);

/**
 * The complete transition map for the CLI state machine.
 * Every state must have an entry. Terminal states map to empty arrays.
 */
export type TransitionMap = Record<State, TransitionRule>;

// ---------------------------------------------------------------------------
// Checkpoint types
// ---------------------------------------------------------------------------

/**
 * Serialized form of CLIContext for checkpointing.
 * `Error` becomes `{ message, stack }`, `Date` becomes ISO string.
 */
export interface SerializedCLIContext {
  /** All CLIContext fields, with Error/Date serialized. */
  [key: string]: unknown;
  /** The state at which this checkpoint was saved. */
  currentState: State;
  /** ISO timestamp of the checkpoint. */
  checkpointedAt: string;
  /** Index of this checkpoint in the run (0-based). */
  checkpointIndex: number;
}
