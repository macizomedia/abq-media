# abq-media CLI — Refactoring & Completion Guide

## Current State Analysis

### The Problem
- **1700 lines** in a single CLI file
- Multiple branching paths with implicit state
- Some paths incomplete (report → script gap)
- Hard to modify, test, or extend
- State transitions buried in nested conditionals

### The Solution
- **Explicit state machine** with typed states and transitions
- **Modular stage handlers** (one file per stage)
- **Pipeline composer** that wires stages together
- **Context object** that flows through the pipeline

---

## 1. State Machine Mapping

### Current Flow (As Described)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           abq-media run                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: PROJECT_INIT]                                                       │
│ Action: Prompt for project name                                             │
│ Output: ctx.projectName                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: INPUT_SELECT]                                                       │
│ Action: Select input type                                                   │
│ Options: raw_text | txt_file | audio | youtube_link                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────────┐
│ raw_text        │    │ txt_file        │    │ youtube_link | audio        │
│ → ctx.rawText   │    │ → ctx.rawText   │    │ → TRANSCRIPTION             │
└────────┬────────┘    └────────┬────────┘    └──────────────┬──────────────┘
         │                      │                            │
         └──────────────────────┴────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: TRANSCRIPTION] (conditional)                                        │
│ Action: Whisper API or YouTube captions                                     │
│ Output: ctx.transcript                                                      │
│ Skip if: input was raw_text or txt_file                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: PROCESSING_SELECT]                                                  │
│ Action: Choose processing path                                              │
│ Options: article | deep_research | translate | raw                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
     ┌──────────────┬───────────────┼───────────────┬──────────────┐
     │              │               │               │              │
     ▼              ▼               ▼               ▼              ▼
┌─────────┐  ┌───────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐
│ article │  │ translate │  │deep_research│  │   raw    │  │  script  │
│         │  │           │  │             │  │          │  │ (direct) │
└────┬────┘  └─────┬─────┘  └──────┬──────┘  └────┬─────┘  └────┬─────┘
     │             │               │              │              │
     ▼             ▼               ▼              │              │
┌─────────┐  ┌───────────┐  ┌─────────────┐      │              │
│ARTICLE_ │  │TRANSLATE_ │  │ RESEARCH_   │      │              │
│GENERATE │  │ EXECUTE   │  │ PROMPT_GEN  │      │              │
└────┬────┘  └─────┬─────┘  └──────┬──────┘      │              │
     │             │               │              │              │
     │             │               ▼              │              │
     │             │        ┌─────────────┐       │              │
     │             │        │ RESEARCH_   │       │              │
     │             │        │ EXECUTE     │◄──────┤              │
     │             │        │ (MISSING!)  │       │              │
     │             │        └──────┬──────┘       │              │
     │             │               │              │              │
     │             │               ▼              │              │
     │             │        ┌─────────────┐       │              │
     │             │        │ctx.report   │       │              │
     │             │        └──────┬──────┘       │              │
     │             │               │              │              │
     └─────────────┴───────────────┴──────────────┴──────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: OUTPUT_SELECT]                                                      │
│ Action: Choose output format                                                │
│ Options: podcast | video | article | social_kit                             │
│ ⚠️  Currently jumps here even when report not generated                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ podcast         │    │ video           │    │ social_kit      │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ SCRIPT_GENERATE │    │ VIDEO_SCRIPT_   │    │ KIT_GENERATE    │
│                 │    │ GENERATE        │    │                 │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         ▼                      ▼                      │
┌─────────────────┐    ┌─────────────────┐            │
│ TTS_ELEVENLABS  │    │ VIDEO_RENDER    │            │
│                 │    │ (future)        │            │
└────────┬────────┘    └────────┬────────┘            │
         │                      │                      │
         └──────────────────────┴──────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: PACKAGE]                                                            │
│ Action: Bundle outputs into .zip + social media kit                         │
│ Output: ctx.outputPath                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [STATE: COMPLETE]                                                           │
│ Action: Display summary, cleanup                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Identified Issues

