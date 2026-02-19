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

function tryWhisperTranscript(url, lang = 'es', whisperModel = 'base') {
  if (!hasCmd('yt-dlp') || !hasCmd('whisper')) return null;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-yt-rp-whisper-'));
  try {
    // 1) Download audio only
    const downloadCmd = [
      'yt-dlp',
      '-f', 'bestaudio',
      '-o', '"audio.%(ext)s"',
      url
    ].join(' ');
    execSync(downloadCmd, { cwd: tmp, stdio: 'pipe' });

    const audio = fs.readdirSync(tmp).find((f) => /^audio\./.test(f));
    if (!audio) return null;

    // 2) Local Whisper transcription (requires python whisper CLI installed)
    const whisperCmd = [
      'whisper',
      `"${audio}"`,
      '--model', whisperModel,
      '--language', lang,
      '--task', 'transcribe',
      '--output_format', 'txt',
      '--output_dir', '.'
    ].join(' ');
    execSync(whisperCmd, { cwd: tmp, stdio: 'pipe' });

    const txt = fs.readdirSync(tmp).find((f) => f.endsWith('.txt'));
    if (!txt) return null;
    const transcript = fs.readFileSync(path.join(tmp, txt), 'utf8').trim();
    if (transcript.length < 40) return null;

    return { transcript, source: `whisper-local:${whisperModel}` };
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

    const audioBytes = fs.readFileSync(audioPath);
    const uploadName = path.basename(audioPath);

    const form = new FormData();
    form.append('model', asrModel);
    form.append('language', lang);
    form.append('response_format', 'json');
    form.append('file', new Blob([audioBytes]), uploadName);

    if (asrProvider === 'openai') {
      const baseUrl = (config?.asrBaseUrl || config?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${asrApiKey}` },
        body: form
      });
      if (!res.ok) {
        if (process.env.ABQ_DEBUG === '1') {
          const t = await res.text();
          console.error(`[asr-openai] HTTP ${res.status}: ${t.slice(0, 300)}`);
        }
        return null;
      }
      const json = await res.json();
      const transcript = (json?.text || '').trim();
      if (transcript.length < 40) return null;
      return { transcript, source: `asr-openai:${asrModel}` };
    }

    if (asrProvider === 'openrouter') {
      const baseUrl = (config?.asrBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${asrApiKey}`,
          'HTTP-Referer': 'https://github.com/abquanta/pipeline-youtube-research-podcast',
          'X-Title': 'abq-yt-rp'
        },
        body: form
      });
      if (!res.ok) {
        if (process.env.ABQ_DEBUG === '1') {
          const t = await res.text();
          console.error(`[asr-openrouter] HTTP ${res.status}: ${t.slice(0, 300)}`);
        }
        return null;
      }
      const json = await res.json();
      const transcript = (json?.text || '').trim();
      if (transcript.length < 40) return null;
      return { transcript, source: `asr-openrouter:${asrModel}` };
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

async function fetchYouTubeCaptions(videoId, url, lang = 'es', config = null) {
  const fallbackTrace = [];

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
        return { transcript: text, source: endpoint };
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
      return ytdlp;
    }
    fallbackTrace.push({ step: 'yt-dlp', status: 'fail', reason: 'no subtitle files produced' });
  }

  // Step 3: Local Whisper
  const whisperModel = config?.whisperModel || process.env.WHISPER_MODEL || 'base';
  if (!hasCmd('whisper')) {
    fallbackTrace.push({ step: 'whisper', status: 'skip', reason: 'not installed' });
  } else {
    let whisper = null;
    try {
      whisper = tryWhisperTranscript(url, lang, whisperModel);
    } catch (err) {
      // swallowed in tryWhisperTranscript; extra safety
    }
    if (whisper) {
      fallbackTrace.push({ step: 'whisper', status: 'ok' });
      return whisper;
    }
    fallbackTrace.push({ step: 'whisper', status: 'fail', reason: 'transcription produced no output' });
  }

  // Step 4: API ASR
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
      return apiAsr;
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

async function callOpenAICompatible({ baseUrl, apiKey, model, transcript }) {
  const body = {
    model,
    temperature: 0.2,
    messages: buildLlmMessages(transcript)
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

async function callOpenRouter({ apiKey, model, transcript }) {
  const body = {
    model,
    temperature: 0.2,
    messages: buildLlmMessages(transcript)
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

function cmdInit() {
  console.log('Run: npm run init');
}

function cmdDoctor() {
  const config = readLocalConfig() || {};

  const checks = {
    ytDlp: hasCmd('yt-dlp'),
    whisper: hasCmd('whisper'),
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
  if (checks.ytDlp && checks.whisper && checks.ffmpeg) transcriptPaths.push('whisper-local');
  if (checks.ytDlp && asrProvider && hasAsrKey) transcriptPaths.push(`asr-${String(asrProvider).toLowerCase()}`);
  transcriptPaths.push('transcript-file');
  transcriptPaths.push('text-inline');
  transcriptPaths.push('text-file');

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
      checks.whisper ? null : 'Install whisper CLI to enable local whisper fallback.',
      checks.ffmpeg ? null : 'Install ffmpeg to support local whisper audio decoding.',
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
  const transcriptFile = arg('--transcript-file');
  const textInline = arg('--text');
  const textFile = arg('--text-file');

  if (!url && !transcriptFile && !textInline && !textFile) {
    console.error('Usage: abq-yt-rp prep (--url <youtube-url> | --transcript-file <path> | --text "..." | --text-file <path>) [--lang es]');
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

  let transcript = '';
  let source = '';
  let transcriptMode = 'unknown';
  let sourceType = 'unknown';

  if (textInline) {
    transcript = String(textInline).trim();
    source = 'inline:text';
    transcriptMode = 'text-inline';
    sourceType = 'plain text';
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
  } else {
    const fetched = await fetchYouTubeCaptions(videoId, url, lang, config);
    transcript = fetched.transcript;
    source = fetched.source;
    if (source.startsWith('yt-dlp:')) transcriptMode = 'yt-dlp-subs';
    else if (source.startsWith('whisper-local:')) transcriptMode = 'whisper-local';
    else if (source.startsWith('asr-openai:')) transcriptMode = 'asr-openai';
    else if (source.startsWith('asr-openrouter:')) transcriptMode = 'asr-openrouter';
    else transcriptMode = 'youtube-captions';
    sourceType = 'YouTube video';
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

  fs.writeFileSync(path.join(out, 'transcript.txt'), transcript + '\n');
  fs.writeFileSync(path.join(out, 'digest.md'), digestResult.digest + '\n');
  fs.writeFileSync(path.join(out, 'deep_research_prompt.md'), prompt + '\n');

  console.log(`Prep artifacts created at: ${out}`);
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
  if (!open) {
    console.log(latest);
    return;
  }

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

  console.log(target);
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
      console.log('  prep (--url <youtube-url> | --transcript-file <path> | --text "..." | --text-file <path>) [--lang es]');
      console.log('  podcast --input <research.md> [--lang es]');
  }
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
