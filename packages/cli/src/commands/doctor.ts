/**
 * @module commands/doctor
 * `abq-media doctor` — Check environment readiness.
 *
 * Validates OpenRouter key format and tests API connectivity.
 * Prints a JSON summary of checks and hints.
 *
 * Extracted from monolith cmdDoctor() L633–L673.
 */

import { readJson } from '../utils/fs.js';
import { getCredentialsPath } from '../utils/paths.js';
import { isOpenRouterKey } from '../utils/validation.js';

export async function cmdDoctor(): Promise<void> {
  const credentials = readJson<Record<string, string>>(getCredentialsPath()) ?? {};
  const key = credentials.openrouterKey || credentials.llmApiKey || '';
  const keyFormatOk = isOpenRouterKey(key);

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
  };

  const hints: string[] = [
    keyFormatOk ? '' : 'OpenRouter keys start with sk-or-',
    apiOk || !keyFormatOk ? '' : `OpenRouter API check failed: ${apiError || 'unknown error'}`,
  ].filter(Boolean);

  const ok = keyFormatOk && apiOk;
  console.log(JSON.stringify({ ok, checks, hints }, null, 2));
}