### Issue 1: Missing State — RESEARCH_EXECUTE
```
deep_research path:
  RESEARCH_PROMPT_GEN → ??? → SCRIPT_GENERATE
                        ↑
                  This step is missing!
```

The deep research prompt is generated, but there's no step that actually:
1. Sends the prompt to the LLM
2. Receives and stores the report
3. Transitions to script generation

**Fix**: Add `RESEARCH_EXECUTE` stage that calls the LLM and produces `ctx.report`.

### Issue 2: Implicit State Transitions
The current code likely has patterns like:
```typescript
// BAD: State buried in conditionals
if (inputType === 'youtube') {
  const transcript = await getTranscript(url);
  if (processType === 'deep_research') {
    const prompt = generateResearchPrompt(transcript);
    // What happens next? Where does control flow?
  }
}
```

**Fix**: Explicit state machine with typed transitions.

### Issue 3: Context Bleeding
Variables are likely being passed around inconsistently:
```typescript
// BAD: Some stages expect transcript, others expect rawText
generateScript(transcript || rawText || report);
```

**Fix**: Single `PipelineContext` object with typed optional fields.

### Issue 4: No Rollback or Resume
If TTS fails at 80%, user has to restart from the beginning.

**Fix**: Checkpoint system that saves context at each stage.

---

## 3. Target Architecture

### Directory Structure
```
packages/cli/
├── src/
│   ├── index.ts                 # Entry point, command registration
│   ├── commands/
│   │   ├── init.ts              # abq-media init
│   │   ├── run.ts               # abq-media run (orchestrator)
│   │   └── config.ts            # abq-media config
│   │
│   ├── stages/                  # Individual pipeline stages
│   │   ├── index.ts             # Stage registry
│   │   ├── project-init.ts      # PROJECT_INIT
│   │   ├── input-select.ts      # INPUT_SELECT
│   │   ├── input-youtube.ts     # INPUT_YOUTUBE
│   │   ├── input-audio.ts       # INPUT_AUDIO
│   │   ├── input-text.ts        # INPUT_TEXT
│   │   ├── transcription.ts     # TRANSCRIPTION
│   │   ├── processing-select.ts # PROCESSING_SELECT
│   │   ├── research-prompt.ts   # RESEARCH_PROMPT_GEN
│   │   ├── research-execute.ts  # RESEARCH_EXECUTE ← NEW
│   │   ├── article-generate.ts  # ARTICLE_GENERATE
│   │   ├── translate.ts         # TRANSLATE
│   │   ├── output-select.ts     # OUTPUT_SELECT
│   │   ├── script-generate.ts   # SCRIPT_GENERATE
│   │   ├── tts-elevenlabs.ts    # TTS_ELEVENLABS
│   │   ├── video-script.ts      # VIDEO_SCRIPT_GENERATE
│   │   ├── package-output.ts    # PACKAGE
│   │   └── complete.ts          # COMPLETE
│   │
│   ├── machine/                 # State machine infrastructure
│   │   ├── types.ts             # State, Transition, Context types
│   │   ├── context.ts           # PipelineContext class
│   │   ├── transitions.ts       # Transition map
│   │   └── runner.ts            # Machine executor
│   │
│   ├── ui/                      # Clack prompt wrappers
│   │   ├── prompts.ts           # Reusable prompt patterns
│   │   ├── spinners.ts          # Progress indicators
│   │   └── messages.ts          # Formatted output
│   │
│   └── utils/
│       ├── checkpoint.ts        # Save/restore context
│       ├── validation.ts        # Input validation
│       └── errors.ts            # Custom error types
│
├── package.json
└── tsconfig.json
```

### Core Types

