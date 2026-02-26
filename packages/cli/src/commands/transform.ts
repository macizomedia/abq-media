/**
 * @module commands/transform
 * `abq-media transform <source> --into <format> [--using <recipe>]`
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { select } from '@clack/prompts';

import { clack } from '../ui/prompts.js';
import { ensureDir, writeJson } from '../utils/fs.js';
import { getCredentialsPath, resolvePathFromCwd, resolveProjectsRootDir } from '../utils/paths.js';
import { loadRecipe } from '../recipes/loader.js';
import { runPrep, runPublish, runTts, type YtdlpCliFlags } from '../utils/core-bridge.js';

export type SourceType = 'youtube' | 'audio' | 'text' | 'idea' | 'artifact';

type IntoFormat =
  | 'transcript'
  | 'research'
  | 'podcast'
  | 'podcast-script'
  | 'article'
  | 'translation'
  | 'video-script';

interface SetupConfig {
  api?: {
    llm?: {
      provider?: 'openrouter' | 'openai' | 'anthropic';
      apiKey?: string;
      model?: string;
    };
  };
  defaults?: {
    language?: string;
    recipe?: string;
    outputDir?: string;
  };
}

interface TransformCheckpoint {
  source: string;
  into: IntoFormat;
  recipe: string;
  lang: string;
  runDir: string;
  stage: 'started' | 'prep-complete' | 'publish-complete' | 'complete' | 'failed';
  updatedAt: string;
  error?: string;
}

interface ProjectManifest {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  source?: Record<string, unknown>;
  recipe?: string;
  targetFormat?: string;
  status?: 'complete' | 'failed' | 'in-progress' | 'planned';
  failedAt?: string | null;
  failureReason?: string | null;
  artifacts?: Array<{ name: string; stage?: string; size?: number }>;
}

const VALID_FORMATS: IntoFormat[] = [
  'transcript',
  'research',
  'podcast',
  'podcast-script',
  'article',
  'translation',
  'video-script',
];

function arg(flag: string, fallback = ''): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getPositionalSource(): string {
  const [, , command, ...rest] = process.argv;
  if (command !== 'transform') return '';
  return rest.find((item) => !item.startsWith('-')) ?? '';
}

export function detectSourceType(source: string): SourceType {
  if (source.match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/)) {
    return 'youtube';
  }
  if (source.match(/\.(mp3|wav|m4a|ogg|flac)$/i)) {
    return 'audio';
  }
  if (source.match(/\.(txt|md|markdown)$/i)) {
    return fs.existsSync(source) ? 'artifact' : 'text';
  }
  if (source.startsWith('"') || (!source.includes('/') && !source.includes('.'))) {
    return 'idea';
  }
  if (fs.existsSync(source)) {
    return 'artifact';
  }
  throw new Error(`Cannot determine source type for: ${source}`);
}

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project';
}

function currentDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadSetupConfig(): SetupConfig {
  const filepath = getCredentialsPath();
  if (!fs.existsSync(filepath)) {
    throw new Error('Configuration not found. Run: abq-media setup');
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as SetupConfig;
}

function createProjectDir(source: string, format: string, rootDir: string, explicitName?: string): { projectDir: string; projectName: string } {
  const projectName = explicitName || `${toSlug(source)}-${format}-${currentDate()}`;
  const projectDir = path.join(rootDir, projectName);

  ensureDir(projectDir);

  return { projectDir, projectName };
}

function defaultRecipeFor(formatName: IntoFormat): string {
  const defaults: Record<IntoFormat, string> = {
    transcript: 'default',
    research: 'research-only',
    podcast: 'default',
    'podcast-script': 'research-only',
    article: 'article-nyt',
    translation: 'default',
    'video-script': 'default',
  };
  return defaults[formatName];
}

async function pickFormatInteractive(): Promise<IntoFormat> {
  const value = await select({
    message: 'What would you like to create?',
    options: [
      { value: 'podcast', label: 'Podcast episode', hint: 'research + script + audio' },
      { value: 'research', label: 'Research report', hint: 'deep analysis' },
      { value: 'article', label: 'Article', hint: 'styled written piece' },
      { value: 'transcript', label: 'Transcript', hint: 'raw text only' },
    ],
  });

  if (clack.isCancel(value) || !value) {
    throw new Error('Cancelled by user');
  }

  return value as IntoFormat;
}

function stageEnabledNames(stages: Array<{ name: string; enabled: boolean }>): string[] {
  return stages.filter((stage) => stage.enabled).map((stage) => stage.name);
}

function writeProjectMetadata(projectDir: string, payload: Record<string, unknown>): void {
  writeJson(path.join(projectDir, 'source.json'), payload);
}

function writeManifest(projectDir: string, payload: Record<string, unknown>): void {
  writeJson(path.join(projectDir, 'manifest.json'), payload);
}

function checkpointPath(projectDir: string): string {
  return path.join(projectDir, 'checkpoint.json');
}

function writeCheckpoint(projectDir: string, checkpoint: TransformCheckpoint): void {
  writeJson(checkpointPath(projectDir), checkpoint);
}

function artifactsFromRun(runDir: string): Array<{ name: string; stage?: string; size?: number }> {
  if (!fs.existsSync(runDir)) return [];
  const entries = fs.readdirSync(runDir)
    .map((name) => ({ name, abs: path.join(runDir, name) }))
    .filter((entry) => fs.statSync(entry.abs).isFile())
    .sort((a, b) => a.name.localeCompare(b.name));

  const stageByName: Record<string, string> = {
    'transcript.txt': 'transcript',
    'deep_research_prompt.md': 'research-prompt',
    'research-report.md': 'research',
    'podcast_script.md': 'script',
    'article.md': 'article',
    'translated.txt': 'translation',
    'video-script.md': 'video-script',
    'podcast.mp3': 'tts',
  };

  return entries.map((entry) => ({
    name: entry.name,
    stage: stageByName[entry.name] ?? 'artifact',
    size: fs.statSync(entry.abs).size,
  }));
}

function loadManifest(projectDir: string): ProjectManifest {
  const manifestFile = path.join(projectDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    return {
      id: path.basename(projectDir),
      name: path.basename(projectDir),
      status: 'in-progress',
      artifacts: [],
    };
  }

  return JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as ProjectManifest;
}

function upsertManifest(projectDir: string, patch: Partial<ProjectManifest>, runDir: string): void {
  const previous = loadManifest(projectDir);
  const merged: ProjectManifest = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString(),
    artifacts: artifactsFromRun(runDir),
  };
  writeManifest(projectDir, merged as unknown as Record<string, unknown>);
}

async function generateTextWithConfiguredLLM(config: SetupConfig, opts: { systemPrompt: string; prompt: string; maxTokens?: number }): Promise<string> {
  const provider = config.api?.llm?.provider ?? 'openrouter';
  const apiKey = config.api?.llm?.apiKey ?? '';
  const model = config.api?.llm?.model ?? (provider === 'openai' ? 'gpt-4o-mini' : 'anthropic/claude-sonnet-4-20250514');

  if (!apiKey) {
    throw new Error('LLM API key not configured. Run: abq-media setup --api');
  }
  if (provider === 'anthropic') {
    throw new Error('Anthropic direct provider is not yet supported in this command. Use openrouter or openai in setup.');
  }

  const baseUrl = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/abquanta/abq-media-workspace';
    headers['X-Title'] = 'abq-media';
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? 4000,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) {
    throw new Error('LLM returned empty response.');
  }

  return content;
}

async function ensureResearchReport(runDir: string, targetLang: string, config: SetupConfig): Promise<string> {
  const targetPath = path.join(runDir, 'research-report.md');
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const promptPath = path.join(runDir, 'deep_research_prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new Error('Missing deep_research_prompt.md for research generation.');
  }

  const prompt = fs.readFileSync(promptPath, 'utf-8');
  const report = await generateTextWithConfiguredLLM(config, {
    systemPrompt: `You are a senior geopolitical and economic research analyst. Output must be in ${targetLang}.`,
    prompt: `Generate a complete deep research report from this brief.\n\n${prompt}`,
    maxTokens: 6000,
  });
  fs.writeFileSync(targetPath, `${report}\n`, 'utf-8');
  return targetPath;
}

async function ensureTranslation(runDir: string, targetLang: string, config: SetupConfig): Promise<string> {
  const targetPath = path.join(runDir, 'translated.txt');
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const transcriptPath = path.join(runDir, 'transcript.txt');
  if (!fs.existsSync(transcriptPath)) {
    throw new Error('Missing transcript.txt for translation.');
  }

  const transcript = fs.readFileSync(transcriptPath, 'utf-8');
  const translated = await generateTextWithConfiguredLLM(config, {
    systemPrompt: `You are a precise translator. Preserve facts and tone. Output only translated text in ${targetLang}.`,
    prompt: transcript,
    maxTokens: 5000,
  });
  fs.writeFileSync(targetPath, `${translated}\n`, 'utf-8');
  return targetPath;
}

function maybeCopyVideoScript(runDir: string): string | null {
  const source = path.join(runDir, 'reel_script.md');
  const target = path.join(runDir, 'video-script.md');
  if (!fs.existsSync(source)) return null;
  fs.copyFileSync(source, target);
  return target;
}

async function executeTransformRun(opts: {
  source: string;
  into: IntoFormat;
  recipeName: string;
  targetLang: string;
  projectDir: string;
  runDir: string;
  config: SetupConfig;
  sourceType: SourceType;
  ytdlpFlags?: YtdlpCliFlags;
}): Promise<void> {
  writeCheckpoint(opts.projectDir, {
    source: opts.source,
    into: opts.into,
    recipe: opts.recipeName,
    lang: opts.targetLang,
    runDir: opts.runDir,
    stage: 'started',
    updatedAt: new Date().toISOString(),
  });

  const prep = await runPrep({
    url: opts.sourceType === 'youtube' ? opts.source : undefined,
    audioFile: opts.sourceType === 'audio' ? opts.source : undefined,
    textFile: opts.sourceType === 'text' || opts.sourceType === 'artifact' ? opts.source : undefined,
    lang: opts.targetLang,
    outputDir: opts.runDir,
    ytdlpFlags: opts.ytdlpFlags,
  });

  if (!prep.ok) {
    throw new Error(prep.error ?? 'Prep stage failed');
  }

  writeCheckpoint(opts.projectDir, {
    source: opts.source,
    into: opts.into,
    recipe: opts.recipeName,
    lang: opts.targetLang,
    runDir: opts.runDir,
    stage: 'prep-complete',
    updatedAt: new Date().toISOString(),
  });

  if (opts.into === 'transcript') {
    writeCheckpoint(opts.projectDir, {
      source: opts.source,
      into: opts.into,
      recipe: opts.recipeName,
      lang: opts.targetLang,
      runDir: opts.runDir,
      stage: 'complete',
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (opts.into === 'research') {
    await ensureResearchReport(opts.runDir, opts.targetLang, opts.config);
    writeCheckpoint(opts.projectDir, {
      source: opts.source,
      into: opts.into,
      recipe: opts.recipeName,
      lang: opts.targetLang,
      runDir: opts.runDir,
      stage: 'complete',
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (opts.into === 'translation') {
    await ensureTranslation(opts.runDir, opts.targetLang, opts.config);
    writeCheckpoint(opts.projectDir, {
      source: opts.source,
      into: opts.into,
      recipe: opts.recipeName,
      lang: opts.targetLang,
      runDir: opts.runDir,
      stage: 'complete',
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const promptPath = path.join(opts.runDir, 'deep_research_prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new Error('Cannot continue: research prompt artifact missing.');
  }

  const publish = await runPublish({
    inputFile: promptPath,
    lang: opts.targetLang,
    outputDir: opts.runDir,
  });

  if (!publish.ok) {
    throw new Error(publish.error ?? 'Publish stage failed');
  }

  writeCheckpoint(opts.projectDir, {
    source: opts.source,
    into: opts.into,
    recipe: opts.recipeName,
    lang: opts.targetLang,
    runDir: opts.runDir,
    stage: 'publish-complete',
    updatedAt: new Date().toISOString(),
  });

  if (opts.into === 'video-script') {
    maybeCopyVideoScript(opts.runDir);
  }

  if (opts.into === 'podcast') {
    const scriptPath = path.join(opts.runDir, 'podcast_script.md');
    const tts = await runTts({
      scriptPath,
      lang: opts.targetLang,
      outputDir: opts.runDir,
    });
    if (!tts.ok) {
      throw new Error(tts.error ?? 'TTS stage failed');
    }
  }

  writeCheckpoint(opts.projectDir, {
    source: opts.source,
    into: opts.into,
    recipe: opts.recipeName,
    lang: opts.targetLang,
    runDir: opts.runDir,
    stage: 'complete',
    updatedAt: new Date().toISOString(),
  });
}

export async function cmdTransform(): Promise<void> {
  const source = getPositionalSource();
  let into = arg('--into') as IntoFormat;
  const recipeName = arg('--using');
  const lang = arg('--lang');
  const projectName = arg('--name');
  const outputRootOverride = arg('--output');
  const dryRun = hasFlag('--dry-run');

  // yt-dlp flags
  const ytdlpFlags: YtdlpCliFlags = {
    simulate: hasFlag('--simulate'),
    verbose: hasFlag('--ytdlp-verbose'),
    debug: hasFlag('--ytdlp-debug'),
    quiet: hasFlag('--ytdlp-quiet'),
    format: arg('--ytdlp-format') || undefined,
    audioFormat: (arg('--ytdlp-audio-format') || undefined) as YtdlpCliFlags['audioFormat'],
    subtitleFormat: (arg('--ytdlp-sub-format') || undefined) as YtdlpCliFlags['subtitleFormat'],
    subtitleLangs: arg('--ytdlp-sub-langs') || undefined,
    cookies: arg('--cookies') || undefined,
    cookiesFromBrowser: arg('--cookies-from-browser') || undefined,
    proxy: arg('--proxy') || undefined,
    rateLimit: arg('--rate-limit') || undefined,
    forceIpv4: hasFlag('--force-ipv4'),
    geoBypass: hasFlag('--geo-bypass'),
  };

  if (!source) {
    clack.log.error('Missing <source>. Usage: abq-media transform <source> --into <format>');
    process.exitCode = 1;
    return;
  }

  if (!into) {
    into = await pickFormatInteractive();
  }

  if (!VALID_FORMATS.includes(into)) {
    clack.log.error(`Invalid --into value: ${into}`);
    clack.log.info(`Valid values: ${VALID_FORMATS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const sourceType = detectSourceType(source);
  const config = loadSetupConfig();
  const targetLang = lang || config.defaults?.language || 'es';
  const outputRoot = resolveProjectsRootDir(outputRootOverride || config.defaults?.outputDir);

  ensureDir(outputRoot);

  const recipe = await loadRecipe(recipeName || config.defaults?.recipe || defaultRecipeFor(into));
  const { projectDir, projectName: resolvedProjectName } = createProjectDir(source, into, outputRoot, projectName);
  const runDir = path.join(projectDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  ensureDir(runDir);

  writeProjectMetadata(projectDir, {
    source,
    type: sourceType,
    createdAt: new Date().toISOString(),
  });

  const enabledStages = stageEnabledNames(recipe.stages as Array<{ name: string; enabled: boolean }>);

  writeManifest(projectDir, {
    id: resolvedProjectName,
    name: resolvedProjectName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: { type: sourceType, value: source },
    recipe: recipe.name,
    targetFormat: into,
    status: dryRun ? 'planned' : 'in-progress',
    artifacts: [],
  });

  clack.intro('abq-media transform');
  clack.log.info(`Source type: ${sourceType}`);
  clack.log.info(`Format: ${into}`);
  clack.log.info(`Recipe: ${recipe.name}`);
  clack.log.info(`Stages: ${enabledStages.join(', ') || 'none'}`);
  clack.log.info(`Project: ${projectDir}`);

  if (ytdlpFlags.simulate) {
    clack.log.info('yt-dlp mode: simulate (probe only, no downloads)');
  }
  if (ytdlpFlags.verbose || ytdlpFlags.debug) {
    clack.log.info(`yt-dlp verbosity: ${ytdlpFlags.debug ? 'debug' : 'verbose'}`);
  }

  if (dryRun) {
    clack.outro('Dry run complete.');
    return;
  }

  try {
    await executeTransformRun({
      source,
      into,
      recipeName: recipe.name,
      targetLang,
      projectDir,
      runDir,
      config,
      sourceType,
      ytdlpFlags,
    });

    upsertManifest(projectDir, {
      id: resolvedProjectName,
      name: resolvedProjectName,
      status: 'complete',
      targetFormat: into,
      recipe: recipe.name,
      failedAt: null,
      failureReason: null,
    }, runDir);

    clack.outro(`Transform complete. Artifacts in: ${runDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    writeCheckpoint(projectDir, {
      source,
      into,
      recipe: recipe.name,
      lang: targetLang,
      runDir,
      stage: 'failed',
      updatedAt: new Date().toISOString(),
      error: message,
    });

    upsertManifest(projectDir, {
      id: resolvedProjectName,
      name: resolvedProjectName,
      status: 'failed',
      targetFormat: into,
      recipe: recipe.name,
      failedAt: 'transform',
      failureReason: message,
    }, runDir);

    clack.log.error(message);
    process.exitCode = 1;
  }
}

export async function continueTransformProject(projectId: string): Promise<void> {
  let configuredOutputDir: string | undefined;
  try {
    configuredOutputDir = loadSetupConfig().defaults?.outputDir;
  } catch {
    configuredOutputDir = undefined;
  }

  const roots = [
    resolveProjectsRootDir(configuredOutputDir),
    resolveProjectsRootDir(undefined),
    configuredOutputDir ? resolvePathFromCwd(configuredOutputDir, os.homedir()) : '',
    path.join(os.homedir(), 'abq-projects'),
    path.join(os.homedir(), '.abq-media', 'projects'),
  ].filter((root, idx, arr) => !!root && arr.indexOf(root) === idx);

  const projectDir = roots
    .map((root) => path.join(root, projectId))
    .find((candidate) => fs.existsSync(candidate));
  if (!projectDir) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const checkpointFile = checkpointPath(projectDir);
  const manifest = loadManifest(projectDir);

  if (!fs.existsSync(checkpointFile)) {
    throw new Error(`No checkpoint found for project ${projectId}`);
  }

  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf-8')) as TransformCheckpoint;
  const sourceMeta = JSON.parse(fs.readFileSync(path.join(projectDir, 'source.json'), 'utf-8')) as { source: string; type?: SourceType };
  const config = loadSetupConfig();
  const sourceType = sourceMeta.type ?? detectSourceType(sourceMeta.source);

  await executeTransformRun({
    source: sourceMeta.source,
    into: checkpoint.into,
    recipeName: checkpoint.recipe,
    targetLang: checkpoint.lang,
    projectDir,
    runDir: checkpoint.runDir,
    config,
    sourceType,
  });

  upsertManifest(projectDir, {
    ...manifest,
    status: 'complete',
    failedAt: null,
    failureReason: null,
  }, checkpoint.runDir);
}
