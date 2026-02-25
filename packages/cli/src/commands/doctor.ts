/**
 * @module commands/doctor
 * `abq-media doctor` — Check environment readiness.
 *
 * Validates OpenRouter key format and tests API connectivity.
 * Prints a JSON summary of checks and hints.
 *
 * Extracted from monolith cmdDoctor() L633–L673.
 */

import { spawnSync } from 'node:child_process';

import { readJson } from '../utils/fs.js';
import { getCredentialsPath } from '../utils/paths.js';
import { isOpenRouterKey } from '../utils/validation.js';

function hasCmd(name: string): boolean {
  const res = spawnSync('command', ['-v', name], { stdio: 'ignore' });
  return res.status === 0;
}

export async function cmdDoctor(): Promise<void> {
  const credentials = readJson<Record<string, string>>(getCredentialsPath()) ?? {};
  const key = credentials.openrouterKey || credentials.llmApiKey || '';
  const keyFormatOk = isOpenRouterKey(key);
  const ytdlp = hasCmd('yt-dlp');
  const bun = hasCmd('bun');
  const deno = hasCmd('deno');
  const hasCookies = Boolean(credentials.ytdlpCookies || credentials.ytdlpCookiesFromBrowser);
  const hasJsRuntimes = Boolean(credentials.ytdlpJsRuntimes);

  let apiOk = false;
  let latencyMs: number | null = null;
  let apiError = '';

  if (keyFormatOk) {
    const start = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { authorization: `Bearer ${key}` },
      });
      latencyMs = Date.now() - start;
      apiOk = res.ok;
      if (!res.ok) {
        const t = await res.text();
        apiError = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      }
    } catch (err) {
      latencyMs = Date.now() - start;
      apiError = String((err as Error)?.message || err);
    }
  }

  const checks = {
    nodeVersion: process.version,
    openrouterKeyFormat: keyFormatOk,
    openrouterApi: apiOk,
    latencyMs,
    ytDlp: ytdlp,
    bun,
    deno,
    ytdlpCookiesConfigured: hasCookies,
    ytdlpJsRuntimesConfigured: hasJsRuntimes,
  };

  const hints: string[] = [
    keyFormatOk ? '' : 'OpenRouter keys start with sk-or-',
    apiOk || !keyFormatOk ? '' : `OpenRouter API check failed: ${apiError || 'unknown error'}`,
    ytdlp ? '' : 'Install yt-dlp to enable YouTube subtitle/audio extraction.',
    bun || deno ? '' : 'Install bun or deno to help yt-dlp solve YouTube JS challenges.',
    hasCookies ? '' : 'Set YTDLP_COOKIES or YTDLP_COOKIES_FROM_BROWSER to improve YouTube access.',
    hasJsRuntimes ? '' : 'Set YTDLP_JS_RUNTIMES to point at bun/deno if yt-dlp cannot detect runtimes.',
  ].filter(Boolean);

  const ok = keyFormatOk && apiOk;
  console.log(JSON.stringify({ ok, checks, hints }, null, 2));
}