```typescript
// machine/types.ts

export type State =
  | 'PROJECT_INIT'
  | 'INPUT_SELECT'
  | 'INPUT_YOUTUBE'
  | 'INPUT_AUDIO'
  | 'INPUT_TEXT'
  | 'TRANSCRIPTION'
  | 'PROCESSING_SELECT'
  | 'RESEARCH_PROMPT_GEN'
  | 'RESEARCH_EXECUTE'
  | 'ARTICLE_GENERATE'
  | 'TRANSLATE'
  | 'OUTPUT_SELECT'
  | 'SCRIPT_GENERATE'
  | 'TTS_ELEVENLABS'
  | 'VIDEO_SCRIPT_GENERATE'
  | 'PACKAGE'
  | 'COMPLETE'
  | 'ERROR';

export type InputType = 'raw_text' | 'txt_file' | 'audio' | 'youtube_link';
export type ProcessingType = 'article' | 'deep_research' | 'translate' | 'raw' | 'script';
export type OutputType = 'podcast' | 'video' | 'article' | 'social_kit';

export interface PipelineContext {
  // Meta
  projectName: string;
  projectDir: string;
  startedAt: Date;
  currentState: State;
  stateHistory: State[];

  // Input
  inputType?: InputType;
  inputPath?: string;      // For file/audio inputs
  youtubeUrl?: string;
  rawText?: string;

  // Processing
  transcript?: string;
  transcriptLang?: string;
  processingType?: ProcessingType;
  researchPrompt?: string;
  report?: string;
  article?: string;
  translatedText?: string;

  // Output
  outputType?: OutputType;
  podcastScript?: string;
  videoScript?: string;
  audioPath?: string;
  videoPath?: string;

  // Final
  outputFiles: string[];
  zipPath?: string;

  // Errors
  lastError?: Error;
}

export interface StageResult {
  nextState: State;
  context: PipelineContext;
}

export type StageHandler = (ctx: PipelineContext) => Promise<StageResult>;
```

### Stage Handler Pattern

```typescript
// stages/research-execute.ts

import { intro, spinner, note } from '@clack/prompts';
import { State, PipelineContext, StageResult, StageHandler } from '../machine/types';
import { callLLM } from '@abquanta/abq-media-core';

export const researchExecute: StageHandler = async (ctx): Promise<StageResult> => {
  // Guard: Ensure we have the research prompt
  if (!ctx.researchPrompt) {
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: new Error('Research prompt not found. Cannot execute research.'),
      },
    };
  }

  const s = spinner();
  s.start('Executing deep research...');

  try {
    const report = await callLLM({
      prompt: ctx.researchPrompt,
      model: 'claude-sonnet-4-20250514', // or from config
      maxTokens: 4000,
    });

    s.stop('Research complete');

    note(
      `Generated ${report.length} characters of research`,
      'Deep Research Report'
    );

    return {
      nextState: 'OUTPUT_SELECT',
      context: {
        ...ctx,
        report,
        stateHistory: [...ctx.stateHistory, 'RESEARCH_EXECUTE'],
      },
    };
  } catch (error) {
    s.stop('Research failed');
    return {
      nextState: 'ERROR',
      context: {
        ...ctx,
        lastError: error as Error,
      },
    };
  }
};
```

### Transition Map

