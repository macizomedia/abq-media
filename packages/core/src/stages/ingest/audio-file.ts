/**
 * @module stages/ingest/audio-file
 * Ingest stage: transcribe a local audio file via ASR.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import type { IngestInput, IngestOutput } from './youtube.js';
import { createASRProvider } from '../../providers/asr.js';
import { hasCommand, shell, makeTempDir, rmSafe } from '../../utils/index.js';
import fs from 'node:fs';
import path from 'node:path';

export const audioFileIngestStage: Stage<IngestInput, IngestOutput> = {
  name: 'ingest:audio-file',
  description: 'Transcribe a local audio file via ASR API',

  canRun(input, ctx) {
    return !!(input.audioFile && ctx.config.asr.apiKey);
  },

  async run(input, ctx) {
    const filePath = path.resolve(process.cwd(), input.audioFile!);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    const hasFFmpeg = await hasCommand('ffmpeg');
    const tmp = makeTempDir('abq-asr-file-');

    try {
      let audioPath = filePath;
      const ext = path.extname(filePath).toLowerCase();

      // Convert to mp3 if not already and ffmpeg is available
      if (ext !== '.mp3' && hasFFmpeg) {
        const mp3Path = path.join(tmp, 'audio.mp3');
        ctx.emitter.emit('stage:progress', {
          stageName: 'ingest:audio-file',
          message: 'Converting audio to MP3…',
        });
        try {
          await shell(
            `ffmpeg -y -i "${filePath}" -vn -ac 1 -ar 16000 -b:a 64k "${mp3Path}"`,
            { cwd: tmp, timeoutMs: 120_000, signal: ctx.signal },
          );
          if (fs.existsSync(mp3Path)) audioPath = mp3Path;
        } catch {
          // keep original
        }
      }

      ctx.emitter.emit('stage:progress', {
        stageName: 'ingest:audio-file',
        message: 'Transcribing audio via ASR API…',
      });

      const provider = createASRProvider(ctx.config.asr);
      const result = await provider.transcribe(
        { audioPath, lang: input.lang ?? ctx.config.lang },
        ctx,
      );

      const minLen = ctx.config.transcript.minLengthChars;
      if (result.text.length < minLen) {
        throw new Error(`ASR transcript too short (${result.text.length} chars, min ${minLen})`);
      }

      return {
        transcript: result.text,
        source: `file:${filePath}`,
        transcriptMode: `asr-${ctx.config.asr.provider}`,
        sourceType: 'audio file',
        trace: [{ step: 'asr-audio', status: 'ok', reason: `via ${provider.name}` }],
      };
    } finally {
      rmSafe(tmp);
    }
  },
};
