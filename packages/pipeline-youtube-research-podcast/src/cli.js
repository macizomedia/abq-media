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

function printInputHints() {
  const hints = [
    hasCmd('yt-dlp') ? null : 'Install yt-dlp to fetch subtitles when captions are available.',
    'Set asrProvider + asrApiKey (or llmProvider + llmApiKey) to enable ASR fallback.',
    hasCmd('ffmpeg') ? null : 'Install ffmpeg to support broader audio file formats.'
  ].filter(Boolean);
  if (hints.length) {
    console.error('Next steps:');
    for (const h of hints) console.error(`- ${h}`);
  }
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

  // Fall back to env vars for API keys
  if (!config.llmApiKey) {
    const provider = (config.llmProvider || '').toLowerCase();
    if (provider === 'openrouter') config.llmApiKey = process.env.OPENROUTER_API_KEY || '';
    else if (provider === 'openai') config.llmApiKey = process.env.OPENAI_API_KEY || '';
    else config.llmApiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  }
  if (!config.asrApiKey) {
    const asrProv = (config.asrProvider || config.llmProvider || '').toLowerCase();
    if (asrProv === 'openrouter') config.asrApiKey = process.env.OPENROUTER_API_KEY || '';
    else if (asrProv === 'openai') config.asrApiKey = process.env.OPENAI_API_KEY || '';
    else config.asrApiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  return config;
}

function normalizeUrlInput(input) {
  return String(input || '')
    .replace(/\\\?/g, '?')
    .replace(/\\&/g, '&')
    .replace(/\\=/g, '=')
    .trim();
}

function extractVideoId(input) {
  try {
    const u = new URL(normalizeUrlInput(input));
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '').trim();
    }
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('shorts');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  } catch {
    // ignore
  }
  return '';
}