```typescript
// machine/transitions.ts

import { State, PipelineContext } from './types';

type TransitionFn = (ctx: PipelineContext) => State;

// Defines valid transitions from each state
export const transitions: Record<State, TransitionFn | State[]> = {
  PROJECT_INIT: ['INPUT_SELECT'],

  INPUT_SELECT: (ctx) => {
    switch (ctx.inputType) {
      case 'youtube_link': return 'INPUT_YOUTUBE';
      case 'audio': return 'INPUT_AUDIO';
      case 'txt_file':
      case 'raw_text': return 'INPUT_TEXT';
      default: return 'ERROR';
    }
  },

  INPUT_YOUTUBE: ['TRANSCRIPTION'],
  INPUT_AUDIO: ['TRANSCRIPTION'],
  INPUT_TEXT: ['PROCESSING_SELECT'],

  TRANSCRIPTION: ['PROCESSING_SELECT'],

  PROCESSING_SELECT: (ctx) => {
    switch (ctx.processingType) {
      case 'deep_research': return 'RESEARCH_PROMPT_GEN';
      case 'article': return 'ARTICLE_GENERATE';
      case 'translate': return 'TRANSLATE';
      case 'raw': return 'OUTPUT_SELECT';
      case 'script': return 'SCRIPT_GENERATE';
      default: return 'ERROR';
    }
  },

  RESEARCH_PROMPT_GEN: ['RESEARCH_EXECUTE'],
  RESEARCH_EXECUTE: ['OUTPUT_SELECT'],

  ARTICLE_GENERATE: ['OUTPUT_SELECT'],
  TRANSLATE: ['OUTPUT_SELECT'],

  OUTPUT_SELECT: (ctx) => {
    switch (ctx.outputType) {
      case 'podcast': return 'SCRIPT_GENERATE';
      case 'video': return 'VIDEO_SCRIPT_GENERATE';
      case 'article': return 'PACKAGE'; // Already have article
      case 'social_kit': return 'PACKAGE';
      default: return 'ERROR';
    }
  },

  SCRIPT_GENERATE: ['TTS_ELEVENLABS'],
  VIDEO_SCRIPT_GENERATE: ['PACKAGE'], // Video render is future
  TTS_ELEVENLABS: ['PACKAGE'],

  PACKAGE: ['COMPLETE'],
  COMPLETE: [], // Terminal state
  ERROR: [],    // Terminal state
};
```

### Machine Runner

```typescript
// machine/runner.ts

import { State, PipelineContext, StageHandler, StageResult } from './types';
import { transitions } from './transitions';
import { stageRegistry } from '../stages';
import { saveCheckpoint, loadCheckpoint } from '../utils/checkpoint';

export class PipelineRunner {
  private ctx: PipelineContext;
  private checkpointDir: string;

  constructor(initialContext: PipelineContext) {
    this.ctx = initialContext;
    this.checkpointDir = `${initialContext.projectDir}/.checkpoints`;
  }

  async run(): Promise<PipelineContext> {
    while (this.ctx.currentState !== 'COMPLETE' && this.ctx.currentState !== 'ERROR') {
      // Save checkpoint before each stage
      await saveCheckpoint(this.checkpointDir, this.ctx);

      // Get handler for current state
      const handler = stageRegistry[this.ctx.currentState];
      if (!handler) {
        throw new Error(`No handler registered for state: ${this.ctx.currentState}`);
      }

      // Execute stage
      const result = await handler(this.ctx);

      // Validate transition
      const validNextStates = this.getValidTransitions(this.ctx.currentState);
      if (!validNextStates.includes(result.nextState)) {
        throw new Error(
          `Invalid transition: ${this.ctx.currentState} → ${result.nextState}. ` +
          `Valid: ${validNextStates.join(', ')}`
        );
      }

      // Update context
      this.ctx = {
        ...result.context,
        currentState: result.nextState,
      };
    }

    return this.ctx;
  }

  private getValidTransitions(state: State): State[] {
    const transition = transitions[state];
    if (typeof transition === 'function') {
      // Dynamic transition - any state is potentially valid
      // The function will determine the actual next state
      return Object.keys(transitions) as State[];
    }
    return transition;
  }

  static async resume(checkpointPath: string): Promise<PipelineContext> {
    const ctx = await loadCheckpoint(checkpointPath);
    const runner = new PipelineRunner(ctx);
    return runner.run();
  }
}
```

---

## 4. Refactoring Strategy — Step by Step

### Phase 1: Extract Types (30 min)
Create `machine/types.ts` with all type definitions. This is non-breaking — just moving types.

### Phase 2: Create Context Class (1 hour)
Create `machine/context.ts` with factory function and validation. Replace scattered variables with context object.

### Phase 3: Extract Stages One by One (3-4 hours)
For each logical block in the 1700-line file:
1. Identify the state it represents
2. Extract to `stages/{state-name}.ts`
3. Implement `StageHandler` interface
4. Add to stage registry
5. Test in isolation

