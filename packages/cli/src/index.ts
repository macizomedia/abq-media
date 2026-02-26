/**
 * @abquanta/abq-media-cli
 *
 * Barrel export — re-exports public API from the modular CLI.
 * Populated as stages and machine infrastructure land in subsequent phases.
 */

// Phase 1: State machine types
export {
  type State,
  type InputType,
  type ProcessingType,
  type OutputType,
  type TonePreset,
  type CLIContext,
  type StageResult,
  type StageHandler,
  type StageRegistry,
  type TransitionRule,
  type TransitionMap,
  type SerializedCLIContext,
  type LegacyStageStatus,
  type LegacyRunState,
  TERMINAL_STATES,
  ALL_STATES,
} from './machine/types.js';

// Phase 2: Context & utilities
export {
  createInitialContext,
  validateContextForState,
  type CreateContextOptions,
} from './machine/context.js';

export {
  ensureDir,
  readJson,
  writeJson,
  getSamplesDir,
} from './utils/fs.js';

export {
  getGlobalDir,
  getCredentialsPath,
  getProjectsDir,
  getProjectConfigPath,
  getProjectRunsDir,
  getProjectExportsDir,
  getProjectRegistryPath,
  getProjectRunDir,
  listProjects,
  resolveLatestProjectRun,
  listProjectRuns,
  getRunStatePath,
  readRunState,
  writeRunState,
  initRunState,
  resolveLatestPrepDir,
  resolveLatestPublishDir,
  resolveLatestPrepPrompt,
  type RunInfo,
} from './utils/paths.js';

export {
  readRegistry,
  writeRegistry,
  registryKey,
  findRegistryEntry,
  upsertRegistryEntry,
  type RegistryKeyInfo,
  type RegistryEntry,
} from './utils/registry.js';

export {
  getYouTubeId,
  isValidYouTubeUrl,
  isValidAudioFile,
  isValidTextFile,
  isOpenRouterKey,
  YouTubeUrl,
} from './utils/validation.js';

export {
  PipelineError,
  UserCancelledError,
  CheckpointError,
  ValidationError,
} from './utils/errors.js';

// Phase 3: Transition map
export {
  TRANSITIONS,
  getNextState,
  assertValidTransition,
} from './machine/transitions.js';

// Phase 4 pre-step: UI helpers
export {
  hasCmd,
  detectEditorCommand,
  openInEditor,
  editInTerminal,
  previewMarkdown,
  withSpinnerAsync,
  statusNote,
  reviewGate,
  unwrapCancel,
  clack,
} from './ui/prompts.js';

// Phase 5: Machine runner
export {
  PipelineRunner,
  createDefaultRegistry,
  type RunnerOptions,
} from './machine/runner.js';
