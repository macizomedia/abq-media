/**
 * @module stages/process/digest
 * Process stage: generate a digest of talking points from the transcript.
 *
 * Uses LLM when configured, falls back to term-frequency heuristic.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import type { IngestOutput } from '../ingest/index.js';
import { createLLMProvider } from '../../providers/llm.js';
import { writeText } from '../../utils/fs.js';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DigestOutput extends IngestOutput {
  digest: string;
  digestMode: string;
  talkingPoints: string[];
}

// ---------------------------------------------------------------------------
// Heuristic: term-frequency talking points
// ---------------------------------------------------------------------------

function sentenceSplit(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'have', 'were', 'they', 'their', 'about',
  'para', 'como', 'pero', 'porque', 'sobre', 'esta', 'este', 'esto', 'desde', 'cuando',
  'also', 'into', 'will', 'would', 'there', 'which', 'what', 'where', 'your', 'you', 'are',
]);

export function topTalkingPoints(text: string, maxPoints: number): string[] {
  const sentences = sentenceSplit(text);
  if (!sentences.length) return ['Insufficient transcript text to derive talking points.'];

  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
      if (STOP_WORDS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const scored = sentences.map((s) => {
    let score = 0;
    for (const w of s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
      score += freq.get(w) || 0;
    }
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const norm = row.s.toLowerCase().slice(0, 80);
    if (seen.has(norm)) continue;
    seen.add(norm);
    picked.push(row.s);
    if (picked.length >= maxPoints) break;
  }
  return picked;
}

function heuristicDigest(talkingPoints: string[]): string {
  return '# Main Talking Points\n\n' + talkingPoints.map((p) => `- ${p}`).join('\n');
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export const digestStage: Stage<IngestOutput, DigestOutput> = {
  name: 'process:digest',
  description: 'Generate talking-points digest (LLM or heuristic)',
  retryPolicy: { maxAttempts: 2, backoffMs: 2000 },

  async run(input, ctx) {
    const maxPoints = ctx.config.transcript.maxTalkingPoints;
    const talkingPoints = topTalkingPoints(input.transcript, maxPoints);

    let digest: string;
    let digestMode: string;

    // Try LLM
    if (ctx.config.llm.apiKey) {
      ctx.emitter.emit('stage:progress', {
        stageName: 'process:digest',
        message: `Generating digest via ${ctx.config.llm.provider}…`,
      });

      try {
        const provider = createLLMProvider(ctx.config.llm);
        const result = await provider.generate(
          {
            systemPrompt:
              'Summarize transcript into concise, high-signal talking points. Use bullets and avoid fluff.',
            prompt: `Transcript:\n${input.transcript.slice(0, ctx.config.llm.digestTruncation)}`,
          },
          ctx,
        );
        digest = `# Main Talking Points (LLM/${ctx.config.llm.provider})\n\n${result.text}`;
        digestMode = `llm-${ctx.config.llm.provider}`;
      } catch (err) {
        ctx.logger.warn(
          `LLM digest failed, falling back to heuristic: ${err instanceof Error ? err.message : String(err)}`,
        );
        ctx.emitter.emit('stage:progress', {
          stageName: 'process:digest',
          message: 'LLM failed, using heuristic digest',
        });
        digest = heuristicDigest(talkingPoints);
        digestMode = 'heuristic (llm fallback)';
      }
    } else {
      ctx.emitter.emit('stage:progress', {
        stageName: 'process:digest',
        message: 'No LLM configured, using heuristic digest',
      });
      digest = heuristicDigest(talkingPoints);
      digestMode = 'heuristic';
    }

    // Write artifact
    const digestPath = path.join(ctx.outputDir, 'digest.md');
    writeText(digestPath, digest + '\n');
    ctx.artifacts.set('digest', digestPath);

    return {
      ...input,
      digest,
      digestMode,
      talkingPoints,
    };
  },
};