**Order of extraction** (dependency order):
1. `project-init.ts` — No dependencies
2. `input-select.ts` — No dependencies
3. `input-text.ts` — Depends on file reading
4. `input-youtube.ts` — Depends on YouTube adapter
5. `input-audio.ts` — Depends on audio utils
6. `transcription.ts` — Depends on Whisper
7. `processing-select.ts` — No dependencies
8. `research-prompt.ts` — Depends on LLM
9. `research-execute.ts` — NEW, depends on LLM
10. `article-generate.ts` — Depends on LLM
11. `translate.ts` — Depends on LLM
12. `output-select.ts` — No dependencies
13. `script-generate.ts` — Depends on LLM
14. `tts-elevenlabs.ts` — Depends on ElevenLabs
15. `package-output.ts` — Depends on archiver
16. `complete.ts` — No dependencies

### Phase 4: Wire Up Runner (1 hour)
Create `machine/runner.ts` and modify `commands/run.ts` to use it.

### Phase 5: Add Checkpoint System (1 hour)
Implement save/restore so users can resume failed pipelines.

### Phase 6: Test All Paths (2 hours)
Walk through each path manually:
- YouTube → Transcription → Deep Research → Report → Podcast
- Audio → Transcription → Article → Package
- Raw Text → Script → TTS → Package
- etc.

---

## 5. Agent Prompts for Refactoring

### PROMPT A: Extract Type Definitions

```markdown
# Task: Extract Type Definitions from CLI

## Context
You are refactoring a 1700-line CLI file (`packages/cli/src/cli.ts`) into a modular
architecture. First step: extract all type definitions.

## Instructions

1. Read the current CLI file and identify:
   - All TypeScript types/interfaces
   - All string literal unions (input types, processing types, etc.)
   - All configuration shapes

2. Create `packages/cli/src/machine/types.ts` with:
   - `State` union type (all possible states in the pipeline)
   - `InputType`, `ProcessingType`, `OutputType` unions
   - `PipelineContext` interface (all data that flows through the pipeline)
   - `StageHandler` type (function signature for stage handlers)
   - `StageResult` interface (what handlers return)

3. Update imports in the original CLI file to use the new types file.

## Constraints
- Do not change any logic, only extract types
- Ensure all existing code still compiles
- Add TSDoc comments to each type

## Expected Output
- `packages/cli/src/machine/types.ts` with all type definitions
- Updated imports in `packages/cli/src/cli.ts`
```

---

### PROMPT B: Extract Single Stage

```markdown
# Task: Extract Stage — {STAGE_NAME}

## Context
Continuing refactor of abq-media CLI. Extract the {STAGE_NAME} stage into its own module.

## Current Location
The logic for this stage is in `packages/cli/src/cli.ts` around lines {START}-{END}.
Look for the section that handles: {DESCRIPTION}

## Instructions

1. Create `packages/cli/src/stages/{stage-name}.ts`

2. Implement the `StageHandler` interface:
   ```typescript
   import { PipelineContext, StageResult, StageHandler } from '../machine/types';

   export const {stageName}: StageHandler = async (ctx): Promise<StageResult> => {
     // Extract logic here

     return {
       nextState: '{NEXT_STATE}',
       context: {
         ...ctx,
         // Updated fields
         stateHistory: [...ctx.stateHistory, '{STAGE_NAME}'],
       },
     };
   };
   ```

3. Move all @clack/prompts calls for this stage into the handler

4. Handle errors by returning `nextState: 'ERROR'` with `lastError` set

5. Add guard clauses at the top to validate required context fields

6. Export from `packages/cli/src/stages/index.ts`

## Stage Details
- **State Name**: {STAGE_NAME}
- **Required Context**: {REQUIRED_FIELDS}
- **Produces Context**: {PRODUCED_FIELDS}
- **Next State(s)**: {NEXT_STATES}

## Constraints
- Single responsibility: this file only handles {STAGE_NAME}
- No direct calls to other stages
- All external API calls must have try/catch
- Preserve existing @clack/prompts UX
```

---

### PROMPT C: Implement Missing Research Execute Stage

