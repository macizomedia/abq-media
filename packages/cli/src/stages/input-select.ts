/**
 * @module stages/input-select
 * INPUT_SELECT — Prompt user to choose input type.
 *
 * Extracted from monolith cmdRun() L940–L945.
 *
 * Input context:
 *   - `projectName`, `runDir` — set by PROJECT_INIT
 *
 * Output context:
 *   - `inputType` — one of 'youtube' | 'audio' | 'textfile' | 'raw'
 *
 * Next state: Determined by the transition map based on `inputType`.
 *   youtube  → INPUT_YOUTUBE
 *   audio    → INPUT_AUDIO
 *   textfile → INPUT_TEXT
 *   raw      → INPUT_TEXT
 */

import type { CLIContext, InputType, State, StageResult } from '../machine/types.js';
import { clack, unwrapCancel } from '../ui/prompts.js';
import { getNextState } from '../machine/transitions.js';

export async function inputSelect(ctx: CLIContext): Promise<StageResult> {
  const choice = await clack.select({
    message: 'Select input type',
    options: [
      { value: 'youtube' as const, label: 'YouTube URL' },
      { value: 'audio' as const, label: 'Audio file' },
      { value: 'textfile' as const, label: 'Text file' },
      { value: 'raw' as const, label: 'Raw text' },
    ],
  });
  const inputType = unwrapCancel(choice, 'INPUT_SELECT') as InputType;

  const updated: CLIContext = {
    ...ctx,
    inputType,
    currentState: 'INPUT_SELECT',
    stateHistory: [...ctx.stateHistory, 'INPUT_SELECT'],
  };

  const resolved = getNextState('INPUT_SELECT', updated);
  // INPUT_SELECT's dynamic transition always yields a single State (not an array)
  const nextState = (Array.isArray(resolved) ? resolved[0] : resolved) as State;

  return {
    nextState,
    context: { ...updated, currentState: nextState },
  };
}
