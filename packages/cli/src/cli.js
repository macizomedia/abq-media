#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync, spawnSync } from 'node:child_process';
import * as prompts from '@clack/prompts';

function arg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ask(question, fallback = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const v = answer.trim();
      resolve(v || fallback);
    });
  });
}

async function cmdInit() {
  const nonInteractive = hasFlag('--non-interactive');
  const force = hasFlag('--force') || hasFlag('--overwrite');
  let projectName = arg('--project');

  let llmProvider = arg('--llm-provider');
  let llmApiKey = arg('--llm-key');
  let asrProvider = arg('--asr-provider');
  let asrApiKey = arg('--asr-key');
  let lang = arg('--lang', 'es');
  let timezone = arg('--timezone', 'UTC');
  let asrModel = arg('--asr-model', 'whisper-1');
  let handle = arg('--handle');
  let cta = arg('--cta');
  let tone = arg('--tone', 'informative');
  let editorCommand = arg('--editor');

  if (!nonInteractive && process.stdin.isTTY) {
    if (!projectName) projectName = await ask(`Project name [${path.basename(process.cwd())}]: `, path.basename(process.cwd()));
    if (!llmProvider) llmProvider = await ask('LLM provider (openai|openrouter) [openai]: ', 'openai');
    if (!llmApiKey) llmApiKey = await ask('LLM API key (leave blank to skip): ');
    if (!asrProvider) asrProvider = await ask('ASR provider (openai|openrouter) [openai]: ', 'openai');
    if (!asrApiKey) asrApiKey = await ask('ASR API key (leave blank to skip): ');
    if (!lang) lang = await ask('Default language [es]: ', 'es');
    if (!timezone) timezone = await ask('Timezone [UTC]: ', 'UTC');
    if (!asrModel) asrModel = await ask('ASR model [whisper-1]: ', 'whisper-1');
    if (!handle) handle = await ask('Publishing handle (e.g. @you): ', '');
    if (!cta) cta = await ask('CTA (one sentence): ', '');
    if (!tone) tone = await ask('Tone preset [informative]: ', 'informative');
    if (!editorCommand) editorCommand = await ask('Preferred editor command (e.g. "code --wait") [auto]: ', '');
  } else {
    if (!llmProvider && !nonInteractive) llmProvider = 'openai';
  }

  if (!projectName) projectName = path.basename(process.cwd());

  const projectConfigPath = getProjectConfigPath(projectName);
  if (fs.existsSync(projectConfigPath) && !force) {
    if (nonInteractive) {
      console.error(`Project config exists: ${projectConfigPath}. Use --overwrite to update.`);
      process.exit(1);
    }
    const update = await ask('Project config exists. Update it? [y/N]: ', 'n');
    if (!/^y/i.test(update)) process.exit(0);
  }

  if (nonInteractive && (!llmProvider || !lang || !timezone)) {
    console.error('Missing required fields for non-interactive init. Provide --llm-provider, --lang, --timezone.');
    process.exit(1);
  }

  const existingCreds = readJson(getCredentialsPath()) || {};
  const detectedEditor = editorCommand || existingCreds.editorCommand || detectEditorCommand() || '';
  const credentials = {
    llmProvider: llmProvider || existingCreds.llmProvider || '',
    llmApiKey: llmApiKey || existingCreds.llmApiKey || '',
    asrProvider: asrProvider || existingCreds.asrProvider || llmProvider || '',
    asrApiKey: asrApiKey || existingCreds.asrApiKey || '',
    asrModel: asrModel || existingCreds.asrModel || 'whisper-1',
    editorCommand: detectedEditor,
    lang,
    timezone,
    updatedAt: new Date().toISOString()
  };

  const projectConfig = {
    projectName,
    handle: handle || '',
    cta: cta || '',
    tone: tone || 'informative',
    defaultLanguage: lang,
    defaultOutputs: ['full'],
    updatedAt: new Date().toISOString()
  };

  writeJson(getCredentialsPath(), credentials);
  writeJson(projectConfigPath, projectConfig);
  console.log(`Credentials written: ${getCredentialsPath()}`);
  console.log(`Project config written: ${projectConfigPath}`);
}

function runCommand(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { stdio: 'pipe', ...opts });
    return { ok: true, output: out.toString() };
  } catch (err) {
    const stderr = String(err?.stderr || err?.message || err);
    return { ok: false, error: stderr };
  }
}

function hasCmd(name) {
  const res = spawnSync('command', ['-v', name], { stdio: 'ignore' });
  return res.status === 0;
}

function detectEditorCommand() {
  const candidates = [
    { cmd: 'code', args: ['--wait'] },
    { cmd: 'cursor', args: ['--wait'] },
    { cmd: 'subl', args: ['--wait'] },
    { cmd: 'mate', args: ['-w'] }
  ];
  for (const c of candidates) {
    if (hasCmd(c.cmd)) return [c.cmd, ...c.args].join(' ');
  }
  return '';
}

function openInEditor(filePath, editorCommand = '') {
  const command = editorCommand || process.env.EDITOR || detectEditorCommand();
  if (!command) return false;
  const parts = command.split(' ').filter(Boolean);
  const bin = parts[0];
  const args = parts.slice(1);
  const res = spawnSync(bin, [...args, filePath], { stdio: 'inherit' });
  return res.status === 0;
}

