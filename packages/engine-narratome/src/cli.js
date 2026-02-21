#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { narratomeSchema } from './schema.js';

// --- .env loader (native, no deps) ---
(function loadDotenv() {
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env file not found or unreadable — that's fine
  }
})();

function hasCmd(name) {
  try {
    execSync(`command -v ${name}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function arg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readLocalConfig() {
  const p = path.resolve(process.cwd(), '.abq-module.json');
  let config = null;
  if (fs.existsSync(p)) {
    try {
      config = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      // ignore parse errors
    }
  }
  if (!config) config = {};

  const provider = (config.llmProvider || '').toLowerCase();
  if (!config.llmApiKey) {
    if (provider === 'openrouter') config.llmApiKey = process.env.OPENROUTER_API_KEY || '';
    else if (provider === 'openai') config.llmApiKey = process.env.OPENAI_API_KEY || '';
    else config.llmApiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  if (!config.elevenLabsApiKey) config.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!config.pexelsApiKey) config.pexelsApiKey = process.env.PEXELS_API_KEY || '';

  if (!config.voiceIdA) config.voiceIdA = 'pNInz6obpgDQGcFmaJgB';
  if (!config.voiceIdB) config.voiceIdB = 'EXAVITQu4vr4xnSDxMaL';
  if (!config.elevenLabsModel) config.elevenLabsModel = 'eleven_multilingual_v2';

  if (!config.lang) config.lang = 'es';
  if (!config.defaultFormat) config.defaultFormat = 'briefing';
  if (!config.defaultDuration) config.defaultDuration = 120;

  return config;
}

function buildNarratomeSystemPrompt({ format, lang, duration }) {
  return `You are the Narratome Generator for Abquanta's Diegesis Engine.\nGiven a research prompt, produce a valid narratome.json.\n\nRules:\n- Respond ONLY with valid JSON. No markdown, no explanation.\n- Format: ${format}, Language: ${lang}, Duration: ~${duration}s\n- Emotional arc: hook → tension → revelation → resolution → CTA\n- Use visual_type 'b-roll' for most beats (English Pexels query)\n- Use visual_type 'text-overlay' for key numbers and impact statements\n- Narration must fit beat duration (approx 3 words/second)\n- Final beat: CTA referencing Abquanta Substack\n- Alternate HOST_A and HOST_B for variety\n- visual_prompt must be a specific English Pexels video search query`;
}

function buildNarratomeMessages({ researchPrompt, format, lang, duration }) {
  return [
    { role: 'system', content: buildNarratomeSystemPrompt({ format, lang, duration }) },
    { role: 'user', content: `Research prompt:\n\n${researchPrompt}` }
  ];
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages }) {
  const body = {
    model,
    temperature: 0.2,
    messages
  };

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty LLM response');
  return text;
}

async function callOpenRouter({ apiKey, model, messages }) {
  const body = {
    model,
    temperature: 0.2,
    messages
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/abquanta/abq-media-workspace',
      'X-Title': 'abq-narratome'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty OpenRouter response');
  return text;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function isType(value, expected) {
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === null) return value === null;
  if (Array.isArray(expected)) return expected.includes(value);
  if (typeof expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return false;
}

function validateSchema(schema, value, path = '') {
  const errors = [];

  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) {
      errors.push(`${path || 'value'} should be array`);
      return errors;
    }
    if (schema.length === 0) return errors;
    const itemSchema = schema[0];
    value.forEach((item, i) => {
      errors.push(...validateSchema(itemSchema, item, `${path}[${i}]`));
    });
    return errors;
  }

  if (typeof schema === 'string' || schema === null) {
    if (!isType(value, schema)) {
      errors.push(`${path || 'value'} should be ${schema}`);
    }
    return errors;
  }

  if (Array.isArray(schema?.[0]) || Array.isArray(schema)) {
    return errors;
  }

  if (typeof schema === 'object') {
    if (!isType(value, schema)) {
      errors.push(`${path || 'value'} should be object`);
      return errors;
    }
    for (const key of Object.keys(schema)) {
      if (!(key in value)) {
        errors.push(`${path ? path + '.' : ''}${key} is required`);
        continue;
      }
      errors.push(...validateSchema(schema[key], value[key], `${path ? path + '.' : ''}${key}`));
    }
    return errors;
  }

  return errors;
}

function validateNarratome(narratome) {
  const errors = validateSchema(narratomeSchema, narratome, 'narratome');
  return errors;
}

async function generateNarratome({ inputPath, format, lang, duration, outputPath, config }) {
  const researchPrompt = fs.readFileSync(inputPath, 'utf8').trim();
  if (!researchPrompt) throw new Error('Input file is empty');

  const provider = String(config?.llmProvider || '').toLowerCase();
  if (!provider) throw new Error('LLM provider not configured. Set llmProvider in .abq-module.json.');
  if (!config?.llmApiKey) throw new Error('LLM API key not configured. Set llmApiKey in .abq-module.json or env.');

  const model = config?.llmModel || config?.model || (provider === 'openrouter' ? 'openrouter/auto' : 'gpt-4o-mini');
  const messages = buildNarratomeMessages({ researchPrompt, format, lang, duration });

  let text = '';
  if (provider === 'openai') {
    text = await callOpenAICompatible({
      baseUrl: config?.baseUrl || 'https://api.openai.com/v1',
      apiKey: config.llmApiKey,
      model,
      messages
    });
  } else if (provider === 'openrouter') {
    text = await callOpenRouter({
      apiKey: config.llmApiKey,
      model,
      messages
    });
  } else {
    throw new Error(`Unsupported llmProvider: ${provider}`);
  }

  const jsonText = extractJson(text);
  let narratome = null;
  try {
    narratome = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`LLM returned invalid JSON: ${String(err?.message || err)}`);
  }

  const errors = validateNarratome(narratome);
  if (errors.length) {
    throw new Error(`Narratome schema validation failed: ${errors.slice(0, 6).join('; ')}`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(narratome, null, 2));
  return { narratome, model };
}

async function elevenTts({ apiKey, voiceId, modelId, text }) {
  const baseUrl = 'https://api.elevenlabs.io/v1/text-to-speech';
  const res = await fetch(`${baseUrl}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  });

  if (!res.ok) {
    let msg = '';
    try {
      msg = (await res.text()).slice(0, 300);
    } catch {
      msg = '';
    }
    const err = new Error(`ElevenLabs HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }

  return Buffer.from(await res.arrayBuffer());
}

async function fetchPexelsVideo({ apiKey, query }) {
  const url = `https://api.pexels.co/videos/search?query=${encodeURIComponent(query)}&per_page=1`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Pexels HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const video = json?.videos?.[0];
  if (!video || !Array.isArray(video.video_files) || !video.video_files.length) {
    throw new Error('Pexels returned no video files');
  }
  const files = [...video.video_files].sort((a, b) => (a.width || 0) - (b.width || 0));
  const best = files.find((f) => String(f.quality || '').toLowerCase() === 'sd') || files[0];
  if (!best?.link) throw new Error('Pexels video file missing link');
  return { url: best.link };
}

function writeConcatList(fileListPath, files) {
  const lines = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(fileListPath, lines.join('\n') + '\n');
}

function ensureFfmpeg() {
  if (!hasCmd('ffmpeg')) {
    console.error('ffmpeg not found. Install ffmpeg to render video.');
    process.exit(1);
  }
}

function getDurationSeconds(filePath) {
  if (!hasCmd('ffprobe')) return null;
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { stdio: 'pipe' }
    ).toString().trim();
    const sec = Math.max(0, Math.round(Number(out)));
    if (Number.isFinite(sec)) return sec;
  } catch {
    return null;
  }
  return null;
}