```markdown
# Task: Implement RESEARCH_EXECUTE Stage

## Context
The abq-media pipeline has a gap: after generating a research prompt (RESEARCH_PROMPT_GEN),
there's no stage that actually executes the research and produces a report.

## Requirements

1. Create `packages/cli/src/stages/research-execute.ts`

2. This stage must:
   - Read `ctx.researchPrompt` (generated by previous stage)
   - Call the LLM API with the research prompt
   - Store the result in `ctx.report`
   - Transition to `OUTPUT_SELECT`

3. Implementation details:
   - Use the LLM client from `@abquanta/abq-media-core`
   - Show a spinner during API call (may take 30-60 seconds)
   - Display a preview of the report (first 500 chars)
   - Offer to save the full report to a file
   - Handle API errors gracefully (rate limits, timeouts)

4. LLM Configuration:
   - Read model preference from `abq.config.ts`
   - Default to Claude claude-sonnet-4-20250514 via OpenRouter
   - Support max_tokens configuration
   - Enable streaming for progress feedback

## Expected Behavior
```
┌ Deep Research
│
◇ Executing research prompt...
│ ████████████████████░░░░░░░░░░ 67%
│
◇ Research complete!
│
│ Preview:
│ ─────────────────────────────────────────
│ The geopolitical implications of rare earth
│ mineral deposits in Venezuela represent a
│ significant factor in global supply chain...
│ ─────────────────────────────────────────
│
◇ Full report saved to: ./project/research-report.md
│
└ Continuing to output selection...
```

## Error Handling
- If LLM returns empty: retry once with increased temperature
- If rate limited: wait and retry with exponential backoff
- If timeout: offer to retry or skip research phase
- Always preserve partial results if possible

## File Structure
```typescript
// stages/research-execute.ts
import { spinner, note, confirm } from '@clack/prompts';
import { PipelineContext, StageResult, StageHandler } from '../machine/types';
import { callLLM, LLMConfig } from '@abquanta/abq-media-core';
import { writeFile } from 'fs/promises';
import { join } from 'path';

export const researchExecute: StageHandler = async (ctx): Promise<StageResult> => {
  // Implementation here
};
```
```

---

### PROMPT D: Create Machine Runner

```markdown
# Task: Implement Pipeline State Machine Runner

## Context
All stages have been extracted. Now implement the orchestrator that runs them.

## Requirements

1. Create `packages/cli/src/machine/runner.ts`

2. The `PipelineRunner` class must:
   - Accept initial `PipelineContext`
   - Execute stages in sequence based on `transitions` map
   - Validate each transition before executing
   - Save checkpoints after each successful stage
   - Handle terminal states (COMPLETE, ERROR)
   - Support resumption from checkpoint

3. Implement checkpoint system:
   - Save context as JSON to `.checkpoints/{timestamp}.json`
   - Include state history for debugging
   - Provide `resume()` static method

4. Implement transition validation:
   - For static transitions: check if next state is in allowed list
   - For dynamic transitions: execute transition function
   - Throw descriptive error on invalid transition

## Expected API
```typescript
// Normal run
const runner = new PipelineRunner(initialContext);
const result = await runner.run();

// Resume from failure
const result = await PipelineRunner.resume('./project/.checkpoints/latest.json');
```

## Implementation
```typescript
// machine/runner.ts
import { State, PipelineContext, StageResult } from './types';
import { transitions } from './transitions';
import { stageRegistry } from '../stages';

export class PipelineRunner {
  // Implementation here
}
```

## Edge Cases
- Stage handler throws: catch, set ERROR state, preserve error in context
- Stage returns invalid next state: throw with clear message
- Checkpoint write fails: log warning, continue execution
- No handler for state: throw immediately (developer error)
```

---

### PROMPT E: Refactor Run Command

