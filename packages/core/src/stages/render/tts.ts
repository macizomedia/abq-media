/**
 * @module stages/render/tts
 * Render stage: convert a HOST_A/HOST_B podcast script to audio via TTS.
 *
 * Processes each dialogue line individually, then concatenates via ffmpeg.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import { createTTSProvider } from '../../providers/tts.js';
import { hasCommand, shell, makeTempDir, rmSafe, ensureDir } from '../../utils/index.js';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TTSRenderInput {
  /** Path to podcast_script.md or the script text directly. */
  scriptPath?: string;
  scriptText?: string;
}

export interface TTSRenderOutput {
  audioPath: string;
  durationSec?: number;
  lineCount: number;
}

// ---------------------------------------------------------------------------
// Dialogue parser (from adapter-elevenlabs-tts)
// ---------------------------------------------------------------------------

interface DialogueLine {
  speaker: 'HOST_A' | 'HOST_B';
  text: string;
}

function parseDialogue(script: string): DialogueLine[] {
  const lines = script.split('\n');
  const out: DialogueLine[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const a = line.match(/^HOST_A:\s*(.+)$/);
    if (a?.[1]) {
      out.push({ speaker: 'HOST_A', text: a[1].trim() });
      continue;
    }
    const b = line.match(/^HOST_B:\s*(.+)$/);
    if (b?.[1]) {
      out.push({ speaker: 'HOST_B', text: b[1].trim() });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export const ttsRenderStage: Stage<TTSRenderInput, TTSRenderOutput> = {
  name: 'render:tts',
  description: 'Render podcast script to audio via TTS + ffmpeg concatenation',

  async canRun(_input, ctx) {
    if (!ctx.config.tts.apiKey) return false;
    return await hasCommand('ffmpeg');
  },

  async run(input, ctx) {
    // Load script
    let script: string;
    if (input.scriptText) {
      script = input.scriptText;
    } else if (input.scriptPath) {
      const p = path.resolve(process.cwd(), input.scriptPath);
      if (!fs.existsSync(p)) throw new Error(`Script file not found: ${p}`);
      script = fs.readFileSync(p, 'utf8');
    } else {
      throw new Error('render:tts requires scriptPath or scriptText');
    }

    const dialogue = parseDialogue(script);
    if (!dialogue.length) {
      throw new Error('No HOST_A/HOST_B lines found in script');
    }

    const tts = createTTSProvider(ctx.config.tts);
    const tmp = makeTempDir('abq-tts-');
    const chunkPaths: string[] = [];

    try {
      // Synthesize each line
      for (let i = 0; i < dialogue.length; i++) {
        const line = dialogue[i];
        const voiceId =
          line.speaker === 'HOST_A' ? ctx.config.tts.voiceIdA : ctx.config.tts.voiceIdB;

        ctx.emitter.emit('stage:progress', {
          stageName: 'render:tts',
          message: `TTS line ${i + 1}/${dialogue.length} (${line.speaker})`,
          percent: Math.round(((i + 1) / dialogue.length) * 100),
          detail: { line: i + 1, total: dialogue.length, speaker: line.speaker },
        });

        const result = await tts.synthesize({ text: line.text, voiceId }, ctx);
        const chunkPath = path.join(tmp, `line-${String(i).padStart(4, '0')}.mp3`);
        fs.writeFileSync(chunkPath, result.audio);
        chunkPaths.push(chunkPath);
      }

      // Concatenate with ffmpeg
      ctx.emitter.emit('stage:progress', {
        stageName: 'render:tts',
        message: 'Concatenating audio with ffmpeg…',
      });

      const listPath = path.join(tmp, 'concat.txt');
      const listContent = chunkPaths.map((p) => `file '${p}'`).join('\n');
      fs.writeFileSync(listPath, listContent);

      const outputPath = path.join(ctx.outputDir, 'podcast.mp3');
      ensureDir(path.dirname(outputPath));

      await shell(
        `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`,
        { timeoutMs: 60_000, signal: ctx.signal },
      );

      ctx.artifacts.set('podcast_audio', outputPath);

      // Get duration if ffprobe available
      let durationSec: number | undefined;
      if (await hasCommand('ffprobe')) {
        try {
          const result = await shell(
            `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
            { timeoutMs: 10_000 },
          );
          durationSec = parseFloat(result.stdout.trim()) || undefined;
        } catch {
          // non-critical
        }
      }

      return {
        audioPath: outputPath,
        durationSec,
        lineCount: dialogue.length,
      };
    } finally {
      rmSafe(tmp);
    }
  },
};
