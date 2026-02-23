/**
 * @module stages/ingest/text-file
 * Ingest stage: read a plain text or markdown file as transcript input.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import type { IngestInput, IngestOutput } from './youtube.js';
import fs from 'node:fs';
import path from 'node:path';

export const textFileIngestStage: Stage<IngestInput, IngestOutput> = {
  name: 'ingest:text-file',
  description: 'Read a text or markdown file as transcript input',

  canRun(input) {
    return !!(input.transcriptFile || input.text);
  },

  async run(input, ctx) {
    let transcript: string;
    let source: string;
    let mode: string;
    let sourceType: string;

    if (input.text) {
      // Inline text
      transcript = input.text.trim();
      source = 'inline:text';
      mode = 'text-inline';
      sourceType = 'plain text';
    } else {
      // File path
      const filePath = path.resolve(process.cwd(), input.transcriptFile!);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Text file not found: ${filePath}`);
      }
      transcript = fs.readFileSync(filePath, 'utf8');
      source = `file:${filePath}`;
      mode = 'text-file';
      sourceType = 'text file';
    }

    const minLen = ctx.config.transcript.minLengthChars;
    if (transcript.length < minLen) {
      throw new Error(`Text input too short (${transcript.length} chars, min ${minLen})`);
    }

    return {
      transcript,
      source,
      transcriptMode: mode,
      sourceType,
      trace: [{ step: mode, status: 'ok' }],
    };
  },
};
