/**
 * @module utils/fs
 * File system helpers — readJson, writeJson, ensureDir, getSamplesDir.
 *
 * Extracted from the monolith (lines ~237-253). These are low-level I/O
 * primitives used by paths, registry, checkpoint, and context modules.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// ---------------------------------------------------------------------------
// ensureDir — recursive mkdir
// ---------------------------------------------------------------------------

/** Create a directory (and parents) if it does not exist. */
export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

// ---------------------------------------------------------------------------
// readJson / writeJson — generic JSON I/O
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file. Returns `null` if the file is missing or
 * contains invalid JSON (never throws).
 */
export function readJson<T = unknown>(p: string): T | null {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Write `data` as pretty-printed JSON, creating parent directories as needed.
 */
export function writeJson(p: string, data: unknown): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// getSamplesDir — location of bundled sample artifacts
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the `samples/` directory shipped with the CLI.
 *
 * Uses `import.meta.url` to locate the file relative to the compiled output,
 * then walks up to the package root to find `samples/`.
 */
export function getSamplesDir(): string {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  // In the compiled layout: dist/utils/fs.js → ../../samples
  return path.resolve(__dirname, '../../samples');
}
