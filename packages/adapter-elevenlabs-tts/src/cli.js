#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

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

  if (!config.elevenLabsApiKey) {
    config.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || '';
  }
  if (!config.voiceIdA) config.voiceIdA = 'pNInz6obpgDQGcFmaJgB';
  if (!config.voiceIdB) config.voiceIdB = 'EXAVITQu4vr4xnSDxMaL';
  if (!config.elevenLabsModel) config.elevenLabsModel = 'eleven_multilingual_v2';
  if (!config.outputFormat) config.outputFormat = 'mp3_44100_128';

  return config;
}

function parseDialogue(script) {
  const lines = String(script || '').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const a = line.match(/^HOST_A:\s*(.+)$/);
    if (a && a[1]) {
      out.push({ speaker: 'HOST_A', text: a[1].trim() });
      continue;
    }
    const b = line.match(/^HOST_B:\s*(.+)$/);
    if (b && b[1]) {
      out.push({ speaker: 'HOST_B', text: b[1].trim() });
    }
  }
  return out;
}

async function elevenTts({ apiKey, voiceId, modelId, outputFormat, text }) {
  const baseUrl = 'https://api.elevenlabs.io/v1/text-to-speech';
  const qs = outputFormat ? `?output_format=${encodeURIComponent(outputFormat)}` : '';
  const res = await fetch(`${baseUrl}/${voiceId}${qs}`, {
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

  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function writeConcatList(fileListPath, files) {
  const lines = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(fileListPath, lines.join('\n') + '\n');
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

async function cmdRender() {
  const input = arg('--input');
  const useLatest = process.argv.includes('--latest');
  const output = arg('--output');

  if (!input && !useLatest) {
    console.error('Usage: abq-el-tts render --input <podcast_script.md> [--output <podcast.mp3>] [--latest]');
    process.exit(1);
  }
  if (input && useLatest) {
    console.error('Invalid flags: --input and --latest cannot be used together.');
    process.exit(1);
  }

  const resolvedInput = input || resolveLatestPublishPrompt();
  const inputPath = path.resolve(process.cwd(), resolvedInput);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  if (!hasCmd('ffmpeg')) {
    console.error('ffmpeg not found. Install ffmpeg to render audio.');
    process.exit(1);
  }

  const config = readLocalConfig();
  if (!config.elevenLabsApiKey) {
    console.error('Missing elevenLabsApiKey. Set in .abq-module.json or ELEVENLABS_API_KEY.');
    process.exit(1);
  }

  const script = fs.readFileSync(inputPath, 'utf8');
  const lines = parseDialogue(script);
  if (!lines.length) {
    console.error('No HOST_A/HOST_B lines found in script');
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'output');
  ensureDir(outDir);
  const outPath = output
    ? path.resolve(process.cwd(), output)
    : path.join(outDir, `podcast-${nowStamp()}.mp3`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-tts-'));
  const audioFiles = [];
  let lastApiError = null;

  try {
    for (let i = 0; i < lines.length; i++) {
      const { speaker, text } = lines[i];
      const voiceId = speaker === 'HOST_A' ? config.voiceIdA : config.voiceIdB;
      const tmpFile = path.join(tmpDir, `abq-tts-${i}.mp3`);

      try {
        const audio = await elevenTts({
          apiKey: config.elevenLabsApiKey,
          voiceId,
          modelId: config.elevenLabsModel,
          outputFormat: config.outputFormat,
          text
        });
        fs.writeFileSync(tmpFile, audio);
        audioFiles.push(tmpFile);
      } catch (err) {
        const reason = String(err?.message || err);
        lastApiError = err;
        console.error(`[tts] Skip line ${i + 1}: ${reason}`);
      }
    }

    if (!audioFiles.length) {
      if (lastApiError) {
        console.error(lastApiError?.message || 'ElevenLabs API error');
      } else {
        console.error('No audio segments were produced.');
      }
      process.exit(1);
    }

    const listPath = path.join(tmpDir, 'filelist.txt');
    writeConcatList(listPath, audioFiles);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -acodec copy "${outPath}"`, {
      stdio: 'pipe'
    });

    const duration = getDurationSeconds(outPath);
    const suffix = duration === null ? 'unknown' : String(duration);
    console.log(`Podcast rendered: ${outPath} (${suffix}s)`);
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

function resolveLatestPublishPrompt() {
  const outDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outDir)) {
    console.error('No output directory found yet.');
    process.exit(1);
  }

  const runs = fs.readdirSync(outDir)
    .filter((d) => d.startsWith('publish-'))
    .map((d) => path.join(outDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (!runs.length) {
    console.error('No publish runs found in output/.');
    process.exit(1);
  }

  const latest = runs[0];
  const target = path.join(latest, 'podcast_script.md');
  if (!fs.existsSync(target)) {
    console.error(`File not found: ${target}`);
    process.exit(1);
  }

  return target;
}

async function cmdDoctor() {
  const config = readLocalConfig();
  const hasFfmpeg = hasCmd('ffmpeg');
  const hasApiKey = Boolean(config.elevenLabsApiKey);
  const hasVoiceA = Boolean(config.voiceIdA);
  const hasVoiceB = Boolean(config.voiceIdB);

  let apiOk = false;
  let apiErr = '';
  if (hasApiKey) {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': config.elevenLabsApiKey }
      });
      apiOk = res.ok;
      if (!res.ok) {
        const t = await res.text();
        apiErr = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      }
    } catch (err) {
      apiErr = String(err?.message || err);
    }
  }

  const checks = {
    ffmpeg: hasFfmpeg,
    elevenLabsApiKey: hasApiKey,
    voiceIdA: hasVoiceA,
    voiceIdB: hasVoiceB,
    apiConnectivity: apiOk
  };

  const hints = [
    hasFfmpeg ? null : 'Install ffmpeg to enable audio rendering.',
    hasApiKey ? null : 'Set ELEVENLABS_API_KEY or elevenLabsApiKey in .abq-module.json.',
    hasVoiceA ? null : 'Set voiceIdA in .abq-module.json if you want a custom voice.',
    hasVoiceB ? null : 'Set voiceIdB in .abq-module.json if you want a custom voice.',
    apiOk || !hasApiKey ? null : `ElevenLabs API connectivity failed: ${apiErr || 'unknown error'}`
  ].filter(Boolean);

  const ok = hasFfmpeg && hasApiKey && hasVoiceA && hasVoiceB && apiOk;
  console.log(JSON.stringify({ ok, checks, hints }, null, 2));
}

const command = process.argv[2];
(async () => {
  switch (command) {
    case 'render':
      await cmdRender();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    default:
      console.log('abq-el-tts commands:');
      console.log('  render --input <podcast_script.md> [--output <podcast.mp3>] [--latest]');
      console.log('  doctor');
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
