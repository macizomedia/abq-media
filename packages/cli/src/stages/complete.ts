/**
 * @module stages/complete
 * COMPLETE — Display session summary and exit cleanly.
 *
 * Extracted from monolith cmdRun() L1256–L1266.
 *
 * This is the terminal happy-path state. It logs what was produced
 * and calls `clack.outro()`.
 *
 * Input context:
 *   - full CLIContext with all artifact paths
 *
 * Next state: COMPLETE (terminal — runner should stop)
 */

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack } from '../ui/prompts.js';

export async function complete(ctx: CLIContext): Promise<StageResult> {
  const summaryLines = [
    ctx.transcriptPath ? '\u2713 Transcript' : null,
    ctx.articlePath ? '\u2713 Article' : null,
    ctx.podcastScriptPath ? '\u2713 Podcast script' : null,
    ctx.reelScriptPath ? '\u2713 Reel script' : null,
    ctx.socialPostsPath ? '\u2713 Social posts' : null,
    ctx.audioPath ? '\u2713 Audio (MP3)' : null,
    ctx.zipPath ? '\u2713 Zip package' : null,
  ].filter(Boolean);

  if (summaryLines.length) {
    clack.note(summaryLines.join('\n'), 'Session complete');
  }

  clack.outro(`Output folder: ${ctx.runDir}`);

  return {
    nextState: 'COMPLETE',
    context: {
      ...ctx,
      currentState: 'COMPLETE',
      stateHistory: [...ctx.stateHistory, 'COMPLETE'],
    },
  };
}
