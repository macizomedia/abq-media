# CLI Refactoring Execution Plan

> Generated: 2026-02-23
> Based on: `REFACTOR.instructions.md`
> Decisions: TypeScript migration, CLI state machine wraps core Pipeline, plan-only, rename monolith immediately

---

## Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Migrate CLI to TypeScript (`.ts`) | Aligns with core package; enables typed state machine, typed context, compile-time safety |
| D2 | CLI state machine wraps core `Pipeline` | CLI handles UI/prompts/decisions/checkpoints; core handles processing work (LLM, ASR, TTS) |
| D3 | Rename `cli.js` → `cli.monolith.js` immediately | New modular structure owns `cli.ts` from the start |
| D4 | Delete `cli.legacy.js` | Dead code (1590 lines, no imports from core), already superseded by `cli.js` |

---

## Architecture: Two-Layer Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLI State Machine (packages/cli/src/)                                  │
│                                                                         │
│  machine/runner.ts        — Executes states, validates transitions      │
│  machine/types.ts         — State, InputType, ProcessingType, etc.      │
│  machine/context.ts       — CLIContext factory + validation             │
│  machine/transitions.ts   — State → State transition map                │
│  stages/*.ts              — One handler per state (UI + prompts)        │
│  utils/checkpoint.ts      — Save/restore CLIContext as JSON             │
│                                                                         │
│  Delegates heavy work to:                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  @abquanta/abq-media-core                                      │    │
│  │  Pipeline({ stages: [...] })   — Sequential stage runner       │    │
│  │  Stage<I,O>                    — Typed processing units        │    │
│  │  Providers (LLM, ASR, TTS)    — API abstraction               │    │
│  │  Events                        — Progress/error feedback       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**The CLI state machine does NOT replace core's `Pipeline`.**
- CLI states manage user interaction, decisions, review loops, and file I/O.
- When a state needs LLM/ASR/TTS work, it constructs a core `Pipeline` with the appropriate stages, subscribes to its events for spinner/progress feedback, and awaits the result.
- Example: `TRANSCRIPTION` state → builds `Pipeline({ stages: [youtubeIngestStage, digestStage] })` → runs it → stores artifacts in `CLIContext`.

---

## Phase 0: Prep (Housekeeping)

| Step | Action | Files |
|------|--------|-------|
| 0.1 | Rename `packages/cli/src/cli.js` → `packages/cli/src/cli.monolith.js` | `mv` command |
| 0.2 | Delete `packages/cli/src/cli.legacy.js` | `rm` command |
| 0.3 | Update `packages/cli/src/index.js` to not export the monolith | Edit barrel |
| 0.4 | Add TypeScript to CLI: `tsconfig.json`, add `typescript` + `@types/node` deps | New files |
| 0.5 | Update `package.json` bin to point to `dist/cli.js`, add build script | Edit pkg |
| 0.6 | Verify `npm run build` works (empty CLI compiles) | Terminal |
| 0.7 | Create directory scaffold for new structure | `mkdir -p` |

### Directory scaffold (Phase 0.7):
```
packages/cli/src/
├── cli.ts                    # NEW entry point (minimal — parses args, delegates)
├── cli.monolith.js           # RENAMED old monolith (reference only)
├── index.ts                  # NEW barrel export
├── commands/
│   ├── init.ts
│   ├── run.ts
│   ├── doctor.ts
│   ├── reset.ts
│   └── config.ts
├── machine/
│   ├── types.ts
│   ├── context.ts
│   ├── transitions.ts
│   └── runner.ts
├── stages/
│   ├── index.ts              # Stage registry
│   ├── project-init.ts
│   ├── input-select.ts
│   ├── input-youtube.ts
│   ├── input-audio.ts
│   ├── input-text.ts
│   ├── transcription.ts
│   ├── transcript-review.ts
│   ├── processing-select.ts
│   ├── research-prompt.ts
│   ├── research-execute.ts   # NEW — closes the gap
│   ├── article-generate.ts
│   ├── article-review.ts
│   ├── translate.ts
│   ├── output-select.ts
│   ├── script-generate.ts
│   ├── tts-render.ts
│   ├── package-output.ts
│   └── complete.ts
├── ui/
│   ├── prompts.ts
│   ├── spinners.ts
│   └── messages.ts
└── utils/
    ├── checkpoint.ts
    ├── validation.ts
    ├── errors.ts
    ├── paths.ts              # All getProjectDir/getRunDir/etc. helpers
    ├── registry.ts           # Transcript cache registry
    └── fs.ts                 # readJson/writeJson/ensureDir wrappers
```

---

## Phase 1: Extract Types (`machine/types.ts`)

**Estimated: 30 min | Dependencies: Phase 0 | Risk: Low**

### 1.1 Define State enum

States extracted from the monolith's `cmdRun()` flow + the missing `RESEARCH_EXECUTE`:

```typescript
export type State =
  | 'PROJECT_INIT'
  | 'INPUT_SELECT'
  | 'INPUT_YOUTUBE'
  | 'INPUT_AUDIO'
  | 'INPUT_TEXT'
  | 'TRANSCRIPTION'
  | 'TRANSCRIPT_REVIEW'     // ← from monolith (review/edit loops)
  | 'PROCESSING_SELECT'
  | 'RESEARCH_PROMPT_GEN'
  | 'RESEARCH_EXECUTE'       // ← NEW (closes gap)
  | 'ARTICLE_GENERATE'
  | 'ARTICLE_REVIEW'         // ← from monolith (3-try approval loop)
  | 'TRANSLATE'
  | 'OUTPUT_SELECT'
  | 'SCRIPT_GENERATE'
  | 'TTS_RENDER'
  | 'PACKAGE'
  | 'COMPLETE'
  | 'ERROR';
```

> **Note**: Two states added vs. the original plan:
> - `TRANSCRIPT_REVIEW` — the monolith has distinct review/edit loops for transcript, cleaned text, and summary
> - `ARTICLE_REVIEW` — the monolith has a 3-attempt approval loop for generated articles
>
> These exist as real inline logic today and should be explicit states.

### 1.2 Define input/processing/output type unions

```typescript
export type InputType = 'raw_text' | 'txt_file' | 'audio' | 'youtube_link' | 'previous_run';
export type ProcessingType = 'article' | 'deep_research' | 'translate' | 'raw' | 'podcast_script' | 'reel_script';
export type OutputType = 'podcast' | 'video' | 'article' | 'social_kit' | 'export_zip';
```

> **Note**: `previous_run` and `export_zip` added — they exist as real paths in the monolith (the "browse" and "export_zip" menu choices).
> `podcast_script` and `reel_script` added as processing types — in the monolith, these are menu options that go directly to generation.

### 1.3 Define `CLIContext` interface

The CLI context is NOT the same as core's `PipelineContext`. Core's context is for stage execution; CLI's context is for the full user session.

```typescript
export interface CLIContext {
  // Meta
  projectName: string;
  projectDir: string;
  runDir: string;
  runId: string;
  startedAt: Date;
  currentState: State;
  stateHistory: State[];
  lang: string;

  // Input
  inputType?: InputType;
  inputPath?: string;
  youtubeUrl?: string;
  rawText?: string;

  // Processing
  transcript?: string;
  cleanedTranscript?: string;
  summary?: string;
  processingType?: ProcessingType;
  researchPrompt?: string;
  report?: string;
  article?: string;
  translatedText?: string;

  // Output
  outputType?: OutputType;
  podcastScript?: string;
  reelScript?: string;
  socialPosts?: string;
  audioPath?: string;

  // Final
  outputFiles: string[];
  zipPath?: string;

  // Errors
  lastError?: Error;

  // Config (resolved once, carried through)
  configPath: string;
  credentialsPath: string;
}
```

### 1.4 Define handler types

```typescript
export interface StageResult {
  nextState: State;
  context: CLIContext;
}

export type StageHandler = (ctx: CLIContext) => Promise<StageResult>;
```

---

## Phase 2: Create Context & Utilities

**Estimated: 1 hour | Dependencies: Phase 1 | Risk: Low**

### 2.1 `machine/context.ts` — Factory + validation

- `createInitialContext(opts)` — builds a new `CLIContext` with defaults
- `validateContextForState(ctx, state)` — guards that required fields exist before entering a state
- Reuse path logic from monolith's helper functions

### 2.2 `utils/paths.ts` — Extract path helpers

Move all 10+ path functions from the monolith:
- `getGlobalDir()`, `getCredentialsPath()`, `getProjectsDir()`
- `getProjectConfigPath(name)`, `getProjectRunsDir(name)`, `getProjectExportsDir(name)`
- `getProjectRegistryPath(name)`, `getProjectRunDir(name, ts)`
- `resolveLatestProjectRun(name)`, `listProjectRuns(name)`

### 2.3 `utils/fs.ts` — Extract I/O helpers

- `readJson(path)`, `writeJson(path, data)`, `ensureDir(path)`
- `getSamplesDir()`

### 2.4 `utils/registry.ts` — Extract transcript cache

- `readRegistry(projectName)`, `writeRegistry(projectName, data)`
- `registryKey(input)`, `findRegistryEntry(projectName, key)`
- `upsertRegistryEntry(projectName, key, entry)`

### 2.5 `utils/errors.ts` — Custom error types

- `PipelineError` (wraps core errors with CLI context)
- `UserCancelledError` (for when user cancels a prompt)
- `CheckpointError`
- `ValidationError`

### 2.6 `utils/validation.ts` — Input validation

- `isValidYouTubeUrl(url)`
- `isValidAudioFile(path)` (checks extension + exists)
- `isValidTextFile(path)`

---

## Phase 3: Transition Map (`machine/transitions.ts`)

**Estimated: 30 min | Dependencies: Phase 1 | Risk: Low**

Define the complete transition map. Key design:
- Static transitions: `State → State[]` (fixed set of valid next states)
- Dynamic transitions: `State → (ctx: CLIContext) => State` (context-dependent)

### Transition table

| From State | → Next State(s) | Logic |
|-----------|-----------------|-------|
| `PROJECT_INIT` | `INPUT_SELECT` | Always |
| `INPUT_SELECT` | `INPUT_YOUTUBE` \| `INPUT_AUDIO` \| `INPUT_TEXT` | Based on `ctx.inputType` |
| `INPUT_YOUTUBE` | `TRANSCRIPTION` | Always |
| `INPUT_AUDIO` | `TRANSCRIPTION` | Always |
| `INPUT_TEXT` | `PROCESSING_SELECT` | Skip transcription |
| `TRANSCRIPTION` | `TRANSCRIPT_REVIEW` | Always |
| `TRANSCRIPT_REVIEW` | `PROCESSING_SELECT` | After user approves |
| `PROCESSING_SELECT` | `RESEARCH_PROMPT_GEN` \| `ARTICLE_GENERATE` \| `TRANSLATE` \| `OUTPUT_SELECT` \| `SCRIPT_GENERATE` | Based on `ctx.processingType` |
| `RESEARCH_PROMPT_GEN` | `RESEARCH_EXECUTE` | Always |
| `RESEARCH_EXECUTE` | `OUTPUT_SELECT` | Always (NEW) |
| `ARTICLE_GENERATE` | `ARTICLE_REVIEW` | Always |
| `ARTICLE_REVIEW` | `OUTPUT_SELECT` \| `ARTICLE_GENERATE` | Approve → continue, reject → retry (max 3) |
| `TRANSLATE` | `OUTPUT_SELECT` | Always |
| `OUTPUT_SELECT` | `SCRIPT_GENERATE` \| `PACKAGE` | Based on `ctx.outputType` |
| `SCRIPT_GENERATE` | `TTS_RENDER` \| `PACKAGE` | If podcast → TTS, else → package |
| `TTS_RENDER` | `PACKAGE` | Always |
| `PACKAGE` | `COMPLETE` | Always |
| `COMPLETE` | — | Terminal |
| `ERROR` | — | Terminal |

### Collision notes

**Collision 1: The monolith's menu loop vs. a linear state machine.**
The monolith has a `while(true)` loop in `cmdRun()` where the user can pick "article", "podcast_script", "reel_script", "tts", "export_zip", "browse", "done" repeatedly. The refactor plan assumes a linear flow.

**Resolution**: `OUTPUT_SELECT` can loop back to itself (add `OUTPUT_SELECT` as a valid next state from `PACKAGE`). This lets the user generate multiple outputs in one session: generate article → package → go back to output select → generate podcast → package → done. The `COMPLETE` state is reached only when user picks "done".

**Updated transitions**:
| `PACKAGE` | `OUTPUT_SELECT` \| `COMPLETE` | User chooses: generate more outputs or finish |

**Collision 2: `PROCESSING_SELECT` and `OUTPUT_SELECT` overlap in the monolith.**
The monolith's menu combines processing and output in a single list. The refactor plan separates them into two states.

**Resolution**: Keep them separate for clarity. `PROCESSING_SELECT` is "what kind of content transformation?" and `OUTPUT_SELECT` is "what format to render?". The monolith's "article" menu option maps to `PROCESSING_SELECT→article`, and its "podcast_script" maps to either `PROCESSING_SELECT→podcast_script` (direct to script generation) or `OUTPUT_SELECT→podcast` (when a report already exists).

---

## Phase 4: Stage Extraction

**Estimated: 4 hours | Dependencies: Phases 1-3 | Risk: Medium**

Extract stages one at a time from the monolith. Each stage:
1. Has guard clauses validating required context fields
2. Uses `@clack/prompts` for user interaction
3. Delegates to core `Pipeline` for processing work
4. Returns `{ nextState, context }` with updated fields
5. Sets `lastError` and returns `'ERROR'` on failure

### Extraction order (dependency-driven)

| # | Stage file | Source lines (approx) | Required context | Produces | Notes |
|---|-----------|----------------------|-----------------|----------|-------|
| 4.1 | `project-init.ts` | L875–L910 | — | `projectName`, `projectDir`, `runDir`, `configPath` | Prompt for project name, create dirs, load config |
| 4.2 | `input-select.ts` | L929–L945 | `projectName` | `inputType` | 6-option clack select |
| 4.3 | `input-text.ts` | L1011–L1028 | `inputType=raw_text\|txt_file` | `rawText`, `inputPath?` | Read file or prompt for text |
| 4.4 | `input-youtube.ts` | L997–L1001 | `inputType=youtube_link` | `youtubeUrl` | URL prompt + validation |
| 4.5 | `input-audio.ts` | L1003–L1006 | `inputType=audio` | `inputPath` | File path prompt + validation |
| 4.6 | `transcription.ts` | L1074–L1102 | `youtubeUrl\|inputPath` | `transcript`, `cleanedTranscript`, `summary` | Delegates to core: `Pipeline([ingestStage, digestStage])` |
| 4.7 | `transcript-review.ts` | L1125–L1220 | `transcript`, `cleanedTranscript`, `summary` | (updated fields) | Review/edit loops via editor |
| 4.8 | `processing-select.ts` | L1230–L1250 | `transcript\|rawText` | `processingType` | Menu: article, deep_research, podcast_script, reel_script, translate |
| 4.9 | `research-prompt.ts` | L1510–L1540 | `transcript\|rawText`, `processingType=deep_research` | `researchPrompt` | Delegates to core: `Pipeline([researchPromptStage])` |
| 4.10 | `research-execute.ts` | **NEW** | `researchPrompt` | `report` | Delegates to core LLM provider. Spinner + preview. **Closes the gap.** |
| 4.11 | `article-generate.ts` | L1560–L1595 | `report\|transcript\|rawText` | `article` | Delegates to core: `Pipeline([generateArticleStage])` |
| 4.12 | `article-review.ts` | L1630–L1680 | `article` | `article` (approved) | 3-attempt approve/reject/regenerate loop |
| 4.13 | `translate.ts` | stub | — | `translatedText` | Placeholder — "coming in v1.1" |
| 4.14 | `output-select.ts` | L1230–L1250 | (at least one content field) | `outputType` | Menu: podcast, article, social_kit, export_zip |
| 4.15 | `script-generate.ts` | L1400–L1470 | `report\|article\|transcript` | `podcastScript\|reelScript` | Delegates to core: `Pipeline([generatePodcastScriptStage])` |
| 4.16 | `tts-render.ts` | L1390–L1399 | `podcastScript` | `audioPath` | Delegates to core `ttsRenderStage` (replaces shell-out to adapter CLI) |
| 4.17 | `package-output.ts` | L766–L862 | `outputFiles` | `zipPath` | Bundle files into zip + social posts |
| 4.18 | `complete.ts` | L1256–L1266 | `zipPath` | — | Display summary, cleanup |

### Per-stage template

```typescript
// stages/{stage-name}.ts
import type { CLIContext, StageResult, StageHandler } from '../machine/types.js';
import { spinner, select, text, note, confirm } from '@clack/prompts';

export const stageName: StageHandler = async (ctx): Promise<StageResult> => {
  // 1. Guard clauses
  if (!ctx.requiredField) {
    return { nextState: 'ERROR', context: { ...ctx, lastError: new Error('...') } };
  }

  // 2. User interaction (prompts)
  // 3. Processing (delegate to core if needed)
  // 4. Update context + return next state

  return {
    nextState: 'NEXT_STATE',
    context: {
      ...ctx,
      producedField: result,
      stateHistory: [...ctx.stateHistory, 'STAGE_NAME'],
    },
  };
};
```

---

## Phase 5: Machine Runner (`machine/runner.ts`)

**Estimated: 1 hour | Dependencies: Phases 1-4 | Risk: Medium**

### 5.1 `PipelineRunner` class

```
constructor(initialContext: CLIContext)
async run(): Promise<CLIContext>
  - Loop: while not COMPLETE and not ERROR
  - Save checkpoint before each stage
  - Lookup handler from stage registry
  - Execute handler
  - Validate transition
  - Update context
static async resume(checkpointPath: string): Promise<CLIContext>
```

### 5.2 How the runner bridges to core

When a CLI stage needs heavy processing:

```typescript
// Inside stages/transcription.ts
import { Pipeline, youtubeIngestStage, digestStage, loadConfig } from '@abquanta/abq-media-core';

const pipeline = new Pipeline({
  name: 'transcription',
  stages: [youtubeIngestStage, digestStage],
  config: loadConfig(),
  outputDir: ctx.runDir,
});

// Subscribe to core events for spinner feedback
pipeline.on('stage:progress', (e) => s.message(e.message));

const result = await pipeline.run({ url: ctx.youtubeUrl, lang: ctx.lang });

// Extract artifacts into CLIContext
ctx.transcript = readFileSync(result.artifacts.get('transcript')!, 'utf-8');
```

### 5.3 Transition validation

For dynamic transitions, the runner calls the transition function with the current context, then validates the returned state is reachable. For static transitions, it checks the result is in the allowed list.

---

## Phase 6: Checkpoint System (`utils/checkpoint.ts`)

**Estimated: 1 hour | Dependencies: Phase 5 | Risk: Low**

### 6.1 Save checkpoints

- After each successful state transition, serialize `CLIContext` to JSON
- Path: `{projectDir}/runs/{runId}/.checkpoints/{stateIndex}-{stateName}.json`
- Large text fields (transcript, article, etc.) are saved as separate files and referenced by path

### 6.2 Restore from checkpoint

- Find the latest checkpoint JSON in the run directory
- Deserialize into `CLIContext`
- Resume from `ctx.currentState`

### 6.3 Resume command

```bash
abq-media run --resume                    # Resume latest run
abq-media run --resume ./path/to/checkpoint.json  # Resume specific
abq-media run --from PROCESSING_SELECT    # Skip to specific state (debug)
```

---

## Phase 7: Wire Up Commands

**Estimated: 1.5 hours | Dependencies: Phases 1-6 | Risk: Medium**

### 7.1 `commands/run.ts`

The new `run` command replaces the monolith's `cmdRun()`:

```typescript
export async function cmdRun(options: RunOptions) {
  const ctx = createInitialContext({ ... });
  const runner = new PipelineRunner(ctx);
  const result = await runner.run();
  // On COMPLETE: display summary
  // On ERROR: display error + resume hint
}
```

### 7.2 `commands/init.ts`

Extract monolith's `cmdInit()` (L49–L113). This one is mostly self-contained already.

### 7.3 `commands/doctor.ts`

Extract monolith's `cmdDoctor()` (L641–L684).

### 7.4 `commands/reset.ts`

Extract monolith's `cmdReset()` (L686–L754).

### 7.5 `cli.ts` — New entry point

Minimal: parse argv, dispatch to command handler.

```typescript
#!/usr/bin/env node
import { cmdInit } from './commands/init.js';
import { cmdRun } from './commands/run.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdReset } from './commands/reset.js';

const command = process.argv[2];
switch (command) {
  case 'init':    await cmdInit(); break;
  case 'run':     await cmdRun(); break;
  case 'doctor':  await cmdDoctor(); break;
  case 'reset':   await cmdReset(); break;
  default:        printHelp(); break;
}
```

---

## Phase 8: Testing

**Estimated: 2 hours | Dependencies: Phases 1-7 | Risk: Low**

### 8.1 Unit tests for state machine

- `machine/transitions.test.ts` — all states have valid transitions, no orphan states
- `machine/context.test.ts` — factory produces valid context, validation catches missing fields
- `machine/runner.test.ts` — mock handlers, verify execution order, verify checkpoints

### 8.2 Unit tests per stage

Each stage gets a test file that:
- Calls the handler with a mock context
- Verifies the returned `nextState`
- Verifies the context updates
- Tests error paths

### 8.3 Integration tests for full paths

| Path | States traversed |
|------|-----------------|
| A: YouTube → Podcast | PROJECT_INIT → INPUT_SELECT → INPUT_YOUTUBE → TRANSCRIPTION → TRANSCRIPT_REVIEW → PROCESSING_SELECT → RESEARCH_PROMPT_GEN → RESEARCH_EXECUTE → OUTPUT_SELECT → SCRIPT_GENERATE → TTS_RENDER → PACKAGE → COMPLETE |
| B: Text → Article | PROJECT_INIT → INPUT_SELECT → INPUT_TEXT → PROCESSING_SELECT → ARTICLE_GENERATE → ARTICLE_REVIEW → PACKAGE → COMPLETE |
| C: Audio → Script | PROJECT_INIT → INPUT_SELECT → INPUT_AUDIO → TRANSCRIPTION → TRANSCRIPT_REVIEW → PROCESSING_SELECT → SCRIPT_GENERATE → TTS_RENDER → PACKAGE → COMPLETE |
| D: Resume | Load checkpoint → Continue from saved state → COMPLETE |

### 8.4 `--debugger` mode

Reimplement the existing `--debugger` flag that uses sample data (no external calls). This exercises the state machine with canned data.

---

## Phase 9: RESEARCH_EXECUTE — The Missing Stage

**Estimated: 1 hour | Dependencies: Phase 4 | Risk: Medium**

This is the critical gap identified in the refactor plan. Currently:
- `RESEARCH_PROMPT_GEN` generates a deep research prompt
- The prompt gets passed directly to `runPublishDirect()` which generates content
- There is no step that **executes the research** and produces a **report**

### Implementation

```typescript
// stages/research-execute.ts
// 1. Read ctx.researchPrompt
// 2. Build core LLM call via createLLMProvider(loadConfig().llm)
// 3. Call LLM with research prompt (streaming for progress)
// 4. Store result in ctx.report
// 5. Preview first 500 chars
// 6. Save full report to {runDir}/research-report.md
// 7. Offer user: approve, edit, regenerate
// 8. Return nextState: 'OUTPUT_SELECT'
```

### Error handling
- Empty response → retry once with `temperature + 0.1`
- Rate limit (429) → exponential backoff (1s, 2s, 4s)
- Timeout → offer retry or skip
- Preserve partial results via checkpoint

---

## Phase 10: Clean Up

**Estimated: 30 min | Dependencies: All above | Risk: Low**

| Step | Action |
|------|--------|
| 10.1 | Delete `cli.monolith.js` (all logic extracted) |
| 10.2 | Update `package.json` bin/scripts to new build output |
| 10.3 | Update root `package.json` workspace scripts |
| 10.4 | Update `CLAUDE.md` with new CLI architecture |
| 10.5 | Run full test suite |
| 10.6 | Run `npm run lint` + fix issues |

---

## Dependency Graph

```
Phase 0 (Prep)
    │
    ▼
Phase 1 (Types) ─────────────────┐
    │                             │
    ▼                             │
Phase 2 (Context + Utils)         │
    │                             │
    ▼                             ▼
Phase 3 (Transitions) ───► Phase 4 (Stage Extraction — 18 stages)
    │                             │
    │                             │ includes
    │                             ▼
    │                       Phase 9 (RESEARCH_EXECUTE)
    │                             │
    ▼                             │
Phase 5 (Runner) ◄────────────────┘
    │
    ▼
Phase 6 (Checkpoints)
    │
    ▼
Phase 7 (Wire Commands)
    │
    ▼
Phase 8 (Testing)
    │
    ▼
Phase 10 (Clean Up)
```

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Core's `Pipeline` output format doesn't map cleanly to `CLIContext` fields | Medium | Write thin adapter functions in `utils/` that extract artifacts from `PipelineResult` into CLIContext |
| `@clack/prompts` doesn't have TypeScript types | Low | Install `@types/clack__prompts` or use the included types (clack ships types since v0.7) |
| Breaking change to the monolith during extraction | High | Keep monolith as `cli.monolith.js` for reference; new code is a clean implementation, not incremental edits |
| Circular dependency between stages and runner | Medium | Stages are pure functions that return data; runner imports the registry; no stage imports runner |
| TTS stage switch from shell-out to core stage | Medium | Test with same ElevenLabs key/config; the core `ttsRenderStage` already handles HOST_A/HOST_B parsing |

---

## Estimated Total

| Phase | Hours |
|-------|-------|
| 0 — Prep | 0.5 |
| 1 — Types | 0.5 |
| 2 — Context + Utils | 1.0 |
| 3 — Transitions | 0.5 |
| 4 — Stage Extraction (18) | 4.0 |
| 5 — Runner | 1.0 |
| 6 — Checkpoints | 1.0 |
| 7 — Wire Commands | 1.5 |
| 8 — Testing | 2.0 |
| 9 — RESEARCH_EXECUTE | 1.0 |
| 10 — Clean Up | 0.5 |
| **Total** | **~13.5 hours** |

---

## How to Execute

Feed phases sequentially. Each phase can be given as a prompt:

1. **Phase 0**: "Execute Phase 0 from REFACTOR_PLAN.md — housekeeping and scaffold"
2. **Phase 1**: "Execute Phase 1 — extract type definitions to `machine/types.ts`"
3. **Phase 2**: "Execute Phase 2 — create context factory and utility modules"
4. **Phase 3**: "Execute Phase 3 — implement transition map"
5. **Phase 4**: "Execute Phase 4 — extract stages 4.1 through 4.18 from monolith"
6. **Phase 5**: "Execute Phase 5 — implement PipelineRunner"
7. **Phase 6**: "Execute Phase 6 — add checkpoint save/restore"
8. **Phase 7**: "Execute Phase 7 — wire up cli.ts entry point and commands"
9. **Phase 8**: "Execute Phase 8 — write tests for all paths"
10. **Phase 9**: "Execute Phase 9 — implement RESEARCH_EXECUTE stage"
11. **Phase 10**: "Execute Phase 10 — clean up monolith and update docs"

Phase 4 can be split further: "Execute Phase 4 stages 4.1–4.5" (input stages), "Execute Phase 4 stages 4.6–4.7" (transcription), etc.
