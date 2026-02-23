/**
 * @module utils/registry
 * Transcript cache registry — deduplicates work across runs.
 *
 * Each project has a `registry.json` that maps
 * `<sourceType>:<sourceId>:<lang>` → transcript file path.
 * When the user processes the same YouTube URL twice, we skip transcription.
 *
 * Extracted from the monolith (lines ~360-400).
 */

import { readJson, writeJson } from './fs.js';
import { getProjectRegistryPath } from './paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Information needed to build a registry key. */
export interface RegistryKeyInfo {
  sourceType: string;
  sourceId?: string;
  source?: string;
  lang: string;
}

/** A single registry entry stored in `registry.json`. */
export interface RegistryEntry {
  key: string;
  sourceType: string;
  source: string;
  sourceId: string;
  lang: string;
  transcriptPath: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/** Read the entire registry for a project. Returns `[]` if missing. */
export function readRegistry(projectName: string): RegistryEntry[] {
  return readJson<RegistryEntry[]>(getProjectRegistryPath(projectName)) ?? [];
}

/** Overwrite the registry file with the given entries. */
export function writeRegistry(projectName: string, entries: RegistryEntry[]): void {
  writeJson(getProjectRegistryPath(projectName), entries);
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Build a deterministic registry key from source metadata.
 * Format: `<sourceType>:<sourceId|source>:<lang>`
 */
export function registryKey(info: RegistryKeyInfo): string {
  return `${info.sourceType}:${info.sourceId ?? info.source ?? ''}:${info.lang}`;
}

// ---------------------------------------------------------------------------
// Lookup / Upsert
// ---------------------------------------------------------------------------

/**
 * Find an existing registry entry by computed key.
 * Returns `null` if not found.
 */
export function findRegistryEntry(
  projectName: string,
  info: RegistryKeyInfo,
): RegistryEntry | null {
  const entries = readRegistry(projectName);
  const key = registryKey(info);
  return entries.find((e) => e.key === key) ?? null;
}

/**
 * Insert or update a registry entry for the given source + transcript path.
 * If an entry with the same key exists, it is replaced in-place.
 */
export function upsertRegistryEntry(
  projectName: string,
  info: RegistryKeyInfo & { source: string },
  transcriptPath: string,
): void {
  const entries = readRegistry(projectName);
  const key = registryKey(info);
  const now = new Date().toISOString();

  const entry: RegistryEntry = {
    key,
    sourceType: info.sourceType,
    source: info.source,
    sourceId: info.sourceId ?? '',
    lang: info.lang,
    transcriptPath,
    createdAt: now,
  };

  const idx = entries.findIndex((e) => e.key === key);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  writeRegistry(projectName, entries);
}