```markdown
# Task: Refactor `abq-media run` Command

## Context
The stages are extracted, the runner is ready. Now update the run command to use them.

## Current State
`packages/cli/src/commands/run.ts` (or the main cli.ts) has all logic inline.

## Requirements

1. Replace inline logic with `PipelineRunner`:
   ```typescript
   import { PipelineRunner } from '../machine/runner';
   import { createInitialContext } from '../machine/context';

   export async function runCommand(options: RunOptions) {
     const ctx = createInitialContext({
       projectName: options.name || await promptProjectName(),
     });

     const runner = new PipelineRunner(ctx);
     const result = await runner.run();

     if (result.currentState === 'ERROR') {
       handleError(result);
     } else {
       displaySummary(result);
     }
   }
   ```

2. Add `--resume` flag to continue from checkpoint:
   ```bash
   abq-media run --resume ./project/.checkpoints/latest.json
   ```

3. Add `--from` flag to start from specific state (for debugging):
   ```bash
   abq-media run --from TRANSCRIPTION --context ./context.json
   ```

4. Display clear progress through states:
   ```
   ┌ abq-media run
   │
   ◆ PROJECT_INIT ✓
   │
   ◆ INPUT_SELECT ✓
   │ Selected: youtube_link
   │
   ◆ INPUT_YOUTUBE ✓
   │ Video: "Title of the video"
   │
   ◇ TRANSCRIPTION (current)
   │ ████████░░░░░░░░░░░░ 40%
   │
   ○ PROCESSING_SELECT (pending)
   ○ RESEARCH_PROMPT_GEN (pending)
   ○ RESEARCH_EXECUTE (pending)
   ○ OUTPUT_SELECT (pending)
   ○ SCRIPT_GENERATE (pending)
   ○ TTS_ELEVENLABS (pending)
   ○ PACKAGE (pending)
   ```

## File Structure
```typescript
// commands/run.ts
import { Command } from 'commander';
import { intro, outro } from '@clack/prompts';
import { PipelineRunner } from '../machine/runner';

export const runCommand = new Command('run')
  .description('Run content transformation pipeline')
  .option('-n, --name <name>', 'Project name')
  .option('--resume <checkpoint>', 'Resume from checkpoint')
  .option('--from <state>', 'Start from specific state (debug)')
  .option('--context <file>', 'Load context from file')
  .action(async (options) => {
    // Implementation
  });
```
```

---

### PROMPT F: Add Social Media Kit Generation

```markdown
# Task: Implement Social Media Kit Generator

## Context
After generating outputs (podcast, article, video), create a social media kit
with optimized versions for each platform.

## Requirements

1. Create `packages/cli/src/stages/social-kit-generate.ts`

2. Generate assets for each platform:

   **YouTube**:
   - Thumbnail (1280x720)
   - Title (max 100 chars)
   - Description (with timestamps)
   - Tags (max 500 chars total)

   **Instagram**:
   - Square image (1080x1080)
   - Carousel images (up to 10)
   - Caption (max 2200 chars, with hashtags)
   - Reels cover image

   **Substack**:
   - Header image (1456x816)
   - Newsletter excerpt (max 280 chars)
   - SEO description

   **Twitter/X**:
   - Thread version of content
   - Image (1200x675)
   - Tweet text (max 280 chars)

   **SoundCloud** (for podcasts):
   - Waveform image (1400x1400)
   - Description
   - Tags

3. Output structure:
   ```
   project/social-kit/
   ├── youtube/
   │   ├── thumbnail.png
   │   ├── title.txt
   │   ├── description.txt
   │   └── tags.txt
   ├── instagram/
   │   ├── square.png
   │   ├── carousel-1.png
   │   ├── caption.txt
   │   └── hashtags.txt
   ├── substack/
   │   ├── header.png
   │   ├── excerpt.txt
   │   └── seo.txt
   ├── twitter/
   │   ├── image.png
   │   └── thread.txt
   └── manifest.json
   ```

4. The `manifest.json` should contain:
   - Platform-specific metadata
   - Optimal posting times (from config)
   - Character counts and validation status

## Implementation Notes
- Use Sharp for image resizing
- Use LLM to generate platform-specific copy
- Validate all character limits
- Warn if any content is truncated
```

---

### PROMPT G: Final Integration & Testing

