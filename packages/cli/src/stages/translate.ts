/**
 * @module stages/translate
 * TRANSLATE — Placeholder for translation support (coming in v1.1).
 *
 * Currently shows a user-facing message and routes to OUTPUT_SELECT.
 *
 * Next state: OUTPUT_SELECT
 */

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack } from '../ui/prompts.js';

export async function translate(ctx: CLIContext): Promise<StageResult> {
  clack.log.warn('Translation coming in v1.1. Export your transcript and use DeepL for now.');

  return {
    nextState: 'OUTPUT_SELECT',
    context: {
      ...ctx,
      currentState: 'OUTPUT_SELECT',
      stateHistory: [...ctx.stateHistory, 'TRANSLATE'],
    },
  };
}