async function buildBeatVideo({ beat, config, tmpDir, index }) {
  const duration = Math.max(1, Math.round(Number(beat.duration_seconds || 1)));
  const videoPath = path.join(tmpDir, `beat-${index}-video.mp4`);

  if (beat.visual_type === 'text-overlay') {
    const text = beat?.text_overlay?.text || beat?.narration || '';
    const safeText = String(text).replace(/:/g, '\\:').replace(/'/g, "\\'");
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${duration} ` +
      `-vf "drawtext=text='${safeText}':fontcolor=white:fontsize=48:fontfile=\"\":x=(w-text_w)/2:y=(h-text_h)/2" ` +
      `-c:v libx264 -t ${duration} "${videoPath}"`,
      { stdio: 'pipe' }
    );
    return videoPath;
  }

  if (beat.visual_type === 'b-roll' && beat.visual_prompt) {
    const result = await fetchPexelsVideo({
      apiKey: config.pexelsApiKey,
      query: String(beat.visual_prompt)
    });
    const srcPath = path.join(tmpDir, `beat-${index}-src.mp4`);
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`Pexels download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(srcPath, buf);
    execSync(
      `ffmpeg -y -i "${srcPath}" -t ${duration} -an -c:v libx264 "${videoPath}"`,
      { stdio: 'pipe' }
    );
    return videoPath;
  }

  execSync(
    `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${duration} -c:v libx264 -t ${duration} "${videoPath}"`,
    { stdio: 'pipe' }
  );
  return videoPath;
}

async function buildBeatAudio({ beat, config, tmpDir, index }) {
  const duration = Math.max(1, Math.round(Number(beat.duration_seconds || 1)));
  const audioPath = path.join(tmpDir, `beat-${index}-audio.mp3`);

  if (beat.audio_type === 'silence') {
    execSync(
      `ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${duration} -q:a 9 "${audioPath}"`,
      { stdio: 'pipe' }
    );
    return audioPath;
  }

  const voiceId = beat.voice_id === 'HOST_B' ? config.voiceIdB : config.voiceIdA;
  try {
    const audio = await elevenTts({
      apiKey: config.elevenLabsApiKey,
      voiceId,
      modelId: config.elevenLabsModel,
      text: beat.narration || ''
    });
    fs.writeFileSync(audioPath, audio);
    return audioPath;
  } catch (err) {
    const reason = String(err?.message || err);
    console.error(`[tts] Beat ${index + 1} failed: ${reason}`);
    execSync(
      `ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${duration} -q:a 9 "${audioPath}"`,
      { stdio: 'pipe' }
    );
    return audioPath;
  }
}

function mergeBeat({ videoPath, audioPath, tmpDir, index }) {
  const outPath = path.join(tmpDir, `beat-${index}-merged.mp4`);
  execSync(
    `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -shortest -c:v libx264 -c:a aac -movflags +faststart "${outPath}"`,
    { stdio: 'pipe' }
  );
  return outPath;
}

async function cmdGenerate() {
  const input = arg('--input');
  if (!input) {
    console.error('Usage: abq-narratome generate --input <deep_research_prompt.md> --format <reel|briefing|essay> --lang <es|en> --duration <seconds> [--output <narratome.json>]');
    process.exit(1);
  }

  const config = readLocalConfig();
  const format = arg('--format', config.defaultFormat || 'briefing');
  const lang = arg('--lang', config.lang || 'es');
  const duration = Number(arg('--duration', String(config.defaultDuration || 120)));
  const outputArg = arg('--output');

  const inputPath = path.resolve(process.cwd(), input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'output', `narratome-${nowStamp()}`);
  ensureDir(outDir);
  const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : path.join(outDir, 'narratome.json');

  try {
    const { model } = await generateNarratome({
      inputPath,
      format,
      lang,
      duration,
      outputPath,
      config
    });
    console.log(`Narratome created: ${outputPath} (model: ${model})`);
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

async function cmdRender() {
  const input = arg('--input');
  const output = arg('--output');

  if (!input) {
    console.error('Usage: abq-narratome render --input <narratome.json> [--output <episode.mp4>]');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const config = readLocalConfig();
  ensureFfmpeg();

  if (!config.pexelsApiKey) {
    console.error('Missing pexelsApiKey. Set in .abq-module.json or PEXELS_API_KEY.');
    process.exit(1);
  }
  if (!config.elevenLabsApiKey) {
    console.error('Missing elevenLabsApiKey. Set in .abq-module.json or ELEVENLABS_API_KEY.');
    process.exit(1);
  }

  let narratome = null;
  try {
    narratome = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch {
    console.error('Invalid narratome.json (parse error).');
    process.exit(1);
  }

  const errors = validateNarratome(narratome);
  if (errors.length) {
    console.error(`Narratome schema validation failed: ${errors.slice(0, 6).join('; ')}`);
    process.exit(1);
  }

  const beats = narratome.acts.flatMap((a) => a.beats || []);
  if (!beats.length) {
    console.error('Narratome contains no beats.');
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'output');
  ensureDir(outDir);
  const outPath = output ? path.resolve(process.cwd(), output) : path.join(outDir, `episode-${nowStamp()}.mp4`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-narratome-'));
  const mergedFiles = [];

  try {
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const videoPath = await buildBeatVideo({ beat, config, tmpDir, index: i });
      const audioPath = await buildBeatAudio({ beat, config, tmpDir, index: i });
      const mergedPath = mergeBeat({ videoPath, audioPath, tmpDir, index: i });
      mergedFiles.push(mergedPath);
    }

    const listPath = path.join(tmpDir, 'filelist.txt');
    writeConcatList(listPath, mergedFiles);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`, { stdio: 'pipe' });

    const duration = getDurationSeconds(outPath);
    const suffix = duration === null ? 'unknown' : String(duration);
    console.log(`Narratome rendered: ${outPath} (${suffix}s)`);
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function cmdRun() {
  const input = arg('--input');
  if (!input) {
    console.error('Usage: abq-narratome run --input <deep_research_prompt.md> --format <reel|briefing|essay> --lang <es|en> [--duration <seconds>]');
    process.exit(1);
  }

  const config = readLocalConfig();
  const format = arg('--format', config.defaultFormat || 'briefing');
  const lang = arg('--lang', config.lang || 'es');
  const duration = Number(arg('--duration', String(config.defaultDuration || 120)));

  const inputPath = path.resolve(process.cwd(), input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'output', `narratome-${nowStamp()}`);
  ensureDir(outDir);
  const narratomePath = path.join(outDir, 'narratome.json');

  try {
    await generateNarratome({
      inputPath,
      format,
      lang,
      duration,
      outputPath: narratomePath,
      config
    });
    await cmdRenderWithInput(narratomePath, outDir);
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

async function cmdRenderWithInput(narratomePath, outDir) {
  const config = readLocalConfig();
  ensureFfmpeg();

  if (!config.pexelsApiKey) {
    throw new Error('Missing pexelsApiKey. Set in .abq-module.json or PEXELS_API_KEY.');
  }
  if (!config.elevenLabsApiKey) {
    throw new Error('Missing elevenLabsApiKey. Set in .abq-module.json or ELEVENLABS_API_KEY.');
  }

  let narratome = null;
  try {
    narratome = JSON.parse(fs.readFileSync(narratomePath, 'utf8'));
  } catch {
    throw new Error('Invalid narratome.json (parse error).');
  }

  const errors = validateNarratome(narratome);
  if (errors.length) {
    throw new Error(`Narratome schema validation failed: ${errors.slice(0, 6).join('; ')}`);
  }

  const beats = narratome.acts.flatMap((a) => a.beats || []);
  if (!beats.length) {
    throw new Error('Narratome contains no beats.');
  }

  const outPath = path.join(outDir, `episode-${nowStamp()}.mp4`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-narratome-'));
  const mergedFiles = [];

  try {
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const videoPath = await buildBeatVideo({ beat, config, tmpDir, index: i });
      const audioPath = await buildBeatAudio({ beat, config, tmpDir, index: i });
      const mergedPath = mergeBeat({ videoPath, audioPath, tmpDir, index: i });
      mergedFiles.push(mergedPath);
    }

    const listPath = path.join(tmpDir, 'filelist.txt');
    writeConcatList(listPath, mergedFiles);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`, { stdio: 'pipe' });

    const duration = getDurationSeconds(outPath);
    const suffix = duration === null ? 'unknown' : String(duration);
    console.log(`Narratome rendered: ${outPath} (${suffix}s)`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function cmdDoctor() {
  const config = readLocalConfig();
  const hasFfmpeg = hasCmd('ffmpeg');

  const provider = String(config?.llmProvider || '').toLowerCase();
  const hasLlmProvider = Boolean(provider);
  const hasLlmKey = Boolean(config.llmApiKey);
  const hasEleven = Boolean(config.elevenLabsApiKey);
  const hasPexels = Boolean(config.pexelsApiKey);

  const checks = {
    ffmpeg: hasFfmpeg,
    llmProvider: hasLlmProvider,
    llmApiKey: hasLlmKey,
    elevenLabsApiKey: hasEleven,
    pexelsApiKey: hasPexels
  };

  const hints = [
    hasFfmpeg ? null : 'Install ffmpeg to enable rendering.',
    hasLlmProvider ? null : 'Set llmProvider in .abq-module.json.',
    hasLlmKey ? null : 'Set OPENAI_API_KEY/OPENROUTER_API_KEY or llmApiKey in .abq-module.json.',
    hasEleven ? null : 'Set ELEVENLABS_API_KEY or elevenLabsApiKey in .abq-module.json.',
    hasPexels ? null : 'Set PEXELS_API_KEY or pexelsApiKey in .abq-module.json.'
  ].filter(Boolean);

  const ok = hasFfmpeg && hasLlmProvider && hasLlmKey && hasEleven && hasPexels;
  console.log(JSON.stringify({ ok, checks, hints }, null, 2));
}

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'generate':
      await cmdGenerate();
      break;
    case 'render':
      await cmdRender();
      break;
    case 'run':
      await cmdRun();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    default:
      console.log('abq-narratome commands:');
      console.log('  generate --input <deep_research_prompt.md> --format <reel|briefing|essay> --lang <es|en> --duration <seconds> [--output <narratome.json>]');
      console.log('  render --input <narratome.json> [--output <episode.mp4>]');
      console.log('  run --input <deep_research_prompt.md> --format <reel|briefing|essay> --lang <es|en> [--duration <seconds>]');
      console.log('  doctor');
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
