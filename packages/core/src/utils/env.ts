/**
 * @module utils/env
 * Unified .env file loader — replaces the identical loadDotenv() IIFE
 * duplicated in pipeline/cli.js and adapter-elevenlabs-tts/cli.js.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Load key=value pairs from a .env file into process.env.
 * Only sets keys that are NOT already in process.env (env vars take precedence).
 * Supports # comments, quoted values, and empty lines.
 */
export function loadDotenv(dir: string = process.cwd()): void {
  const envPath = path.resolve(dir, '.env');
  let content: string;
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // .env not found — that's fine
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}