async function editInTerminal(filePath) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  prompts.log.info('Editing mode (terminal).');
  prompts.log.info('Paste your text. Finish with a single "." on its own line.');
  prompts.log.info('Type "/cancel" to abort without changes.');
  if (current.trim()) {
    prompts.log.info('Current content preview:');
    process.stdout.write(`${current}\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = [];
  const askLine = () => new Promise((resolve) => rl.question('> ', resolve));

  while (true) {
    const line = await askLine();
    const trimmed = String(line || '').trim();
    if (trimmed === '/cancel') {
      rl.close();
      return false;
    }
    if (trimmed === '.') break;
    lines.push(line);
  }
  rl.close();

  if (!lines.length) return false;
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  return true;
}

function printHelp() {
  const rows = [
    ['init', 'Configure global credentials and a project profile'],
    ['run', 'Guided input flow (transcribe only, Phase 1)'],
    ['doctor', 'Check system readiness and OpenRouter connectivity'],
    ['reset', 'Reset local project data or credentials']
  ];
  const colWidth = rows.reduce((m, r) => Math.max(m, r[0].length), 0);
  console.log('abq-media commands:');
  for (const [cmd, desc] of rows) {
    console.log(`  ${cmd.padEnd(colWidth)}  ${desc}`);
  }
}

function getSamplesDir() {
  return path.resolve(import.meta.dirname, '../samples');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function getGlobalDir() {
  return path.join(os.homedir(), '.abq-media');
}

function getCredentialsPath() {
  return path.join(getGlobalDir(), 'credentials.json');
}

function getProjectsDir() {
  return path.join(getGlobalDir(), 'projects');
}

function isOpenRouterKey(key) {
  return typeof key === 'string' && key.startsWith('sk-or-') && key.length >= 20;
}

function listProjects() {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((d) => path.join(dir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .map((p) => path.basename(p))
    .sort();
}

function getProjectConfigPath(name) {
  return path.join(getProjectsDir(), name, 'config.json');
}

function getProjectRunsDir(name) {
  return path.join(getProjectsDir(), name, 'runs');
}

function getProjectExportsDir(name) {
  return path.join(getProjectsDir(), name, 'exports');
}

function getProjectRegistryPath(name) {
  return path.join(getProjectsDir(), name, 'registry.json');
}

function getProjectRunDir(name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(getProjectRunsDir(name), stamp);
}

function resolveLatestProjectRun(name) {
  const runsDir = getProjectRunsDir(name);
  if (!fs.existsSync(runsDir)) return null;
  const runs = fs.readdirSync(runsDir)
    .map((d) => path.join(runsDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return runs[0] || null;
}

function listProjectRuns(projectName) {
  const runsDir = getProjectRunsDir(projectName);
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .map((d) => path.join(runsDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map((runDir) => {
      const source = readJson(path.join(runDir, 'source.json')) || {};
      const state = readJson(path.join(runDir, 'state.json')) || { stages: {} };
      const has = (f) => fs.existsSync(path.join(runDir, f));
      return { runDir, source, state, has };
    });
}

function getRunStatePath(runDir) {
  return path.join(runDir, 'state.json');
}

function readRunState(runDir) {
  return readJson(getRunStatePath(runDir)) || null;
}

function writeRunState(runDir, state) {
  writeJson(getRunStatePath(runDir), state);
}

function initRunState() {
  return {
    stages: {
      transcribe: 'pending',
      clean: 'pending',
      summarize: 'pending',
      reformat: 'pending',
      brand_inject: 'pending',
      final: 'pending'
    },
    updatedAt: new Date().toISOString()
  };
}

function getYouTubeId(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace('/', '').trim() || null;
    }
    if (url.hostname.includes('youtube.com')) {
      return url.searchParams.get('v');
    }
  } catch {
    // ignore
  }
  return null;
}

function readRegistry(projectName) {
  return readJson(getProjectRegistryPath(projectName)) || [];
}

function writeRegistry(projectName, entries) {
  writeJson(getProjectRegistryPath(projectName), entries);
}

function registryKey({ sourceType, sourceId, source, lang }) {
  return `${sourceType}:${sourceId || source}:${lang}`;
}

function findRegistryEntry(projectName, info) {
  const entries = readRegistry(projectName);
  const key = registryKey(info);
  return entries.find((e) => e.key === key) || null;
}

function upsertRegistryEntry(projectName, info, transcriptPath) {
  const entries = readRegistry(projectName);
  const key = registryKey(info);
  const now = new Date().toISOString();
  const entry = {
    key,
    sourceType: info.sourceType,
    source: info.source,
    sourceId: info.sourceId || '',
    lang: info.lang,
    transcriptPath,
    createdAt: now
  };
  const idx = entries.findIndex((e) => e.key === key);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  writeRegistry(projectName, entries);
}

function resolveLatestPrepDir(cwd) {
  const outDir = path.resolve(cwd, 'output');
  if (fs.existsSync(outDir)) {
    const runs = fs.readdirSync(outDir)
      .filter((d) => d.startsWith('prep-'))
      .map((d) => path.join(outDir, d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (runs.length) return runs[0];
  }
  const pipelineOut = path.resolve(cwd, 'packages/pipeline-youtube-research-podcast/output');
  if (fs.existsSync(pipelineOut)) {
    const runs = fs.readdirSync(pipelineOut)
      .filter((d) => d.startsWith('prep-'))
      .map((d) => path.join(pipelineOut, d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (runs.length) return runs[0];
  }
  return null;
}

function resolveLatestPublishDir(cwd) {
  const outDir = path.resolve(cwd, 'output');
  if (fs.existsSync(outDir)) {
    const runs = fs.readdirSync(outDir)
      .filter((d) => d.startsWith('publish-'))
      .map((d) => path.join(outDir, d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (runs.length) return runs[0];
  }
  const pipelineOut = path.resolve(cwd, 'packages/pipeline-youtube-research-podcast/output');
  if (fs.existsSync(pipelineOut)) {
    const runs = fs.readdirSync(pipelineOut)
      .filter((d) => d.startsWith('publish-'))
      .map((d) => path.join(pipelineOut, d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (runs.length) return runs[0];
  }
  return null;
}

function resolveLatestPrepPrompt(cwd) {
  const dir = resolveLatestPrepDir(cwd);
  if (!dir) return null;
  const prompt = path.join(dir, 'deep_research_prompt.md');
  return fs.existsSync(prompt) ? prompt : null;
}


function previewMarkdown(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  if (hasCmd('bat')) {
    spawnSync('bat', ['--style=plain', filePath], { stdio: 'inherit' });
    return;
  }
  if (hasCmd('glow')) {
    spawnSync('glow', [filePath], { stdio: 'inherit' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  process.stdout.write(`\n${content}\n`);
}

function withSpinner(label, fn) {
  const spin = prompts.spinner();
  spin.start(label);
  try {
    const result = fn();
    spin.stop('Done');
    return result;
  } catch (err) {
    spin.stop('Failed');
    throw err;
  }
}

function statusNote(message) {
  prompts.log.info(message);
}

function renderStageSummary({ runDir, state, promptPath }) {
  const rows = [
    ['Run', runDir],
    ['Transcript', path.join(runDir, 'transcript.txt')],
    ['Clean', path.join(runDir, 'clean.txt')],
    ['Summary', path.join(runDir, 'summary.txt')],
    ['Prompt', promptPath || 'n/a'],
    ['Brand notes', path.join(runDir, 'brand.txt')]
  ];
  const maxKey = rows.reduce((m, r) => Math.max(m, r[0].length), 0);
  const maxVal = rows.reduce((m, r) => Math.max(m, r[1].length), 0);
  const border = `┌${'─'.repeat(maxKey + 2)}┬${'─'.repeat(maxVal + 2)}┐`;
  const footer = `└${'─'.repeat(maxKey + 2)}┴${'─'.repeat(maxVal + 2)}┘`;
  const lines = [border];
  for (const [k, v] of rows) {
    lines.push(`│ ${k.padEnd(maxKey)} │ ${v.padEnd(maxVal)} │`);
  }
  lines.push(footer);

  const statusTag = (v) => {
    if (v === 'done') return '[ok]';
    if (v === 'in_progress') return '[..]';
    return '[--]';
  };
  const stateLines = Object.entries(state.stages || {})
    .map(([k, v]) => `- ${statusTag(v)} ${k}: ${v}`)
    .join('\n');

  prompts.log.info(`${lines.join('\n')}\n\nStages:\n${stateLines}`);
}

async function cmdDoctor() {
  const credentials = readJson(getCredentialsPath()) || {};
  const key = credentials.openrouterKey || credentials.llmApiKey || '';
  const keyFormatOk = isOpenRouterKey(key);

  let apiOk = false;
  let latencyMs = null;
  let apiError = '';
  if (keyFormatOk) {
    const start = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { authorization: `Bearer ${key}` }
      });
      latencyMs = Date.now() - start;
      apiOk = res.ok;
      if (!res.ok) {
        const t = await res.text();
        apiError = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      }
    } catch (err) {
      latencyMs = Date.now() - start;
      apiError = String(err?.message || err);
    }
  }

  const checks = {
    nodeVersion: process.version,
    openrouterKeyFormat: keyFormatOk,
    openrouterApi: apiOk,
    latencyMs
  };

  const hints = [
    keyFormatOk ? null : 'OpenRouter keys start with sk-or-',
    apiOk || !keyFormatOk ? null : `OpenRouter API check failed: ${apiError || 'unknown error'}`
  ].filter(Boolean);

  const ok = keyFormatOk && apiOk;
  console.log(JSON.stringify({ ok, checks, hints }, null, 2));
}

async function cmdReset() {
  const targetProject = arg('--project');
  const resetAll = hasFlag('--all');
  const resetCreds = hasFlag('--credentials');

  const doResetProject = (name) => {
    const dir = path.join(getProjectsDir(), name);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  };

  const doResetAll = () => {
    const dir = getProjectsDir();
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  };

  const doResetCreds = () => {
    const p = getCredentialsPath();
    if (!fs.existsSync(p)) return false;
    fs.rmSync(p, { force: true });
    return true;
  };

  if (resetAll || targetProject || resetCreds) {
    const confirm = await prompts.confirm({ message: 'This will delete local data. Continue?', initialValue: false });
    if (prompts.isCancel(confirm) || !confirm) return prompts.cancel('Aborted.');
    const results = [];
    if (resetAll) results.push(`Projects reset: ${doResetAll() ? 'ok' : 'none'}`);
    if (targetProject) results.push(`Project ${targetProject}: ${doResetProject(targetProject) ? 'ok' : 'not found'}`);
    if (resetCreds) results.push(`Credentials: ${doResetCreds() ? 'ok' : 'none'}`);
    return prompts.outro(results.join('\n'));
  }

  const choice = await prompts.select({
    message: 'Reset options',
    options: [
      { value: 'project', label: 'Reset one project' },
      { value: 'all', label: 'Reset all projects' },
      { value: 'creds', label: 'Reset credentials' },
      { value: 'cancel', label: 'Cancel' }
    ]
  });
  if (prompts.isCancel(choice) || choice === 'cancel') return prompts.cancel('Aborted.');

  if (choice === 'project') {
    const projects = listProjects();
    if (!projects.length) return prompts.cancel('No projects found.');
    const pick = await prompts.select({
      message: 'Choose project',
      options: projects.map((p) => ({ value: p, label: p }))
    });
    if (prompts.isCancel(pick)) return prompts.cancel('Aborted.');
    const confirm = await prompts.confirm({ message: `Delete project ${pick}?`, initialValue: false });
    if (prompts.isCancel(confirm) || !confirm) return prompts.cancel('Aborted.');
    return prompts.outro(`Project ${pick}: ${doResetProject(pick) ? 'ok' : 'not found'}`);
  }

  if (choice === 'all') {
    const confirm = await prompts.confirm({ message: 'Delete ALL projects?', initialValue: false });
    if (prompts.isCancel(confirm) || !confirm) return prompts.cancel('Aborted.');
    return prompts.outro(`Projects reset: ${doResetAll() ? 'ok' : 'none'}`);
  }

  if (choice === 'creds') {
    const confirm = await prompts.confirm({ message: 'Delete stored credentials?', initialValue: false });
    if (prompts.isCancel(confirm) || !confirm) return prompts.cancel('Aborted.');
    return prompts.outro(`Credentials: ${doResetCreds() ? 'ok' : 'none'}`);
  }
}

function copyToClipboard(text) {
  if (!hasCmd('pbcopy')) return false;
  try {
    const res = spawnSync('pbcopy', [], { input: text });
    return res.status === 0;
  } catch {
    return false;
  }
}

function splitSocialPosts(content) {
  const raw = String(content || '');
  const twitterIdx = raw.toLowerCase().indexOf('twitter');
  const linkedinIdx = raw.toLowerCase().indexOf('linkedin');
  const instagramIdx = raw.toLowerCase().indexOf('instagram');
  const twitter = twitterIdx >= 0 ? raw.slice(twitterIdx, linkedinIdx >= 0 ? linkedinIdx : undefined).trim() : '';
  const linkedin = linkedinIdx >= 0 ? raw.slice(linkedinIdx, instagramIdx >= 0 ? instagramIdx : undefined).trim() : '';
  return {
    twitter: twitter || raw,
    linkedin: linkedin || raw
  };
}

function exportZipPackage({ projectName, runDir, publishDir }) {
  if (!hasCmd('zip')) {
    prompts.log.error('zip is not available on this system.');
    return null;
  }
  const exportDir = getProjectExportsDir(projectName);
  ensureDir(exportDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workDir = path.join(exportDir, `export-${stamp}`);
  ensureDir(workDir);

  const files = [];
  const summarySrc = path.join(runDir, 'summary.txt');
  const summaryDest = path.join(workDir, 'summary.txt');
  if (fs.existsSync(summarySrc)) {
    fs.copyFileSync(summarySrc, summaryDest);
    files.push(summaryDest);
  }

  if (publishDir) {
    const articleSrc = path.join(publishDir, 'article.md');
    if (fs.existsSync(articleSrc)) {
      const articleDest = path.join(workDir, 'article.md');
      fs.copyFileSync(articleSrc, articleDest);
      files.push(articleDest);
    }
    const socialSrc = path.join(publishDir, 'social_posts.md');
    if (fs.existsSync(socialSrc)) {
      const social = fs.readFileSync(socialSrc, 'utf8');
      const { twitter, linkedin } = splitSocialPosts(social);
      const twitterDest = path.join(workDir, 'social-twitter.txt');
      const linkedinDest = path.join(workDir, 'social-linkedin.txt');
      fs.writeFileSync(twitterDest, twitter.trim() + '\n');
      fs.writeFileSync(linkedinDest, linkedin.trim() + '\n');
      files.push(twitterDest, linkedinDest);
    }
  }

  const audioSrc = path.join(runDir, 'audio-clean.mp3');
  if (fs.existsSync(audioSrc)) {
    const audioDest = path.join(workDir, 'audio-clean.mp3');
    fs.copyFileSync(audioSrc, audioDest);
    files.push(audioDest);
  }

  const podcastMp3Src = path.join(runDir, 'podcast.mp3');
  if (fs.existsSync(podcastMp3Src)) {
    const podcastMp3Dest = path.join(workDir, 'podcast.mp3');
    fs.copyFileSync(podcastMp3Src, podcastMp3Dest);
    files.push(podcastMp3Dest);
  }

  const podcastScriptSrc = path.join(runDir, 'podcast_script.md');
  if (fs.existsSync(podcastScriptSrc)) {
    const podcastScriptDest = path.join(workDir, 'podcast_script.md');
    fs.copyFileSync(podcastScriptSrc, podcastScriptDest);
    files.push(podcastScriptDest);
  }

  const reelScriptSrc = path.join(runDir, 'reel_script.md');
  if (fs.existsSync(reelScriptSrc)) {
    const reelScriptDest = path.join(workDir, 'reel_script.md');
    fs.copyFileSync(reelScriptSrc, reelScriptDest);
    files.push(reelScriptDest);
  }

  const socialPostsSrc = path.join(runDir, 'social_posts.md');
  if (fs.existsSync(socialPostsSrc)) {
    const socialPostsDest = path.join(workDir, 'social_posts.md');
    fs.copyFileSync(socialPostsSrc, socialPostsDest);
    files.push(socialPostsDest);
  }

  const meta = {
    project: projectName,
    runDir,
    publishDir: publishDir || null,
    createdAt: new Date().toISOString()
  };
  const metaDest = path.join(workDir, 'metadata.json');
  fs.writeFileSync(metaDest, JSON.stringify(meta, null, 2));
  files.push(metaDest);

  const zipPath = path.join(exportDir, `${projectName}-${stamp}.zip`);
  const fileArgs = files.map((f) => `"${f}"`).join(' ');
  runCommand(`zip -j "${zipPath}" ${fileArgs}`, { cwd: exportDir });
  return { zipPath, workDir };
}

function writeDebugOutputs(outDir) {
  ensureDir(outDir);
  const samplesDir = getSamplesDir();
  const files = [
    ['transcript.txt', 'transcript.txt'],
    ['prompt.md', 'deep_research_prompt.md'],
    ['podcast_script.md', 'podcast_script.md'],
    ['article.md', 'article.md'],
    ['reel_script.md', 'reel_script.md'],
    ['social_posts.md', 'social_posts.md']
  ];
  for (const [src, dest] of files) {
    fs.copyFileSync(path.join(samplesDir, src), path.join(outDir, dest));
  }
  fs.writeFileSync(path.join(outDir, 'podcast.mp3'), '');
  fs.writeFileSync(path.join(outDir, 'video.mp4'), '');
  return outDir;
}

async function cmdRun() {
  prompts.intro('abq-media');
  const debuggerMode = process.argv.includes('--debugger');
  let projectName = arg('--project');

  if (!projectName && !debuggerMode) {
    const projects = listProjects();
    if (projects.length) {
      const choice = await prompts.select({
        message: 'Choose a project',
        options: [
          ...projects.map((p) => ({ value: p, label: p })),
          { value: '__new__', label: 'New project' }
        ]
      });
      if (prompts.isCancel(choice)) return prompts.cancel('Aborted.');
      if (choice === '__new__') {
        const name = await prompts.text({ message: 'Project name', initialValue: path.basename(process.cwd()) });
        if (prompts.isCancel(name) || !name) return prompts.cancel('Aborted.');
        projectName = String(name).trim();
      } else {
        projectName = choice;
      }
    } else {
      const name = await prompts.text({ message: 'Project name', initialValue: path.basename(process.cwd()) });
      if (prompts.isCancel(name) || !name) return prompts.cancel('Aborted.');
      projectName = String(name).trim();
    }
  }

  if (!projectName) projectName = 'default';

  let runDir = null;
  if (!debuggerMode) {
    const latest = resolveLatestProjectRun(projectName);
    if (latest) {
      const existingState = readRunState(latest);
      const hasIncomplete = existingState && Object.values(existingState.stages || {}).some((v) => v !== 'done');
      if (hasIncomplete) {
        const resume = await prompts.confirm({
          message: 'Resume the last incomplete run?',
          initialValue: true
        });
        if (prompts.isCancel(resume)) return prompts.cancel('Aborted.');
        if (resume) runDir = latest;
      }
    }
  }
  if (!runDir) runDir = getProjectRunDir(projectName);
  ensureDir(runDir);
  let state = readRunState(runDir) || initRunState();
  writeRunState(runDir, state);

  // Hoisted so both debugger and normal paths can write these before the keepGoing loop
  let prepDir = null;
  let transcriptDest = '';
  let lastPublishDir = null;
  let lang = 'es';
  let promptDest = null;

  const session = { transcript: '', article: '', podcastScript: '', reelScript: '', socialPosts: '', runDir };

  if (debuggerMode) {
    prompts.log.info('Debugger mode: using sample artifacts (no external calls).');
    writeDebugOutputs(runDir);
    const transcriptPath = path.join(runDir, 'transcript.txt');
    previewMarkdown(transcriptPath);
    prepDir = runDir;
    transcriptDest = path.join(runDir, 'transcript.txt');
    lastPublishDir = runDir;
    session.transcript = transcriptDest;
    state.stages.transcribe = 'done';
    state.stages.clean = 'done';
    state.stages.summarize = 'done';
    writeRunState(runDir, state);
  } else {

  const inputType = await prompts.select({
    message: 'Select input type',
    options: [
      { value: 'youtube', label: 'YouTube URL' },
      { value: 'audio', label: 'Audio file' },
      { value: 'document', label: 'Document (.pdf/.docx) — coming soon' },
      { value: 'textfile', label: 'Text file' },
      { value: 'raw', label: 'Raw text' },
      { value: 'browse', label: 'Browse previous runs' },
      { value: 'back', label: '⬅ Back' }
    ]
  });
  if (prompts.isCancel(inputType)) return prompts.cancel('Aborted.');
  if (inputType === 'back') return cmdRun();

  if (inputType === 'browse') {
    const runs = listProjectRuns(projectName);
    if (!runs.length) {
      prompts.log.info('No previous runs found. Start a new input instead.');
      return cmdRun();
    }
    const typeLabel = { youtube: 'YT', audio: 'Audio', textfile: 'File', raw: 'Text' };
    const runOptions = runs.map(({ runDir: rd, source, has }) => {
      const type = typeLabel[source.sourceType] || source.sourceType || '?';
      const src = source.sourceId || path.basename(source.source || '') || 'unknown';
      const lg = source.lang || '?';
      const date = (source.createdAt || '').slice(0, 10) || path.basename(rd).slice(0, 10);
      const badges = [
        has('transcript.txt')    ? 'transcript' : null,
        has('prompt.md')         ? 'prompt'     : null,
        has('article.md')        ? 'article'    : null,
        has('podcast_script.md') ? 'podcast'    : null,
        has('reel_script.md')    ? 'reel'       : null,
      ].filter(Boolean).join(' · ');
      return { value: rd, label: `[${type}] ${src} (${lg})  ${badges || 'empty'}  ${date}` };
    });
    runOptions.push({ value: '__back__', label: '⬅ Back' });
    const pick = await prompts.select({ message: 'Select a previous run to load', options: runOptions });
    if (prompts.isCancel(pick) || pick === '__back__') return cmdRun();
    const picked = runs.find((r) => r.runDir === pick);
    if (picked) {
      runDir = picked.runDir;
      session.runDir = runDir;
      state = picked.state;
      lang = picked.source.lang || 'es';
      const tPath = path.join(runDir, 'transcript.txt');
      if (fs.existsSync(tPath)) { transcriptDest = tPath; session.transcript = tPath; }
      promptDest = fs.existsSync(path.join(runDir, 'prompt.md')) ? path.join(runDir, 'prompt.md') : null;
      const aPath = path.join(runDir, 'article.md');
      if (fs.existsSync(aPath)) session.article = aPath;
      const psPath = path.join(runDir, 'podcast_script.md');
      if (fs.existsSync(psPath)) session.podcastScript = psPath;
      const rsPath = path.join(runDir, 'reel_script.md');
      if (fs.existsSync(rsPath)) session.reelScript = rsPath;
      const socialPath = path.join(runDir, 'social_posts.md');
      if (fs.existsSync(socialPath)) session.socialPosts = socialPath;
      lastPublishDir = resolveLatestPublishDir(process.cwd());
      prepDir = resolveLatestPrepDir(process.cwd());
    }
  } else {

  let inputArg = '';
  let sourceInfo = { sourceType: inputType, source: '', sourceId: '', lang: '' };
  if (inputType === 'youtube') {
    const url = await prompts.text({ message: 'Paste YouTube URL' });
    if (prompts.isCancel(url) || !url) return prompts.cancel('Aborted.');
    if (String(url).trim().toLowerCase() === 'back') return cmdRun();
    inputArg = `--url "${url}"`;
    sourceInfo.source = String(url).trim();
    sourceInfo.sourceId = getYouTubeId(sourceInfo.source) || '';
  } else if (inputType === 'audio') {
    const p = await prompts.text({ message: 'Path to audio file' });
    if (prompts.isCancel(p) || !p) return prompts.cancel('Aborted.');
    if (String(p).trim().toLowerCase() === 'back') return cmdRun();
    inputArg = `--audio-file "${p}"`;
    sourceInfo.source = String(p).trim();
  } else if (inputType === 'document') {
    prompts.log.info('Document support (.pdf/.docx) is coming soon.');
    return cmdRun();
  } else if (inputType === 'textfile') {
    const p = await prompts.text({ message: 'Path to text file' });
    if (prompts.isCancel(p) || !p) return prompts.cancel('Aborted.');
    if (String(p).trim().toLowerCase() === 'back') return cmdRun();
    inputArg = `--text-file "${p}"`;
    sourceInfo.source = String(p).trim();
  } else {
    const t = await prompts.text({ message: 'Paste text' });
    if (prompts.isCancel(t) || !t) return prompts.cancel('Aborted.');
    if (String(t).trim().toLowerCase() === 'back') return cmdRun();
    const tmp = path.join(os.tmpdir(), `abq-raw-${Date.now()}.txt`);
    fs.writeFileSync(tmp, t);
    inputArg = `--text-file "${tmp}"`;
    sourceInfo.source = 'raw-text';
  }

  const projectConfig = readJson(getProjectConfigPath(projectName)) || {};
  const credentials = readJson(getCredentialsPath()) || {};
  const defaultLang = projectConfig.defaultLanguage || credentials.lang || 'es';

  lang = await prompts.select({
    message: 'Language',
    options: [
      { value: 'es', label: 'Spanish (es)' },
      { value: 'en', label: 'English (en)' },
      { value: 'back', label: '⬅ Back' }
    ],
    initialValue: defaultLang
  });
  if (prompts.isCancel(lang)) return prompts.cancel('Aborted.');
  if (lang === 'back') return cmdRun();
  sourceInfo.lang = lang;

  let prepCmd = `npm run yt:prep -- ${inputArg} --lang ${lang}`.trim();
  let reuse = false;
  if (inputType === 'youtube') {
    const existing = findRegistryEntry(projectName, sourceInfo);
    if (existing && fs.existsSync(existing.transcriptPath)) {
      const reuseChoice = await prompts.confirm({
        message: 'Transcript already exists for this video. Reuse it?',
        initialValue: true
      });
      if (prompts.isCancel(reuseChoice)) return prompts.cancel('Aborted.');
      reuse = reuseChoice;
      if (reuse) {
        const transcriptDest = path.join(runDir, 'transcript.txt');
        fs.copyFileSync(existing.transcriptPath, transcriptDest);
        const meta = {
          sourceType: sourceInfo.sourceType,
          source: sourceInfo.source,
          sourceId: sourceInfo.sourceId,
          lang: sourceInfo.lang,
          reused: true,
          createdAt: new Date().toISOString()
        };
        fs.writeFileSync(path.join(runDir, 'source.json'), JSON.stringify(meta, null, 2));
      }
    }
  }

  if (!reuse) {
    if (inputType === 'youtube') {
      prompts.log.info('Checking captions...');
      prepCmd = `${prepCmd} --use-captions`;
    } else {
      prompts.log.info('Running prep...');
    }

    statusNote('Working on your transcript. This can take a few minutes. Please keep this window open.');
    let prep = withSpinner('Transcribing source...', () => runCommand(prepCmd, { cwd: process.cwd() }));
    if (!prep.ok && inputType === 'youtube') {
      const wantsAsr = await prompts.confirm({
        message: 'No captions found. Use ASR instead? (dev mode only, may consume credits)',
        initialValue: true
      });
      if (prompts.isCancel(wantsAsr) || !wantsAsr) {
        prompts.log.error(prep.error || 'Prep failed');
        return prompts.cancel('Aborted.');
      }
      statusNote('ASR is running. This may take several minutes depending on audio length.');
      prep = withSpinner('Transcribing source...', () => runCommand(`${`npm run yt:prep -- ${inputArg} --lang ${lang}`} --use-asr`, { cwd: process.cwd() }));
    }
    if (!prep.ok) {
      prompts.log.error(prep.error || 'Prep failed');
      return prompts.cancel('Aborted.');
    }
  }

  prepDir = resolveLatestPrepDir(process.cwd());
  if (!reuse && !prepDir) {
    prompts.log.error('Prep output not found.');
    return prompts.cancel('Aborted.');
  }

  transcriptDest = path.join(runDir, 'transcript.txt');
  if (!reuse) {
    const transcriptSrc = path.join(prepDir, 'transcript.txt');
    if (!fs.existsSync(transcriptSrc)) {
      prompts.log.error('Transcript not found in prep output.');
      return prompts.cancel('Aborted.');
    }
    fs.copyFileSync(transcriptSrc, transcriptDest);
    const metaSrc = path.join(prepDir, 'metadata.json');
    if (fs.existsSync(metaSrc)) fs.copyFileSync(metaSrc, path.join(runDir, 'metadata.json'));
    fs.writeFileSync(path.join(runDir, 'source.json'), JSON.stringify({
      sourceType: sourceInfo.sourceType,
      source: sourceInfo.source,
      sourceId: sourceInfo.sourceId,
      lang: sourceInfo.lang,
      reused: false,
      createdAt: new Date().toISOString()
    }, null, 2));
  }
  upsertRegistryEntry(projectName, sourceInfo, transcriptDest);
  session.transcript = transcriptDest;
  state.stages.transcribe = 'done';
  state.updatedAt = new Date().toISOString();
  writeRunState(runDir, state);

  let gate = true;
  while (gate) {
    const action = await prompts.select({
      message: 'Transcript ready',
      options: [
        { value: 'view', label: 'View' },
        { value: 'edit', label: 'Edit (terminal)' },
        { value: 'continue', label: 'Continue' },
        { value: 'back', label: '⬅ Back' }
      ]
    });
    if (prompts.isCancel(action)) return prompts.cancel('Aborted.');
    if (action === 'back') return cmdRun();
    if (action === 'view') previewMarkdown(transcriptDest);
    if (action === 'edit') {
      const credentials = readJson(getCredentialsPath()) || {};
      const editorCmd = credentials.editorCommand || '';
      const ok = openInEditor(transcriptDest, editorCmd);
      if (!ok) await editInTerminal(transcriptDest);
    }
    if (action === 'continue') gate = false;
  }

  const cleanDest = path.join(runDir, 'clean.txt');
  if (state.stages.clean !== 'done') {
    fs.copyFileSync(transcriptDest, cleanDest);
    let cleanGate = true;
    while (cleanGate) {
      const action = await prompts.select({
        message: 'Cleaned transcript',
        options: [
          { value: 'view', label: 'View' },
          { value: 'edit', label: 'Edit (terminal)' },
          { value: 'continue', label: 'Continue' },
          { value: 'back', label: '⬅ Back' }
        ]
      });
      if (prompts.isCancel(action)) return prompts.cancel('Aborted.');
      if (action === 'back') return cmdRun();
      if (action === 'view') previewMarkdown(cleanDest);
      if (action === 'edit') {
        const credentials = readJson(getCredentialsPath()) || {};
        const editorCmd = credentials.editorCommand || '';
        const ok = openInEditor(cleanDest, editorCmd);
        if (!ok) await editInTerminal(cleanDest);
      }
      if (action === 'continue') cleanGate = false;
    }
    state.stages.clean = 'done';
    state.updatedAt = new Date().toISOString();
    writeRunState(runDir, state);
  }

  const summaryDest = path.join(runDir, 'summary.txt');
  if (state.stages.summarize !== 'done') {
    const digestSrc = prepDir ? path.join(prepDir, 'digest.md') : null;
    if (digestSrc && fs.existsSync(digestSrc)) {
      fs.copyFileSync(digestSrc, summaryDest);
    } else {
      fs.writeFileSync(summaryDest, fs.readFileSync(cleanDest, 'utf8'));
    }
    let summaryGate = true;
    while (summaryGate) {
      const action = await prompts.select({
        message: 'Summary ready',
        options: [
          { value: 'view', label: 'View' },
          { value: 'edit', label: 'Edit (terminal)' },
          { value: 'continue', label: 'Continue' },
          { value: 'back', label: '⬅ Back' }
        ]
      });
      if (prompts.isCancel(action)) return prompts.cancel('Aborted.');
      if (action === 'back') return cmdRun();
      if (action === 'view') previewMarkdown(summaryDest);
      if (action === 'edit') {
        const credentials = readJson(getCredentialsPath()) || {};
        const editorCmd = credentials.editorCommand || '';
        const ok = openInEditor(summaryDest, editorCmd);
        if (!ok) await editInTerminal(summaryDest);
      }
      if (action === 'continue') summaryGate = false;
    }
    state.stages.summarize = 'done';
    state.updatedAt = new Date().toISOString();
    writeRunState(runDir, state);
  }

  } // end else (new input path)
  } // end else (!debuggerMode) — input collection and prep

  let keepGoing = true;
  while (keepGoing) {
    const readyItems = [];
    if (session.transcript) readyItems.push('transcript');
    if (session.article) readyItems.push('article');
    if (session.podcastScript) readyItems.push('podcast script');
    if (session.reelScript) readyItems.push('reel script');
    const readyStr = readyItems.length ? `Ready: ${readyItems.join(', ')} — ` : '';
    const hasPrompt = !!promptDest;
    const hasPodcastScript = !!session.podcastScript || fs.existsSync(path.join(runDir, 'podcast_script.md'));
    const hasAnyContent = !!(session.article || session.podcastScript || session.reelScript);
    const menuOptions = [
      { value: 'export', label: 'Use transcript only (export)' },
      { value: 'translate', label: 'Translate transcript (coming soon)' },
      { value: 'prompt', label: hasPrompt ? 'Regenerate research prompt' : 'Generate deep research prompt' },
      ...(hasPrompt ? [
        { value: 'article', label: 'Generate article' },
        { value: 'podcast_script', label: 'Generate podcast script' },
        { value: 'reel_script', label: 'Generate video / reel script' },
      ] : []),
      ...(hasPodcastScript ? [{ value: 'tts', label: 'Render podcast audio (ElevenLabs)' }] : []),
      ...(hasAnyContent ? [{ value: 'export_zip', label: 'Export package (zip)' }] : []),
      { value: 'summary', label: 'View stage summary' },
      { value: 'list_files', label: 'Browse previous runs' },
      { value: 'done', label: 'Finish' }
    ];
    const next = await prompts.select({
      message: `${readyStr}What do you want to do next?`,
      options: menuOptions
    });
    if (prompts.isCancel(next)) return prompts.cancel('Aborted.');

    if (next === 'done') {
      const summaryLines = [
        session.transcript    ? '✓ Transcript'    : null,
        session.article       ? '✓ Article'        : null,
        session.podcastScript ? '✓ Podcast script' : null,
        session.reelScript    ? '✓ Reel script'    : null,
        session.socialPosts   ? '✓ Social posts'   : null,
        state.stages.tts === 'done' ? '✓ Audio (MP3)' : null,
      ].filter(Boolean);
      if (summaryLines.length) {
        prompts.note(summaryLines.join('\n'), 'Session complete');
      }
      break;
    }

    if (next === 'summary') {
      renderStageSummary({ runDir, state, promptPath: promptDest });
      continue;
    }

    if (next === 'list_files') {
      const runs = listProjectRuns(projectName);
      if (!runs.length) {
        prompts.log.info('No previous runs found for this project.');
        continue;
      }
      const typeLabel = { youtube: 'YT', audio: 'Audio', textfile: 'File', raw: 'Text' };
      const runOptions = runs.map(({ runDir: rd, source, has }) => {
        const type = typeLabel[source.sourceType] || source.sourceType || '?';
        const src = source.sourceId || path.basename(source.source || '') || 'unknown';
        const lang = source.lang || '?';
        const date = (source.createdAt || '').slice(0, 10) || path.basename(rd).slice(0, 10);
        const badges = [
          has('transcript.txt') ? 'transcript' : null,
          has('prompt.md')      ? 'prompt'     : null,
          has('article.md')     ? 'article'    : null,
          has('podcast_script.md') ? 'podcast' : null,
          has('reel_script.md') ? 'reel'       : null,
        ].filter(Boolean).join(' · ');
        return { value: rd, label: `[${type}] ${src} (${lang})  ${badges || 'empty'}  ${date}` };
      });
      runOptions.push({ value: '__back__', label: '⬅ Back' });

      const pick = await prompts.select({ message: 'Select a previous run to load', options: runOptions });
      if (prompts.isCancel(pick) || pick === '__back__') continue;

      const picked = runs.find((r) => r.runDir === pick);
      if (!picked) continue;

      runDir = picked.runDir;
      session.runDir = runDir;
      state = picked.state;
      lang = picked.source.lang || 'es';

      const tPath = path.join(runDir, 'transcript.txt');
      if (fs.existsSync(tPath)) { transcriptDest = tPath; session.transcript = tPath; }

      promptDest = fs.existsSync(path.join(runDir, 'prompt.md')) ? path.join(runDir, 'prompt.md') : null;

      const aPath = path.join(runDir, 'article.md');
      if (fs.existsSync(aPath)) session.article = aPath;

      const psPath = path.join(runDir, 'podcast_script.md');
      if (fs.existsSync(psPath)) session.podcastScript = psPath;

      const rsPath = path.join(runDir, 'reel_script.md');
      if (fs.existsSync(rsPath)) session.reelScript = rsPath;

      const socialPath = path.join(runDir, 'social_posts.md');
      if (fs.existsSync(socialPath)) session.socialPosts = socialPath;

      lastPublishDir = resolveLatestPublishDir(process.cwd());
      prepDir = resolveLatestPrepDir(process.cwd());

      prompts.log.success(`Loaded: ${path.basename(runDir)}`);
      continue;
    }

    if (next === 'export') {
      const exportDir = getProjectExportsDir(projectName);
      ensureDir(exportDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportPath = path.join(exportDir, `transcript-${stamp}.txt`);
      fs.copyFileSync(transcriptDest, exportPath);
      prompts.log.info(`Exported transcript: ${exportPath}`);
      continue;
    }

    if (next === 'translate') {
      prompts.log.warn('Translation coming in v1.1. Export your transcript and use DeepL for now.');
      continue;
    }

    if (next === 'export_zip') {
      const exportResult = exportZipPackage({ projectName, runDir, publishDir: lastPublishDir });
      if (!exportResult) {
        prompts.log.error('Export failed.');
        continue;
      }
      prompts.log.info(`Zip created: ${exportResult.zipPath}`);

      const offerCopy = async (label, filePath) => {
        if (!filePath || !fs.existsSync(filePath)) return;
        const ok = await prompts.confirm({ message: `Copy ${label} to clipboard?`, initialValue: false });
        if (prompts.isCancel(ok) || !ok) return;
        const text = fs.readFileSync(filePath, 'utf8');
        if (!copyToClipboard(text)) {
          prompts.log.warn('Clipboard not available.');
        } else {
          prompts.log.info(`${label} copied.`);
        }
      };

      await offerCopy('article', path.join(exportResult.workDir, 'article.md'));
      await offerCopy('twitter thread', path.join(exportResult.workDir, 'social-twitter.txt'));
      await offerCopy('linkedin post', path.join(exportResult.workDir, 'social-linkedin.txt'));
      await offerCopy('summary', path.join(exportResult.workDir, 'summary.txt'));
      continue;
    }

    if (next === 'tts') {
      const podcastScriptPath = path.join(runDir, 'podcast_script.md');
      if (!fs.existsSync(podcastScriptPath)) {
        prompts.log.warn('No podcast script found. Generate one first via the article path.');
        continue;
      }
      const ttsConfig = readJson(path.resolve(process.cwd(), '.abq-module.json')) || {};
      const ttsKey = ttsConfig.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '';
      if (!ttsKey) {
        prompts.log.error('ElevenLabs API key not set. Add elevenLabsApiKey to .abq-module.json or set ELEVENLABS_API_KEY=<key> in your environment.');
        continue;
      }
      const ttsCmd = `node packages/adapter-elevenlabs-tts/src/cli.js render --input "${podcastScriptPath}" --output "${path.join(runDir, 'podcast.mp3')}"`;
      prompts.log.info(`Will run: ${ttsCmd}`);
      const confirmTts = await prompts.confirm({ message: 'Run ElevenLabs TTS now?', initialValue: false });
      if (prompts.isCancel(confirmTts) || !confirmTts) { continue; }
      const ttsResult = withSpinner('Rendering audio...', () => runCommand(ttsCmd, { cwd: process.cwd() }));
      const audioOut = path.join(runDir, 'podcast.mp3');
      if (fs.existsSync(audioOut)) {
        prompts.log.success(`Audio saved: ${audioOut}`);
        state.stages.tts = 'done';
        state.updatedAt = new Date().toISOString();
        writeRunState(runDir, state);
      } else {
        prompts.log.error(ttsResult?.error || 'Render failed — no output file produced.');
      }
      continue;
    }

    if (next === 'podcast_script' || next === 'reel_script') {
      if (!lastPublishDir) {
        if (!promptDest || !fs.existsSync(promptDest)) {
          prompts.log.warn('Generate the deep research prompt first.');
          continue;
        }
        statusNote('Generating scripts. This can take a minute.');
        const publishCmd = `npm run yt:publish -- --input "${promptDest}" --lang ${lang}`;
        const pub = withSpinner('Generating content...', () => runCommand(publishCmd, { cwd: process.cwd() }));
        if (!pub.ok) {
          prompts.log.error(pub.error || 'Generation failed');
          continue;
        }
        lastPublishDir = resolveLatestPublishDir(process.cwd());
        if (!lastPublishDir) {
          prompts.log.error('Publish output not found.');
          continue;
        }
        const articleSrc = path.join(lastPublishDir, 'article.md');
        if (fs.existsSync(articleSrc) && !session.article) {
          const articleDest = path.join(runDir, 'article.md');
          fs.copyFileSync(articleSrc, articleDest);
          session.article = articleDest;
        }
      }
      const outputFile = next === 'podcast_script' ? 'podcast_script.md' : 'reel_script.md';
      const outputSrc = path.join(lastPublishDir, outputFile);
      if (!fs.existsSync(outputSrc)) {
        prompts.log.warn(`${outputFile} not found in publish output.`);
        continue;
      }
      const outputDest = path.join(runDir, outputFile);
      fs.copyFileSync(outputSrc, outputDest);
      if (next === 'podcast_script') session.podcastScript = outputDest;
      else session.reelScript = outputDest;

      previewMarkdown(outputDest);
      let scriptGate = true;
      while (scriptGate) {
        const action = await prompts.select({
          message: `${outputFile} ready`,
          options: [
            { value: 'view', label: 'View' },
            { value: 'edit', label: 'Edit (terminal)' },
            { value: 'continue', label: 'Continue' }
          ]
        });
        if (prompts.isCancel(action)) { scriptGate = false; break; }
        if (action === 'view') previewMarkdown(outputDest);
        if (action === 'edit') {
          const creds = readJson(getCredentialsPath()) || {};
          const editorCmd = creds.editorCommand || '';
          const ok = openInEditor(outputDest, editorCmd);
          if (!ok) await editInTerminal(outputDest);
        }
        if (action === 'continue') scriptGate = false;
      }
      state.stages[next] = 'done';
      state.updatedAt = new Date().toISOString();
      writeRunState(runDir, state);
      continue;
    }

    if (next === 'prompt' || next === 'article') {
      let promptSourceDir = prepDir;
      if (!promptSourceDir) {
        const promptPrepCmd = `npm run yt:prep -- --transcript-file "${transcriptDest}" --lang ${lang}`;
        statusNote('Generating the research prompt. This can take a minute.');
        const promptPrep = withSpinner('Generating research prompt...', () => runCommand(promptPrepCmd, { cwd: process.cwd() }));
        if (!promptPrep.ok) {
          prompts.log.error(promptPrep.error || 'Prompt generation failed');
          return prompts.cancel('Aborted.');
        }
        promptSourceDir = resolveLatestPrepDir(process.cwd());
      }

      const promptSrc = path.join(promptSourceDir, 'deep_research_prompt.md');
      if (!fs.existsSync(promptSrc)) {
        prompts.log.error('Deep research prompt not found in prep output.');
        return prompts.cancel('Aborted.');
      }
      promptDest = path.join(runDir, 'prompt.md');
      fs.copyFileSync(promptSrc, promptDest);
      previewMarkdown(promptDest);
      const editPrompt = await prompts.confirm({ message: 'Edit the research prompt?', initialValue: false });
      if (prompts.isCancel(editPrompt)) return prompts.cancel('Aborted.');
      if (editPrompt) {
        const credentials = readJson(getCredentialsPath()) || {};
        const editorCmd = credentials.editorCommand || '';
        const ok = openInEditor(promptDest, editorCmd);
        if (!ok) await editInTerminal(promptDest);
      }

      if (next === 'prompt') {
        state.stages.reformat = 'done';
        state.updatedAt = new Date().toISOString();
        writeRunState(runDir, state);
        prompts.log.info(`Prompt saved: ${promptDest}`);
        continue;
      }

      const formatTemplate = await prompts.select({
        message: 'Format template',
        options: [
          { value: 'newsletter', label: 'Newsletter' },
          { value: 'twitter', label: 'Twitter thread' },
          { value: 'linkedin', label: 'LinkedIn post' }
        ]
      });
      if (prompts.isCancel(formatTemplate)) return prompts.cancel('Aborted.');

      const toneTemplate = await prompts.select({
        message: 'Tone template',
        options: [
          { value: 'formal', label: 'Formal' },
          { value: 'casual', label: 'Casual' },
          { value: 'urgent', label: 'Urgent' }
        ]
      });
      if (prompts.isCancel(toneTemplate)) return prompts.cancel('Aborted.');

      const projectConfig = readJson(getProjectConfigPath(projectName)) || {};
      const brandNotes = [
        `Brand handle: ${projectConfig.handle || 'n/a'}`,
        `CTA: ${projectConfig.cta || 'n/a'}`,
        `Tone preset: ${projectConfig.tone || 'informative'}`
      ].join('\n');
      const brandDest = path.join(runDir, 'brand.txt');
      fs.writeFileSync(brandDest, brandNotes + '\n');
      let brandGate = true;
      while (brandGate) {
        const action = await prompts.select({
          message: 'Brand injection notes',
          options: [
            { value: 'view', label: 'View' },
            { value: 'edit', label: 'Edit (terminal)' },
            { value: 'continue', label: 'Continue' }
          ]
        });
        if (prompts.isCancel(action)) return prompts.cancel('Aborted.');
        if (action === 'view') previewMarkdown(brandDest);
        if (action === 'edit') {
          const credentials = readJson(getCredentialsPath()) || {};
          const editorCmd = credentials.editorCommand || '';
          const ok = openInEditor(brandDest, editorCmd);
          if (!ok) await editInTerminal(brandDest);
        }
        if (action === 'continue') brandGate = false;
      }
      state.stages.brand_inject = 'done';
      state.updatedAt = new Date().toISOString();
      writeRunState(runDir, state);

      let attempts = 0;
      let approved = false;
      let lastArticle = '';
      while (attempts < 3 && !approved) {
        attempts += 1;
        let note = '';
        if (attempts > 1) {
          note = await prompts.text({ message: 'Revision note for retry' });
          if (prompts.isCancel(note)) return prompts.cancel('Aborted.');
        }
        const promptBase = fs.readFileSync(promptDest, 'utf8');
        const promptForPublish = [
          promptBase.trim(),
          '',
          `Format template: ${formatTemplate}`,
          `Tone template: ${toneTemplate}`,
          brandNotes,
          note ? `Revision note: ${note}` : ''
        ].filter(Boolean).join('\n') + '\n';
        const tempPrompt = path.join(runDir, 'prompt_render.md');
        fs.writeFileSync(tempPrompt, promptForPublish);

        const publishCmd = `npm run yt:publish -- --input "${tempPrompt}" --lang ${lang}`;
        statusNote('Generating the article. This can take a minute.');
        const pub = withSpinner('Generating content...', () => runCommand(publishCmd, { cwd: process.cwd() }));
        if (!pub.ok) {
          prompts.log.error(pub.error || 'Publish failed');
          return prompts.cancel('Aborted.');
        }

        const publishDir = resolveLatestPublishDir(process.cwd());
        if (!publishDir) {
          prompts.log.error('Publish output not found.');
          return prompts.cancel('Aborted.');
        }
        const articleSrc = path.join(publishDir, 'article.md');
        if (!fs.existsSync(articleSrc)) {
          prompts.log.error('Article not found in publish output.');
          return prompts.cancel('Aborted.');
        }
        previewMarkdown(articleSrc);
        lastArticle = articleSrc;
        lastPublishDir = publishDir;

        const decision = await prompts.select({
          message: 'Approve this article?',
          options: [
            { value: 'approve', label: 'Approve' },
            { value: 'retry', label: 'Retry with note' },
            { value: 'edit', label: 'Edit in terminal' }
          ]
        });
        if (prompts.isCancel(decision)) return prompts.cancel('Aborted.');
        if (decision === 'approve') approved = true;
        if (decision === 'edit') {
          const credentials = readJson(getCredentialsPath()) || {};
          const editorCmd = credentials.editorCommand || '';
          const ok = openInEditor(articleSrc, editorCmd);
          if (!ok) await editInTerminal(articleSrc);
          approved = true;
        }
      }

      if (!lastArticle) {
        prompts.log.error('Article generation failed.');
        return prompts.cancel('Aborted.');
      }

      state.stages.final = 'done';
      state.updatedAt = new Date().toISOString();
      writeRunState(runDir, state);

      const exportDir = getProjectExportsDir(projectName);
      ensureDir(exportDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportPath = path.join(exportDir, `article-${stamp}.md`);
      fs.copyFileSync(lastArticle, exportPath);
      session.article = exportPath;
      prompts.log.info(`Exported article: ${exportPath}`);

      // Offer the other three outputs that yt:publish generated alongside the article
      let moreOutput = true;
      while (moreOutput) {
        const otherOutput = await prompts.select({
          message: 'Article saved. Copy social posts too?',
          options: [
            { value: 'social_posts', label: 'Yes, show social posts' },
            { value: 'skip', label: 'No, continue' }
          ]
        });
        if (prompts.isCancel(otherOutput) || otherOutput === 'skip') { moreOutput = false; break; }

        const outputFiles = {
          social_posts: 'social_posts.md'
        };
        const outputFile = outputFiles[otherOutput];
        const outputSrc = path.join(lastPublishDir, outputFile);
        if (!fs.existsSync(outputSrc)) {
          prompts.log.warn(`${outputFile} not found in publish output.`);
          continue;
        }
        const outputDest = path.join(runDir, outputFile);
        fs.copyFileSync(outputSrc, outputDest);
        if (otherOutput === 'podcast_script') session.podcastScript = outputDest;
        else if (otherOutput === 'reel_script') session.reelScript = outputDest;
        else if (otherOutput === 'social_posts') session.socialPosts = outputDest;

        let outputGate = true;
        while (outputGate) {
          const action = await prompts.select({
            message: `${outputFile} ready`,
            options: [
              { value: 'view', label: 'View' },
              { value: 'edit', label: 'Edit (terminal)' },
              { value: 'continue', label: 'Continue' }
            ]
          });
          if (prompts.isCancel(action)) { outputGate = false; break; }
          if (action === 'view') previewMarkdown(outputDest);
          if (action === 'edit') {
            const creds = readJson(getCredentialsPath()) || {};
            const editorCmd = creds.editorCommand || '';
            const ok = openInEditor(outputDest, editorCmd);
            if (!ok) await editInTerminal(outputDest);
          }
          if (action === 'continue') outputGate = false;
        }
        state.stages[otherOutput] = 'done';
        state.updatedAt = new Date().toISOString();
        writeRunState(runDir, state);
      }
      continue;
    }
  }

  prompts.outro(`Output folder: ${session.runDir}`);
}

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'run':
      await cmdRun();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    case 'reset':
      await cmdReset();
      break;
    default:
      printHelp();
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
