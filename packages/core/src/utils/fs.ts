/**
 * @module utils/fs
 * File system helpers — replaces duplicated ensureDir / nowStamp across packages.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Ensure a directory exists (recursive). */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** ISO timestamp safe for filenames (colons/dots replaced with dashes). */
export function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Create a temp directory with a given prefix. Returns absolute path. */
export function makeTempDir(prefix = 'abq-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Safely remove a directory tree, ignoring errors. */
export function rmSafe(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/** Read a JSON file, returning null on any error. */
export function readJsonSafe<T = unknown>(filepath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

/** Write a JSON file with pretty formatting. Creates parent dirs. */
export function writeJson(filepath: string, data: unknown): void {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

/** Write a text file. Creates parent dirs. */
export function writeText(filepath: string, text: string): void {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, text, 'utf8');
}
