/**
 * @module stages/process/research-prompt
 * Process stage: build a deep-research prompt from the digest.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import type { DigestOutput } from './digest.js';
import { writeText } from '../../utils/fs.js';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResearchPromptOutput extends DigestOutput {
  researchPrompt: string;
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

function buildResearchPrompt(opts: {
  sourceType: string;
  url: string;
  lang: string;
  talkingPoints: string[];
  transcriptExcerpt: string;
}): string {
  return `# Deep Research Brief

## Context
- Source URL: ${opts.url || 'N/A'}
- Source type: ${opts.sourceType}
- Output language target: ${opts.lang}

## Main Talking Points Extracted
${opts.talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Transcript Excerpt
${opts.transcriptExcerpt}

## Instructions for Deep Research Agent
You are conducting deep research from this video's thesis and claims.

Deliver the output in ${opts.lang === 'es' ? 'Spanish' : opts.lang} and structure it as:

1) **Tesis central**
- Resumir el argumento principal en 3-5 líneas.

2) **Matriz de verificación de afirmaciones**
- Tabla/bullets con: afirmación, estado (confirmada/incierta/refutada), evidencia, fuente.
- Priorizar fuentes primarias y reportes institucionales.

3) **Contraargumentos y puntos ciegos**
- Qué omite el video
- Qué hipótesis alternativas existen

4) **Implicaciones estratégicas**
- Geopolítica
- Mercados
- Política pública
- Riesgo operativo

5) **Escenarios**
- 3 meses, 12 meses, 36 meses
- Señales tempranas a monitorear

6) **Guion base para podcast (${opts.lang === 'es' ? 'español' : opts.lang})**
- Hook de 30-45 segundos
- Desarrollo en 5 bloques
- Cierre con 3 takeaways accionables

Rules:
- Citar fuentes con enlaces.
- Separar hechos de inferencias.
- Declarar incertidumbre explícitamente.
- Evitar lenguaje hype/no verificable.
`;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export const researchPromptStage: Stage<DigestOutput, ResearchPromptOutput> = {
  name: 'process:research-prompt',
  description: 'Build deep-research prompt from digest and transcript',

  async run(input, ctx) {
    const excerptLen = ctx.config.transcript.excerptLength;
    const lang = ctx.config.lang;

    const researchPrompt = buildResearchPrompt({
      sourceType: input.sourceType,
      url: input.source,
      lang,
      talkingPoints: input.talkingPoints,
      transcriptExcerpt: input.transcript.slice(0, excerptLen),
    });

    // Write artifacts
    const promptPath = path.join(ctx.outputDir, 'deep_research_prompt.md');
    writeText(promptPath, researchPrompt + '\n');
    ctx.artifacts.set('research_prompt', promptPath);

    const transcriptPath = path.join(ctx.outputDir, 'transcript.txt');
    writeText(transcriptPath, input.transcript + '\n');
    ctx.artifacts.set('transcript', transcriptPath);

    return {
      ...input,
      researchPrompt,
    };
  },
};
