/**
 * @module stages/generate/content
 * Generate stages: produce article, podcast script, reel script, and social posts
 * from a research prompt via LLM.
 *
 * These share the same structure — only the system prompt differs.
 * They can be composed into a ParallelStage for concurrent generation.
 */

import type { Stage } from '../../stage.js';
import type { PipelineContext } from '../../context.js';
import type { ResearchPromptOutput } from '../process/research-prompt.js';
import { createLLMProvider } from '../../providers/llm.js';
import { ParallelStage, type ParallelResult } from '../../stage.js';
import { writeText } from '../../utils/fs.js';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentType = 'article' | 'podcast_script' | 'reel_script' | 'social_posts';

export interface GenerateInput {
  researchPrompt: string;
  lang?: string;
}

export interface GenerateOutput {
  contentType: ContentType;
  text: string;
  filePath: string;
  /** Pass-through so serial pipeline chaining preserves the research report. */
  researchPrompt: string;
  lang?: string;
}

// ---------------------------------------------------------------------------
// System prompt builders
// ---------------------------------------------------------------------------

const SYSTEM_PROMPTS: Record<ContentType, (lang: string) => string> = {
  podcast_script: (lang) =>
    [
      `You are a podcast scriptwriter for Abquanta, a strategic intelligence`,
      `platform covering Venezuela and geopolitics. Write a 2-host conversational`,
      `dialogue podcast script in ${lang} using this structure:`,
      '',
      '- Two hosts: HOST_A (lead analyst, authoritative) and HOST_B (curious',
      '  co-host who asks the right questions)',
      '- Format every line as: HOST_A: [text] or HOST_B: [text]',
      '- No stage directions, no headers, no markdown — pure dialogue only',
      '- Length: ~2000 words (approx 12-15 minutes of audio)',
      '- Open with a hook that would stop someone mid-scroll',
      "- Hosts should challenge each other's points naturally",
      '- Close with 3 clear actionable takeaways delivered conversationally',
      '- Tone: serious but engaging — like a smart radio show, not a lecture',
      '',
      'Use the research prompt as the single source of truth. Do not invent facts. Avoid fluff.',
    ].join(' '),

  article: (lang) =>
    [
      `You are a senior content editor and scriptwriter. Output language: ${lang}.`,
      `Write a Substack-ready long-form article in ${lang}.`,
      'Structure: SEO headline + subtitle, lead paragraph (hook), 4-5 sections with subheaders, closing CTA: "Subscribe for more Abquanta intelligence".',
      'Target length: 800-1200 words.',
      'Output markdown with headline, subtitle, and section headers.',
      'Use the research prompt as the single source of truth. Do not invent facts. Avoid fluff.',
    ].join(' '),

  reel_script: (lang) =>
    [
      `You are a senior content editor and scriptwriter. Output language: ${lang}.`,
      `Write a 60-second short-form video script in ${lang}.`,
      'Structure: Hook line in first 3 seconds, 3 key points (10 seconds each), call to action (Substack link).',
      'Format each beat as [VISUAL] then [NARRATION].',
      'Keep lines tight and timed for spoken delivery.',
      'Use the research prompt as the single source of truth. Do not invent facts. Avoid fluff.',
    ].join(' '),

  social_posts: (lang) =>
    [
      `You are a senior content editor and scriptwriter. Output language: ${lang}.`,
      `Produce social content in ${lang} with three parts:`,
      '1) X/Twitter thread (8-10 tweets).',
      '2) LinkedIn post (~200 words).',
      '3) Instagram caption with 5 hashtags.',
      'Separate each part with clear markdown headings.',
      'Use the research prompt as the single source of truth. Do not invent facts. Avoid fluff.',
    ].join(' '),
};

const FILE_NAMES: Record<ContentType, string> = {
  article: 'article.md',
  podcast_script: 'podcast_script.md',
  reel_script: 'reel_script.md',
  social_posts: 'social_posts.md',
};

// ---------------------------------------------------------------------------
// Factory: create a generate stage for a specific content type
// ---------------------------------------------------------------------------

export function createGenerateStage(contentType: ContentType): Stage<GenerateInput, GenerateOutput> {
  return {
    name: `generate:${contentType}`,
    description: `Generate ${contentType.replace('_', ' ')} via LLM`,
    retryPolicy: { maxAttempts: 2, backoffMs: 3000 },

    canRun(_input, ctx) {
      return !!(ctx.config.llm.apiKey);
    },

    async run(input, ctx) {
      const lang = input.lang ?? ctx.config.lang;
      const systemPrompt = SYSTEM_PROMPTS[contentType](lang);

      ctx.emitter.emit('stage:progress', {
        stageName: `generate:${contentType}`,
        message: `Generating ${contentType.replace('_', ' ')}…`,
      });

      const provider = createLLMProvider(ctx.config.llm);
      const result = await provider.generate(
        {
          systemPrompt,
          prompt: `Research prompt:\n\n${input.researchPrompt}`,
        },
        ctx,
      );

      const fileName = FILE_NAMES[contentType];
      const filePath = path.join(ctx.outputDir, fileName);
      writeText(filePath, result.text.trim() + '\n');
      ctx.artifacts.set(contentType, filePath);

      return {
        contentType,
        text: result.text,
        filePath,
        // Pass through so the next stage in a serial pipeline still sees the research report
        researchPrompt: input.researchPrompt,
        lang: input.lang,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-built individual stages
// ---------------------------------------------------------------------------

export const generateArticleStage = createGenerateStage('article');
export const generatePodcastScriptStage = createGenerateStage('podcast_script');
export const generateReelScriptStage = createGenerateStage('reel_script');
export const generateSocialPostsStage = createGenerateStage('social_posts');

// ---------------------------------------------------------------------------
// Parallel: all content types at once
// ---------------------------------------------------------------------------

/**
 * Run all configured content types in parallel.
 * Replaces the sequential loop in the old cmdPublish().
 */
export function createParallelGenerateStage(
  contentTypes: ContentType[] = ['article', 'podcast_script', 'reel_script', 'social_posts'],
): ParallelStage<GenerateInput> {
  return new ParallelStage<GenerateInput>({
    name: 'generate:all',
    description: 'Generate all content types in parallel',
    stages: contentTypes.map((ct) => createGenerateStage(ct)),
    failFast: false, // partial success is acceptable
  });
}