function stripXml(input) {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVtt(raw) {
  return raw
    .replace(/WEBVTT[\s\S]*?\n\n/, '')
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}.*/g, ' ')
    .replace(/\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}.*/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tryYtDlpTranscript(url, lang = 'es') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-yt-rp-'));
  try {
    const cmd = [
      'yt-dlp',
      '--skip-download',
      '--write-auto-sub',
      '--write-sub',
      '--sub-format', 'vtt',
      '--sub-langs', `${lang},es,en,en-US`,
      '-o', '"video.%(ext)s"',
      url
    ].join(' ');

    execSync(cmd, { cwd: tmp, stdio: 'pipe' });
    const files = fs.readdirSync(tmp).filter((f) => f.endsWith('.vtt'));
    if (!files.length) return null;
    const best = files.sort((a, b) => a.length - b.length)[0];
    const raw = fs.readFileSync(path.join(tmp, best), 'utf8');
    const transcript = cleanVtt(raw);
    if (transcript.length < 40) return null;
    return { transcript, source: `yt-dlp:${best}` };
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function tryApiAsrTranscript(url, lang = 'es', config = null) {
  const asrProvider = (config?.asrProvider || config?.llmProvider || '').toLowerCase();
  const asrApiKey = config?.asrApiKey || config?.llmApiKey || '';
  const asrModel = config?.asrModel || 'gpt-4o-mini-transcribe';

  if (!asrProvider || !asrApiKey) return null;
  if (!hasCmd('yt-dlp')) return null;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-yt-rp-asr-'));
  try {
    const downloadCmd = [
      'yt-dlp',
      '-f', 'bestaudio',
      '-o', '"audio.%(ext)s"',
      url
    ].join(' ');
    execSync(downloadCmd, { cwd: tmp, stdio: 'pipe' });

    const audio = fs.readdirSync(tmp).find((f) => /^audio\./.test(f));
    if (!audio) return null;

    let audioPath = path.join(tmp, audio);

    // Prefer mp3 upload for broad API compatibility.
    if (hasCmd('ffmpeg')) {
      const mp3Path = path.join(tmp, 'audio.mp3');
      try {
        execSync(`ffmpeg -y -i "${audioPath}" -vn -ac 1 -ar 16000 -b:a 64k "${mp3Path}"`, {
          cwd: tmp,
          stdio: 'pipe'
        });
        if (fs.existsSync(mp3Path)) audioPath = mp3Path;
      } catch {
        // keep original audio if conversion fails
      }
    }

    const audioSize = fs.statSync(audioPath).size;
    const CHUNK_THRESHOLD = 20 * 1024 * 1024; // 20 MB — under Whisper's 25 MB limit

    if (audioSize >= CHUNK_THRESHOLD) {
      const chunked = await asrTranscribeInChunks({
        provider: asrProvider,
        apiKey: asrApiKey,
        model: asrModel,
        lang,
        audioPath,
        tmpDir: tmp,
        config
      });
      if (chunked) return { transcript: chunked, source: `${asrProvider}:${asrModel}+chunked` };
      return null;
    }

    const result = await asrRequest({
      provider: asrProvider,
      apiKey: asrApiKey,
      model: asrModel,
      lang,
      audioPath,
      config
    });
    if (result.ok) {
      return { transcript: result.text, source: `${result.provider}:${asrModel}` };
    }

    if (result.inputTooLarge) {
      const chunked = await asrTranscribeInChunks({
        provider: asrProvider,
        apiKey: asrApiKey,
        model: asrModel,
        lang,
        audioPath,
        tmpDir: tmp,
        config
      });
      if (chunked) return { transcript: chunked, source: `${asrProvider}:${asrModel}+chunked` };
    }

    return null;
  } catch (err) {
    if (process.env.ABQ_DEBUG === '1') {
      console.error(`[asr] ${String(err?.message || err)}`);
    }
    return null;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function isInputTooLargeError(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('input_too_large') || t.includes('too large for this model');
}

async function asrRequest({ provider, apiKey, model, lang, audioPath, config }) {
  const audioBytes = fs.readFileSync(audioPath);
  const uploadName = path.basename(audioPath);

  const form = new FormData();
  form.append('model', model);
  form.append('language', lang);
  form.append('response_format', 'json');
  form.append('file', new Blob([audioBytes]), uploadName);

  if (provider === 'openai') {
    const baseUrl = (config?.asrBaseUrl || config?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form
    });
    if (!res.ok) {
      const t = await res.text();
      if (process.env.ABQ_DEBUG === '1') {
        console.error(`[asr-openai] HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      return { ok: false, inputTooLarge: isInputTooLargeError(t), provider: 'asr-openai' };
    }
    const json = await res.json();
    const transcript = (json?.text || '').trim();
    if (transcript.length < 40) return { ok: false, inputTooLarge: false, provider: 'asr-openai' };
    return { ok: true, text: transcript, provider: 'asr-openai' };
  }

  if (provider === 'openrouter') {
    const baseUrl = (config?.asrBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/abquanta/pipeline-youtube-research-podcast',
        'X-Title': 'abq-yt-rp'
      },
      body: form
    });
    if (!res.ok) {
      const t = await res.text();
      if (process.env.ABQ_DEBUG === '1') {
        console.error(`[asr-openrouter] HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      return { ok: false, inputTooLarge: isInputTooLargeError(t), provider: 'asr-openrouter' };
    }
    const json = await res.json();
    const transcript = (json?.text || '').trim();
    if (transcript.length < 40) return { ok: false, inputTooLarge: false, provider: 'asr-openrouter' };
    return { ok: true, text: transcript, provider: 'asr-openrouter' };
  }

  return { ok: false, inputTooLarge: false, provider: 'asr-unknown' };
}

function splitAudioIntoChunks({ audioPath, tmpDir, segmentSeconds }) {
  if (!hasCmd('ffmpeg')) return [];
  const pattern = path.join(tmpDir, 'chunk-%03d.mp3');
  execSync(
    `ffmpeg -y -i \"${audioPath}\" -f segment -segment_time ${segmentSeconds} -c copy -reset_timestamps 1 \"${pattern}\"`,
    { stdio: 'pipe' }
  );
  const files = fs.readdirSync(tmpDir)
    .filter((f) => f.startsWith('chunk-') && f.endsWith('.mp3'))
    .map((f) => path.join(tmpDir, f))
    .sort();
  return files;
}

async function asrTranscribeInChunks({ provider, apiKey, model, lang, audioPath, tmpDir, config }) {
  if (!hasCmd('ffmpeg')) return null;
  const chunks = splitAudioIntoChunks({ audioPath, tmpDir, segmentSeconds: 600 });
  if (!chunks.length) return null;

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await asrRequest({ provider, apiKey, model, lang, audioPath: chunks[i], config });
    if (!result.ok || !result.text) return null;
    parts.push(result.text.trim());
  }
  return parts.join('\n\n');
}

async function tryApiAsrTranscriptFromFile(filePath, lang = 'es', config = null) {
  const asrProvider = (config?.asrProvider || config?.llmProvider || '').toLowerCase();
  const asrApiKey = config?.asrApiKey || config?.llmApiKey || '';
  const asrModel = config?.asrModel || 'gpt-4o-mini-transcribe';

  if (!asrProvider || !asrApiKey) return null;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-yt-rp-asr-file-'));
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    let audioPath = filePath;

    if (ext !== '.mp3' && hasCmd('ffmpeg')) {
      const mp3Path = path.join(tmp, 'audio.mp3');
      try {
        execSync(`ffmpeg -y -i "${filePath}" -vn -ac 1 -ar 16000 -b:a 64k "${mp3Path}"`, {
          cwd: tmp,
          stdio: 'pipe'
        });
        if (fs.existsSync(mp3Path)) audioPath = mp3Path;
      } catch {
        // keep original if conversion fails
      }
    }

    const audioSize = fs.statSync(audioPath).size;
    const CHUNK_THRESHOLD = 20 * 1024 * 1024; // 20 MB — under Whisper's 25 MB limit

    if (audioSize >= CHUNK_THRESHOLD) {
      const chunked = await asrTranscribeInChunks({
        provider: asrProvider,
        apiKey: asrApiKey,
        model: asrModel,
        lang,
        audioPath,
        tmpDir: tmp,
        config
      });
      if (chunked) return { transcript: chunked, source: `${asrProvider}:${asrModel}+chunked` };
      return null;
    }

    const result = await asrRequest({
      provider: asrProvider,
      apiKey: asrApiKey,
      model: asrModel,
      lang,
      audioPath,
      config
    });
    if (result.ok) {
      return { transcript: result.text, source: `${result.provider}:${asrModel}` };
    }

    if (result.inputTooLarge) {
      const chunked = await asrTranscribeInChunks({
        provider: asrProvider,
        apiKey: asrApiKey,
        model: asrModel,
        lang,
        audioPath,
        tmpDir: tmp,
        config
      });
      if (chunked) return { transcript: chunked, source: `${asrProvider}:${asrModel}+chunked` };
    }

    return null;
  } catch (err) {
    if (process.env.ABQ_DEBUG === '1') {
      console.error(`[asr-file] ${String(err?.message || err)}`);
    }
    return null;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function fetchYouTubeCaptions(videoId, url, lang = 'es', config = null, options = {}) {
  const fallbackTrace = [];
  const allowAsr = options?.allowAsr !== false;

  // Step 1: YouTube captions API
  const langCandidates = [lang, 'es', 'en', 'en-US'];
  const endpoints = [];
  for (const l of langCandidates) {
    endpoints.push(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(l)}&fmt=srv3`);
    endpoints.push(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(l)}`);
  }

  let captionsFailed = true;
  let captionsReason = 'no captions found for any language candidate';
  try {
    for (const endpoint of endpoints) {
      const res = await fetch(endpoint);
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || !xml.includes('<text')) continue;
      const text = stripXml(xml);
      if (text.length > 40) {
        fallbackTrace.push({ step: 'youtube-captions', status: 'ok' });
        return { transcript: text, source: endpoint, trace: fallbackTrace };
      }
    }
  } catch (err) {
    captionsReason = String(err?.message || err);
  }
  fallbackTrace.push({ step: 'youtube-captions', status: 'fail', reason: captionsReason });

  // Step 2: yt-dlp subtitles
  if (!hasCmd('yt-dlp')) {
    fallbackTrace.push({ step: 'yt-dlp', status: 'skip', reason: 'not installed' });
  } else {
    let ytdlp = null;
    try {
      ytdlp = tryYtDlpTranscript(url, lang);
    } catch (err) {
      // tryYtDlpTranscript already swallows errors; this is extra safety
    }
    if (ytdlp) {
      fallbackTrace.push({ step: 'yt-dlp', status: 'ok' });
      return { ...ytdlp, trace: fallbackTrace };
    }
    fallbackTrace.push({ step: 'yt-dlp', status: 'fail', reason: 'no subtitle files produced' });
  }

  // Step 3: API ASR
  if (!allowAsr) {
    fallbackTrace.push({ step: 'asr-api', status: 'skip', reason: 'captions-only mode' });
    const traceLines = fallbackTrace
      .map((entry, i) => {
        const suffix = entry.reason ? ` (${entry.reason})` : '';
        return `  ${i + 1}. ${entry.step}: ${entry.status.toUpperCase()}${suffix}`;
      })
      .join('\n');
    throw new Error(`No transcript found. Fallback chain:\n${traceLines}`);
  }

  const asrProvider = (config?.asrProvider || config?.llmProvider || '').toLowerCase();
  const asrApiKey = config?.asrApiKey || config?.llmApiKey || '';
  if (!asrProvider || !asrApiKey) {
    fallbackTrace.push({ step: 'asr-api', status: 'skip', reason: 'no asrProvider or asrApiKey configured' });
  } else {
    let apiAsr = null;
    try {
      apiAsr = await tryApiAsrTranscript(url, lang, config);
    } catch (err) {
      // swallowed in tryApiAsrTranscript; extra safety
    }
    if (apiAsr) {
      fallbackTrace.push({ step: 'asr-api', status: 'ok' });
      return { ...apiAsr, trace: fallbackTrace };
    }
    fallbackTrace.push({ step: 'asr-api', status: 'fail', reason: 'API ASR returned no transcript' });
  }

  const traceLines = fallbackTrace
    .map((entry, i) => {
      const suffix = entry.reason ? ` (${entry.reason})` : '';
      return `  ${i + 1}. ${entry.step}: ${entry.status.toUpperCase()}${suffix}`;
    })
    .join('\n');

  throw new Error(`No transcript found. Fallback chain:\n${traceLines}`);
}

function sentenceSplit(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

function topTalkingPoints(text, maxPoints = 7) {
  const sentences = sentenceSplit(text);
  if (!sentences.length) return ['Insufficient transcript text to derive talking points.'];

  const stop = new Set([
    'the', 'and', 'that', 'with', 'from', 'this', 'have', 'were', 'they', 'their', 'about',
    'para', 'como', 'pero', 'porque', 'sobre', 'esta', 'este', 'esto', 'desde', 'cuando',
    'also', 'into', 'will', 'would', 'there', 'which', 'what', 'where', 'your', 'you', 'are'
  ]);

  const freq = new Map();
  for (const s of sentences) {
    for (const w of s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
      if (stop.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const scored = sentences.map((s) => {
    let score = 0;
    for (const w of s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
      score += freq.get(w) || 0;
    }
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const seen = new Set();
  for (const row of scored) {
    const norm = row.s.toLowerCase().slice(0, 80);
    if (seen.has(norm)) continue;
    seen.add(norm);
    picked.push(row.s);
    if (picked.length >= maxPoints) break;
  }
  return picked;
}

function buildResearchPrompt({ sourceType, url, lang, talkingPoints, transcriptExcerpt }) {
  return `# Deep Research Brief

## Context
- Source URL: ${url || 'N/A'}
- Source type: ${sourceType}
- Output language target: ${lang}

## Main Talking Points Extracted
${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Transcript Excerpt
${transcriptExcerpt}

## Instructions for Deep Research Agent
You are conducting deep research from this video's thesis and claims.

Deliver the output in Spanish and structure it as:

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

6) **Guion base para podcast (español)**
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

function heuristicDigest(talkingPoints) {
  return '# Main Talking Points\n\n' + talkingPoints.map((p) => `- ${p}`).join('\n');
}

function buildLlmMessages(transcript) {
  return [
    {
      role: 'system',
      content: 'Summarize transcript into concise, high-signal talking points in Spanish. Use bullets and avoid fluff.'
    },
    {
      role: 'user',
      content: `Transcript:\n${transcript.slice(0, 14000)}`
    }
  ];
}

async function callOpenAICompatible({ baseUrl, apiKey, model, transcript, messages }) {
  const body = {
    model,
    temperature: 0.2,
    messages: messages || buildLlmMessages(transcript)
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

async function callOpenRouter({ apiKey, model, transcript, messages }) {
  const body = {
    model,
    temperature: 0.2,
    messages: messages || buildLlmMessages(transcript)
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/abquanta/pipeline-youtube-research-podcast',
      'X-Title': 'abq-yt-rp'
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

async function callOpenRouterAgent({ endpoint, apiKey, model, transcript }) {
  const payloads = [
    {
      model,
      input: buildLlmMessages(transcript).map((m) => m.content).join('\n\n'),
      task: 'digest_talking_points',
      language: 'es'
    },
    {
      model,
      messages: buildLlmMessages(transcript)
    }
  ];

  let lastErr = null;
  for (const payload of payloads) {
    try {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Agent HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      const json = await res.json();
      const text = json?.text || json?.output || json?.content || json?.message;
      if (typeof text === 'string' && text.trim()) return text.trim();
      throw new Error('Agent endpoint returned no text/output/content/message field');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('openrouter-agent call failed');
}

async function maybeLLMRefineDigest({ transcript, talkingPoints, config }) {
  if (!config?.llmProvider) {
    return { digest: heuristicDigest(talkingPoints), mode: 'heuristic' };
  }

  const provider = String(config.llmProvider).toLowerCase();
  const model = config.model || (provider === 'openrouter' ? 'openrouter/auto' : 'gpt-4o-mini');

  try {
    if (provider === 'openai') {
      if (!config.llmApiKey) throw new Error('Missing llmApiKey for openai');
      const text = await callOpenAICompatible({
        baseUrl: config.baseUrl || 'https://api.openai.com/v1',
        apiKey: config.llmApiKey,
        model,
        transcript
      });
      return { digest: `# Main Talking Points (LLM/openai)\n\n${text}`, mode: 'llm-openai' };
    }

    if (provider === 'openrouter') {
      if (!config.llmApiKey) throw new Error('Missing llmApiKey for openrouter');
      const text = await callOpenRouter({ apiKey: config.llmApiKey, model, transcript });
      return { digest: `# Main Talking Points (LLM/openrouter)\n\n${text}`, mode: 'llm-openrouter' };
    }

    if (provider === 'openrouter-agent') {
      if (!config.agentEndpoint) throw new Error('Missing agentEndpoint for openrouter-agent');
      const text = await callOpenRouterAgent({
        endpoint: config.agentEndpoint,
        apiKey: config.llmApiKey || '',
        model,
        transcript
      });
      return { digest: `# Main Talking Points (LLM/openrouter-agent)\n\n${text}`, mode: 'llm-openrouter-agent' };
    }

    return {
      digest: heuristicDigest(talkingPoints),
      mode: `heuristic (provider ${provider} not supported)`
    };
  } catch (err) {
    const reason = String(err?.message || err);
    console.error(`[digest] LLM fallback: ${reason}`);
    return {
      digest: heuristicDigest(talkingPoints),
      mode: `heuristic (llm fallback: ${reason})`
    };
  }
}

function buildPublishMessages({ researchPrompt, outputType, lang }) {
  const intro = `You are a senior content editor and scriptwriter. Output language: ${lang}.`;
  const common = 'Use the research prompt as the single source of truth. Do not invent facts. Avoid fluff.';
  const variants = {
    podcast_script: [
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
      '- Hosts should challenge each other\'s points naturally',
      '- Close with 3 clear actionable takeaways delivered conversationally',
      '- Tone: serious but engaging — like a smart radio show, not a lecture'
    ].join(' '),
    article: [
      intro,
      `Write a Substack-ready long-form article in ${lang}.`,
      'Structure: SEO headline + subtitle, lead paragraph (hook), 4–5 sections with subheaders, closing CTA: "Subscribe for more Abquanta intelligence".',
      'Target length: 800–1200 words.',
      'Output markdown with headline, subtitle, and section headers.'
    ].join(' '),
    reel_script: [
      intro,
      `Write a 60-second short-form video script in ${lang}.`,
      'Structure: Hook line in first 3 seconds, 3 key points (10 seconds each), call to action (Substack link).',
      'Format each beat as [VISUAL] then [NARRATION].',
      'Keep lines tight and timed for spoken delivery.'
    ].join(' '),
    social_posts: [
      intro,
      `Produce social content in ${lang} with three parts:`,
      '1) X/Twitter thread (8–10 tweets).',
      '2) LinkedIn post (~200 words).',
      '3) Instagram caption with 5 hashtags.',
      'Separate each part with clear markdown headings.'
    ].join(' ')
  };

  const system = `${variants[outputType] || intro} ${common}`.trim();
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Research prompt:\n\n${researchPrompt}` }
  ];
}

async function callPublishLLM({ researchPrompt, outputType, lang, config }) {
  const provider = String(config?.llmProvider || '').toLowerCase();
  const model = config?.publishModel || config?.model || (provider === 'openrouter' ? 'openrouter/auto' : 'gpt-4o-mini');
  const messages = buildPublishMessages({ researchPrompt, outputType, lang });

  if (provider === 'openai') {
    if (!config?.llmApiKey) throw new Error('Missing llmApiKey for openai');
    return callOpenAICompatible({
      baseUrl: config?.baseUrl || 'https://api.openai.com/v1',
      apiKey: config.llmApiKey,
      model,
      messages
    });
  }

  if (provider === 'openrouter') {
    if (!config?.llmApiKey) throw new Error('Missing llmApiKey for openrouter');
    return callOpenRouter({
      apiKey: config.llmApiKey,
      model,
      messages
    });
  }

  throw new Error(`Unsupported llmProvider: ${provider || 'none'}`);
}

function cmdInit() {
  console.log('Run: npm run init');
}

function cmdDoctor() {
  const config = readLocalConfig() || {};

  const checks = {
    ytDlp: hasCmd('yt-dlp'),
    ffmpeg: hasCmd('ffmpeg')
  };

  const llmProvider = config.llmProvider || null;
  const hasLlmKey = Boolean(config.llmApiKey);
  const hasAgentEndpoint = Boolean(config.agentEndpoint);

  const asrProvider = config.asrProvider || null;
  const hasAsrKey = Boolean(config.asrApiKey || config.llmApiKey);

  const transcriptPaths = [];
  transcriptPaths.push('youtube-captions (always attempted)');
  if (checks.ytDlp) transcriptPaths.push('yt-dlp-subs');
  if (checks.ytDlp && asrProvider && hasAsrKey) transcriptPaths.push(`asr-${String(asrProvider).toLowerCase()}`);
  transcriptPaths.push('transcript-file');
  transcriptPaths.push('text-inline');
  transcriptPaths.push('text-file');
  transcriptPaths.push('audio-file (ASR)');

  let digestMode = 'heuristic';
  if (llmProvider === 'openrouter-agent' && hasAgentEndpoint) digestMode = 'llm-openrouter-agent (if endpoint/auth/model valid)';
  else if ((llmProvider === 'openrouter' || llmProvider === 'openai') && hasLlmKey) digestMode = `llm-${llmProvider} (if key/model valid)`;

  const report = {
    ok: true,
    binaries: checks,
    config: {
      llmProvider,
      hasLlmKey,
      hasAgentEndpoint,
      asrProvider,
      hasAsrKey
    },
    availableTranscriptPaths: transcriptPaths,
    expectedDigestMode: digestMode,
    hints: [
      checks.ytDlp ? null : 'Install yt-dlp for subtitle/audio fallbacks.',
      checks.ffmpeg ? null : 'Install ffmpeg to enable audio file conversion for ASR.',
      llmProvider ? null : 'Set llmProvider in .abq-module.json to enable LLM digest.',
      asrProvider ? null : 'Set asrProvider + asrApiKey to enable API ASR fallback.'
    ].filter(Boolean)
  };

  console.log(JSON.stringify(report, null, 2));
}

async function cmdPrep() {
  const rawUrl = arg('--url');
  const url = normalizeUrlInput(rawUrl);
  const lang = arg('--lang', 'es');
  const audioFile = arg('--audio-file');
  const transcriptFile = arg('--transcript-file');
  const textInline = arg('--text');
  const textFile = arg('--text-file');
  const useCaptionsOnly = process.argv.includes('--use-captions')
    || arg('--use-captions') === '1'
    || arg('--use-captions') === 'true';
  const useAsrOnly = process.argv.includes('--use-asr')
    || arg('--use-asr') === '1'
    || arg('--use-asr') === 'true';

  if (!url && !audioFile && !transcriptFile && !textInline && !textFile) {
    console.error('Usage: abq-yt-rp prep (--url <youtube-url> | --audio-file <path> | --transcript-file <path> | --text "..." | --text-file <path>) [--lang es] [--use-captions] [--use-asr]');
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
      console.error('Invalid YouTube URL. Could not extract video id. Tip: pass clean URL without escaped backslashes.');
      process.exit(1);
    }
  }

  const out = path.resolve(process.cwd(), 'output', `prep-${nowStamp()}`);
  ensureDir(out);

  const config = readLocalConfig();
  const inputTrace = [];

  let transcript = '';
  let source = '';
  let transcriptMode = 'unknown';
  let sourceType = 'unknown';

  if (textInline) {
    transcript = String(textInline).trim();
    source = 'inline:text';
    transcriptMode = 'text-inline';
    sourceType = 'plain text';
    inputTrace.push({ step: 'text-inline', status: transcript ? 'ok' : 'fail' });
  } else if (textFile) {
    const p = path.resolve(process.cwd(), textFile);
    if (!fs.existsSync(p)) {
      console.error(`Text file not found: ${p}`);
      process.exit(1);
    }
    transcript = fs.readFileSync(p, 'utf8');
    source = `file:${p}`;
    transcriptMode = 'text-file';
    sourceType = 'plain text file';
    inputTrace.push({ step: 'text-file', status: transcript ? 'ok' : 'fail', path: p });
  } else if (audioFile) {
    const p = path.resolve(process.cwd(), audioFile);
    if (!fs.existsSync(p)) {
      console.error(`Audio file not found: ${p}`);
      process.exit(1);
    }
    const asrProvider = (config?.asrProvider || config?.llmProvider || '').toLowerCase();
    const asrApiKey = config?.asrApiKey || config?.llmApiKey || '';
    if (!asrProvider || !asrApiKey) {
      console.error('ASR not configured. Set asrProvider + asrApiKey (or llmProvider + llmApiKey) for audio transcription.');
      process.exit(1);
    }
    const asrResult = await tryApiAsrTranscriptFromFile(p, lang, config);
    if (!asrResult) {
      console.error('ASR transcription failed for audio input. Check API key/provider.');
      process.exit(1);
    }
    transcript = asrResult.transcript;
    source = `file:${p}`;
    transcriptMode = asrResult.source || 'asr-api';
    sourceType = 'audio file';
    inputTrace.push({ step: 'asr-audio', status: 'ok', path: p, source: asrResult.source });
  } else if (transcriptFile) {
    const p = path.resolve(process.cwd(), transcriptFile);
    if (!fs.existsSync(p)) {
      console.error(`Transcript file not found: ${p}`);
      process.exit(1);
    }
    transcript = fs.readFileSync(p, 'utf8');
    source = `file:${p}`;
    transcriptMode = 'transcript-file';
    sourceType = 'transcript file';
    inputTrace.push({ step: 'transcript-file', status: transcript ? 'ok' : 'fail', path: p });
  } else {
    if (useAsrOnly) {
      const asrProvider = (config?.asrProvider || config?.llmProvider || '').toLowerCase();
      const asrApiKey = config?.asrApiKey || config?.llmApiKey || '';
      if (!asrProvider || !asrApiKey) {
        console.error('ASR not configured. Set asrProvider + asrApiKey (or llmProvider + llmApiKey) to use --use-asr.');
        process.exit(1);
      }
      const asrResult = await tryApiAsrTranscript(url, lang, config);
      if (!asrResult) {
        console.error('ASR transcription failed. Check API key/provider.');
        process.exit(1);
      }
      transcript = asrResult.transcript;
      source = asrResult.source;
      transcriptMode = source.startsWith('asr-openai:') ? 'asr-openai' : 'asr-openrouter';
      sourceType = 'YouTube video (ASR)';
      inputTrace.push({ step: 'asr-api', status: 'ok', source });
    } else {
      try {
        const fetched = await fetchYouTubeCaptions(videoId, url, lang, config, { allowAsr: !useCaptionsOnly });
        transcript = fetched.transcript;
        source = fetched.source;
        inputTrace.push(...(fetched.trace || []));
        if (source.startsWith('yt-dlp:')) transcriptMode = 'yt-dlp-subs';
        else if (source.startsWith('asr-openai:')) transcriptMode = 'asr-openai';
        else if (source.startsWith('asr-openrouter:')) transcriptMode = 'asr-openrouter';
        else transcriptMode = 'youtube-captions';
        sourceType = 'YouTube video';
      } catch (err) {
        console.error(err?.message || err);
        printInputHints();
        process.exit(1);
      }
    }
  }

  if (!transcript || transcript.trim().length < 40) {
    console.error('Input text is too short. Provide richer source text or transcript.');
    process.exit(1);
  }
  const talkingPoints = topTalkingPoints(transcript, 8);
  const digestResult = await maybeLLMRefineDigest({ transcript, talkingPoints, config });

  const prompt = buildResearchPrompt({
    sourceType,
    url,
    lang,
    talkingPoints,
    transcriptExcerpt: transcript.slice(0, 2200)
  });

  fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify({
    stage: 'prep',
    source: sourceType,
    url: url || null,
    videoId: videoId || null,
    lang,
    transcriptMode,
    transcriptSource: source,
    digestMode: digestResult.mode,
    createdAt: new Date().toISOString()
  }, null, 2));

  fs.writeFileSync(path.join(out, 'input_trace.json'), JSON.stringify({
    input: {
      url: url || null,
      audioFile: audioFile ? path.resolve(process.cwd(), audioFile) : null,
      transcriptFile: transcriptFile ? path.resolve(process.cwd(), transcriptFile) : null,
      textFile: textFile ? path.resolve(process.cwd(), textFile) : null
    },
    flags: {
      useCaptionsOnly,
      useAsrOnly
    },
    trace: inputTrace
  }, null, 2));

  fs.writeFileSync(path.join(out, 'transcript.txt'), transcript + '\n');
  fs.writeFileSync(path.join(out, 'digest.md'), digestResult.digest + '\n');
  fs.writeFileSync(path.join(out, 'deep_research_prompt.md'), prompt + '\n');

  console.log(`Prep artifacts created at: ${out}`);
}

async function cmdPublish() {
  const input = arg('--input');
  const lang = arg('--lang', 'es');
  const useLatest = process.argv.includes('--latest');
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

  const config = readLocalConfig();
  const provider = String(config?.llmProvider || '').toLowerCase();
  if (!provider) {
    console.error('LLM provider not configured. Set llmProvider in .abq-module.json.');
    process.exit(1);
  }
  if (!config?.llmApiKey) {
    console.error('LLM API key not configured. Set llmApiKey in .abq-module.json or env.');
    process.exit(1);
  }
  if (provider !== 'openai' && provider !== 'openrouter') {
    console.error(`Unsupported llmProvider for publish: ${provider}`);
    process.exit(1);
  }

  const researchPrompt = fs.readFileSync(inputPath, 'utf8').trim();
  if (!researchPrompt) {
    console.error('Input file is empty.');
    process.exit(1);
  }

  const out = path.resolve(process.cwd(), 'output', `publish-${nowStamp()}`);
  ensureDir(out);

  const model = config?.publishModel || config?.model || (provider === 'openrouter' ? 'openrouter/auto' : 'gpt-4o-mini');
  const metadata = {
    stage: 'publish',
    inputFile: inputPath,
    lang,
    model,
    createdAt: new Date().toISOString(),
    outputs: {
      podcast_script: 'error: not generated',
      article: 'error: not generated',
      reel_script: 'error: not generated',
      social_posts: 'error: not generated'
    }
  };

  const jobs = [
    { type: 'podcast_script', file: 'podcast_script.md' },
    { type: 'article', file: 'article.md' },
    { type: 'reel_script', file: 'reel_script.md' },
    { type: 'social_posts', file: 'social_posts.md' }
  ];

  for (const job of jobs) {
    try {
      const text = await callPublishLLM({
        researchPrompt,
        outputType: job.type,
        lang,
        config
      });
      fs.writeFileSync(path.join(out, job.file), text.trim() + '\n');
      metadata.outputs[job.type] = 'ok';
      console.log(`[publish] ${job.type}: ok`);
    } catch (err) {
      const reason = String(err?.message || err);
      metadata.outputs[job.type] = `error: ${reason}`;
      console.error(`[publish] ${job.type}: ${reason}`);
    }
  }

  fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`Publish artifacts created at: ${out}`);
}

function cmdPodcast() {
  const input = arg('--input');
  const lang = arg('--lang', 'es');
  if (!input) {
    console.error('Usage: abq-yt-rp podcast --input <research.md> [--lang es]');
    process.exit(1);
  }
  console.log(`TODO: generate ${lang} podcast from ${input} and publish to SoundCloud`);
}

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
    metadata: 'metadata.json'
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
      cmdDoctor();
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
