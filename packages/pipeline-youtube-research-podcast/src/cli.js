#!/usr/bin/env node
/**
 * @abquanta/pipeline-youtube-research-podcast — CLI
 *
 * Commands:
 *   prep     — ingest source → digest → deep research prompt
 *   publish  — research prompt → article + podcast + reel + social
 *   doctor   — verify tooling / config
 *   latest   — print path to latest prep output
 *   init / podcast — stubs
 *
 * Now powered by @abquanta/abq-media-core for typed stages, events, and config.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig,
  loadDotenv,
  hasCommand,
  nowStamp,
  ensureDir,
  writeText,
  writeJson,

  // Pipeline
  Pipeline,
  FallbackStage,

  // Stages
  youtubeIngestStage,
  captionsStage,
  ytdlpSubsStage,
  ytAsrStage,
  textFileIngestStage,
  audioFileIngestStage,
  digestStage,
  researchPromptStage,
  createParallelGenerateStage,
  extractVideoId,

  // Generate helpers
  generateArticleStage,
  generatePodcastScriptStage,
  generateReelScriptStage,
  generateSocialPostsStage,
} from '@abquanta/abq-media-core';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

loadDotenv();

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function arg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

// ---------------------------------------------------------------------------
// cmd: doctor
// ---------------------------------------------------------------------------

async function cmdDoctor() {
  const config = loadConfig();
  const ytDlp = await hasCommand('yt-dlp');
  const ffmpeg = await hasCommand('ffmpeg');

  const transcriptPaths = ['youtube-captions (always attempted)'];
  if (ytDlp) transcriptPaths.push('yt-dlp-subs');
  if (ytDlp && config.asr.apiKey) transcriptPaths.push(`asr-${config.asr.provider}`);
  transcriptPaths.push('transcript-file', 'text-inline', 'text-file', 'audio-file (ASR)');

  let digestMode = 'heuristic';
  if (config.llm.provider && config.llm.apiKey) {
    digestMode = `llm-${config.llm.provider} (if key/model valid)`;
  }

  const report = {
    ok: true,
    binaries: { ytDlp, ffmpeg },
    config: {
      llmProvider: config.llm.provider,
      hasLlmKey: !!config.llm.apiKey,
      asrProvider: config.asr.provider,
      hasAsrKey: !!config.asr.apiKey,
    },
    availableTranscriptPaths: transcriptPaths,
    expectedDigestMode: digestMode,
    hints: [
      ytDlp ? null : 'Install yt-dlp for subtitle/audio fallbacks.',
      ffmpeg ? null : 'Install ffmpeg to enable audio file conversion for ASR.',
      config.llm.apiKey ? null : 'Set llmApiKey / OPENROUTER_API_KEY to enable LLM digest.',
      config.asr.apiKey ? null : 'Set asrApiKey / OPENAI_API_KEY to enable API ASR fallback.',
    ].filter(Boolean),
  };

  console.log(JSON.stringify(report, null, 2));
}

// ---------------------------------------------------------------------------
// cmd: prep
// ---------------------------------------------------------------------------

async function cmdPrep() {
  const rawUrl = arg('--url');
  const url = String(rawUrl || '')
    .replace(/\\\?/g, '?')
    .replace(/\\&/g, '&')
    .replace(/\\=/g, '=')
    .trim();
  const lang = arg('--lang', 'es');
  const audioFile = arg('--audio-file');
  const transcriptFile = arg('--transcript-file');
  const textInline = arg('--text');
  const textFile = arg('--text-file');
  const useCaptionsOnly = hasFlag('--use-captions') || arg('--use-captions') === '1';
  const useAsrOnly = hasFlag('--use-asr') || arg('--use-asr') === '1';

  if (!url && !audioFile && !transcriptFile && !textInline && !textFile) {
    console.error(
      'Usage: abq-yt-rp prep (--url <youtube-url> | --audio-file <path> | --transcript-file <path> | --text "..." | --text-file <path>) [--lang es] [--use-captions] [--use-asr]',
    );
    process.exit(1);
  }

  if (useCaptionsOnly && useAsrOnly) {
    console.error('Invalid flags: --use-captions and --use-asr cannot be used together.');
    process.exit(1);
  }

  let videoId = '';
  if (url) {
    videoId = extractVideoId(url);
    if (!videoId) {
      console.error('Invalid YouTube URL. Could not extract video id.');
      process.exit(1);
    }
  }

  // Load config early so we can validate flags before running the pipeline
  const config = loadConfig({ lang });

  // --- Pick the right ingest stage ---
  let ingestStage;
  if (textInline || textFile) {
    ingestStage = textFileIngestStage;
  } else if (audioFile) {
    ingestStage = audioFileIngestStage;
  } else if (transcriptFile) {
    ingestStage = textFileIngestStage; // transcript files are plain text
  } else if (useCaptionsOnly) {
    ingestStage = new FallbackStage({
      name: 'ingest:youtube-captions-only',
      description: 'YouTube captions + yt-dlp subtitles only',
      alternatives: [captionsStage, ytdlpSubsStage],
    });
  } else if (useAsrOnly) {
    if (!config.asr.apiKey) {
      console.error('ASR not configured. Set asrApiKey / OPENAI_API_KEY to enable ASR fallback.');
      process.exit(1);
    }
    ingestStage = ytAsrStage;
  } else {
    ingestStage = youtubeIngestStage; // FallbackStage with caption→ytdlp→asr chain
  }

  // --- Build the prep pipeline ---
  const outDir = path.resolve(process.cwd(), 'output', `prep-${nowStamp()}`);

  const pipeline = new Pipeline({
    name: 'prep',
    stages: [ingestStage, digestStage, researchPromptStage],
    config,
    outputDir: outDir,
  });

  // --- Wire up progress events ---
  pipeline.on('stage:start', (e) => {
    console.log(`[prep] ▶ ${e.stageName}`);
  });
  pipeline.on('stage:progress', (e) => {
    console.log(`[prep]   ${e.message}`);
  });
  pipeline.on('stage:complete', (e) => {
    console.log(`[prep] ✓ ${e.stageName} (${e.durationMs}ms)`);
  });
  pipeline.on('stage:skip', (e) => {
    console.log(`[prep] ⏭ ${e.stageName} — ${e.reason}`);
  });
  pipeline.on('stage:error', (e) => {
    console.error(`[prep] ✗ ${e.stageName}: ${e.error.message}`);
  });

  // --- Build input ---
  const input = {
    url: url || undefined,
    videoId: videoId || undefined,
    lang,
    text: textInline || undefined,
    transcriptFile: transcriptFile || textFile || undefined,
    audioFile: audioFile || undefined,
  };

  try {
    const result = await pipeline.run(input);

    // Write extra metadata (same schema as old CLI)
    const metadataPath = path.join(outDir, 'metadata.json');
    const existingMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    Object.assign(existingMeta, {
      stage: 'prep',
      source: input.url ? 'YouTube video' : input.audioFile ? 'audio file' : 'plain text',
      url: url || null,
      videoId: videoId || null,
      lang,
    });
    writeJson(metadataPath, existingMeta);

    console.log(`\nPrep artifacts created at: ${outDir}`);
    console.log(`Duration: ${result.durationMs}ms, stages: ${result.completedStages.join(' → ')}`);
  } catch (err) {
    console.error(`\n[prep] Pipeline failed: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// cmd: publish
// ---------------------------------------------------------------------------

async function cmdPublish() {
  const input = arg('--input');
  const lang = arg('--lang', 'es');
  const useLatest = hasFlag('--latest');

  if (!input && !useLatest) {
    console.error('Usage: abq-yt-rp publish --input <path/to/deep_research_prompt.md> [--lang es] [--latest]');
    process.exit(1);
  }

  const resolvedInput = input || resolveLatestPrepPath('prompt');
  const inputPath = path.resolve(process.cwd(), resolvedInput);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const config = loadConfig({ lang });
  if (!config.llm.apiKey) {
    console.error('LLM API key not configured. Set llmApiKey / OPENROUTER_API_KEY.');
    process.exit(1);
  }

  const researchPrompt = fs.readFileSync(inputPath, 'utf8').trim();
  if (!researchPrompt) {
    console.error('Input file is empty.');
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'output', `publish-${nowStamp()}`);

  // Build a pipeline with 4 individual generate stages (sequential for clarity)
  const contentTypes = config.output.formats;
  const stageMap = {
    article: generateArticleStage,
    podcast_script: generatePodcastScriptStage,
    reel_script: generateReelScriptStage,
    social_posts: generateSocialPostsStage,
  };

  const stages = contentTypes.map((ct) => stageMap[ct]).filter(Boolean);

  const pipeline = new Pipeline({
    name: 'publish',
    stages,
    config,
    outputDir: outDir,
  });

  pipeline.on('stage:start', (e) => {
    console.log(`[publish] ▶ ${e.stageName}`);
  });
  pipeline.on('stage:complete', (e) => {
    console.log(`[publish] ✓ ${e.stageName} (${e.durationMs}ms)`);
  });
  pipeline.on('stage:error', (e) => {
    console.error(`[publish] ✗ ${e.stageName}: ${e.error.message}`);
  });

  const publishInput = { researchPrompt, lang };
  const metadata = {
    stage: 'publish',
    inputFile: inputPath,
    lang,
    model: config.llm.model,
    createdAt: new Date().toISOString(),
    outputs: {},
  };

  try {
    const result = await pipeline.run(publishInput);

    for (const stage of result.completedStages) {
      metadata.outputs[stage] = 'ok';
    }
    for (const err of result.errors) {
      metadata.outputs[err.stageName] = `error: ${err.error.message}`;
    }

    writeJson(path.join(outDir, 'metadata.json'), metadata);
    console.log(`\nPublish artifacts created at: ${outDir}`);
  } catch (err) {
    writeJson(path.join(outDir, 'metadata.json'), metadata);
    console.error(`\n[publish] Pipeline failed: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// cmd: latest
// ---------------------------------------------------------------------------

function cmdLatest() {
  const open = (arg('--open') || '').toLowerCase();
  console.log(resolveLatestPrepPath(open || null));
}

function resolveLatestPrepPath(open = null) {
  const outDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outDir)) {
    console.error('No output directory found yet.');
    process.exit(1);
  }

  const runs = fs.readdirSync(outDir)
    .filter((d) => d.startsWith('prep-'))
    .map((d) => path.join(outDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (!runs.length) {
    console.error('No prep runs found in output/.');
    process.exit(1);
  }

  const latest = runs[0];
  if (!open) return latest;

  const map = {
    prompt: 'deep_research_prompt.md',
    digest: 'digest.md',
    transcript: 'transcript.txt',
    metadata: 'metadata.json',
  };

  const file = map[open];
  if (!file) {
    console.error('Invalid --open option. Use one of: prompt|digest|transcript|metadata');
    process.exit(1);
  }

  const target = path.join(latest, file);
  if (!fs.existsSync(target)) {
    console.error(`File not found: ${target}`);
    process.exit(1);
  }

  return target;
}

// ---------------------------------------------------------------------------
// cmd: init / podcast (stubs)
// ---------------------------------------------------------------------------

function cmdInit() {
  console.log('Run: npm run init');
}

function cmdPodcast() {
  const inputArg = arg('--input');
  const lang = arg('--lang', 'es');
  if (!inputArg) {
    console.error('Usage: abq-yt-rp podcast --input <research.md> [--lang es]');
    process.exit(1);
  }
  console.log(`TODO: generate ${lang} podcast from ${inputArg} and publish to SoundCloud`);
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'init':
      cmdInit();
      break;
    case 'prep':
      await cmdPrep();
      break;
    case 'publish':
      await cmdPublish();
      break;
    case 'podcast':
      cmdPodcast();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    case 'latest':
      cmdLatest();
      break;
    default:
      console.log('abq-yt-rp commands:');
      console.log('  init');
      console.log('  doctor');
      console.log('  latest [--open prompt|digest|transcript|metadata]');
      console.log('  prep (--url <youtube-url> | --audio-file <path> | --transcript-file <path> | --text "..." | --text-file <path>) [--lang es] [--use-captions] [--use-asr]');
      console.log('  publish --input <path/to/deep_research_prompt.md> [--lang es] [--latest]');
      console.log('  podcast --input <research.md> [--lang es]');
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