```markdown
# Task: Final Integration and Testing

## Context
All components are built. Now verify the complete system works.

## Requirements

1. **Create test fixtures**:
   ```
   packages/cli/test/fixtures/
   ├── sample-youtube-url.txt      # Known working YouTube URL
   ├── sample-transcript.txt       # Pre-transcribed content
   ├── sample-audio.mp3            # Short audio file
   └── sample-research-prompt.txt  # Research prompt example
   ```

2. **Write integration tests** for each path:

   Path A: YouTube → Transcript → Deep Research → Podcast
   ```typescript
   test('youtube to podcast pipeline', async () => {
     const ctx = createInitialContext({ projectName: 'test-a' });
     ctx.inputType = 'youtube_link';
     ctx.youtubeUrl = 'https://youtube.com/watch?v=...';
     ctx.processingType = 'deep_research';
     ctx.outputType = 'podcast';

     const runner = new PipelineRunner(ctx);
     const result = await runner.run();

     expect(result.currentState).toBe('COMPLETE');
     expect(result.audioPath).toBeDefined();
     expect(result.zipPath).toBeDefined();
   });
   ```

   Path B: Raw Text → Script → TTS
   Path C: Audio → Transcription → Article
   Path D: Text → Translate → Social Kit

3. **Test error recovery**:
   - Simulate API failure mid-pipeline
   - Verify checkpoint is saved
   - Test resume from checkpoint
   - Verify no duplicate work

4. **Test state machine validity**:
   - No unreachable states
   - No infinite loops
   - All paths reach terminal state

5. **Performance benchmarks**:
   - Time each stage
   - Identify bottlenecks
   - Log API call durations

## Validation Checklist
- [ ] All states have handlers
- [ ] All transitions are valid
- [ ] Error state captures all failures
- [ ] Checkpoints save correctly
- [ ] Resume works from any state
- [ ] Output files are correct format
- [ ] Social kit has all platforms
- [ ] Zip file is valid
```

---

## 6. Publishing Checklist

### Package.json Updates
```json
{
  "name": "@abquanta/abq-media-cli",
  "version": "0.1.0",
  "description": "Transform any content into podcasts, articles, and videos",
  "bin": {
    "abq-media": "./dist/index.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "cli",
    "podcast",
    "content",
    "ai",
    "youtube",
    "transcription"
  ],
  "repository": {
    "type": "git",
    "url": "https://github.com/abquanta/abq-media-workspace"
  },
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### Pre-publish Checklist
- [ ] All tests pass
- [ ] README has clear installation instructions
- [ ] LICENSE file present (MIT)
- [ ] CHANGELOG.md updated
- [ ] Version bumped appropriately
- [ ] `npm run build` succeeds
- [ ] `npx @abquanta/abq-media-cli --help` works
- [ ] Sensitive defaults removed (no hardcoded API keys)
- [ ] Error messages are user-friendly
- [ ] Telemetry/analytics disclosed (if any)

### npm publish
```bash
# Dry run first
npm publish --dry-run

# Actual publish
npm publish --access public
```

---

## 7. Summary

### What You Have
- Working 1700-line CLI with all features
- Solid core library (`@abquanta/abq-media-core`)
- Multiple paths (YouTube, audio, text → various outputs)

### What You Need
1. **Type extraction** — Move all types to `machine/types.ts`
2. **Stage extraction** — One file per state (17 files)
3. **Missing stage** — `RESEARCH_EXECUTE` to close the gap
4. **State machine runner** — Orchestrates stages with checkpoints
5. **Testing** — Verify all paths work
6. **Social kit** — Generate platform-specific assets
7. **Publishing** — Package for npm

### Estimated Time
| Task | Time |
|------|------|
| Type extraction | 30 min |
| Stage extraction (17 stages) | 4 hours |
| Missing research execute | 1 hour |
| Machine runner | 1 hour |
| Checkpoint system | 1 hour |
| Testing all paths | 2 hours |
| Social kit generator | 2 hours |
| Publishing prep | 1 hour |
| **Total** | **~13 hours** |

The agent prompts are designed to be fed sequentially. Start with Prompt A (types), then B repeatedly (one per stage), then C through G.