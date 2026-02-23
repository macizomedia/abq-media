/**
 * @module utils/paths
 * Path helpers — project dirs, run dirs, config paths, latest-run resolvers.
 *
 * Extracted from the monolith (lines ~255-440). Every function is pure (no
 * side effects beyond reading the file system) and uses typed return values.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { readJson, writeJson } from './fs.js';
import type { LegacyRunState } from '../machine/types.js';

// ---------------------------------------------------------------------------
// Global directories
// ---------------------------------------------------------------------------

/** Root of all CLI state: `~/.abq-media/` */
export function getGlobalDir(): string {
  return path.join(os.homedir(), '.abq-media');
}

/** `~/.abq-media/credentials.json` */
export function getCredentialsPath(): string {
  return path.join(getGlobalDir(), 'credentials.json');
}

/** `~/.abq-media/projects/` */
export function getProjectsDir(): string {
  return path.join(getGlobalDir(), 'projects');
}

// ---------------------------------------------------------------------------
// Project-level paths
// ---------------------------------------------------------------------------

/** `~/.abq-media/projects/<name>/config.json` */
export function getProjectConfigPath(name: string): string {
  return path.join(getProjectsDir(), name, 'config.json');
}

/** `~/.abq-media/projects/<name>/runs/` */
export function getProjectRunsDir(name: string): string {
  return path.join(getProjectsDir(), name, 'runs');
}

/** `~/.abq-media/projects/<name>/exports/` */
export function getProjectExportsDir(name: string): string {
  return path.join(getProjectsDir(), name, 'exports');
}

/** `~/.abq-media/projects/<name>/registry.json` */
export function getProjectRegistryPath(name: string): string {
  return path.join(getProjectsDir(), name, 'registry.json');
}

/**
 * Create a new timestamped run directory path (does NOT create the dir).
 * Format: `~/.abq-media/projects/<name>/runs/<ISO-stamp>/`
 */
export function getProjectRunDir(name: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(getProjectRunsDir(name), stamp);
}

// ---------------------------------------------------------------------------
// Project enumeration
// ---------------------------------------------------------------------------

/** List all project directory names under `~/.abq-media/projects/`. */
export function listProjects(): string[] {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((d) => path.join(dir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .map((p) => path.basename(p))
    .sort();
}

// ---------------------------------------------------------------------------
// Run resolution
// ---------------------------------------------------------------------------

/** Return the most-recently-modified run directory, or `null`. */
export function resolveLatestProjectRun(name: string): string | null {
  const runsDir = getProjectRunsDir(name);
  if (!fs.existsSync(runsDir)) return null;
  const runs = fs.readdirSync(runsDir)
    .map((d) => path.join(runsDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return runs[0] ?? null;
}

/** Metadata about a single run, as returned by {@link listProjectRuns}. */
export interface RunInfo {
  runDir: string;
  source: Record<string, unknown>;
  state: LegacyRunState | null;
  has: (filename: string) => boolean;
}

/**
 * List all valid runs for a project, sorted newest-first.
 * A run is valid if it contains at least one of:
 * `transcript.txt`, `source.json`, or `prompt.md`.
 */
export function listProjectRuns(projectName: string): RunInfo[] {
  const runsDir = getProjectRunsDir(projectName);
  if (!fs.existsSync(runsDir)) return [];

  return fs.readdirSync(runsDir)
    .map((d) => path.join(runsDir, d))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map((runDir) => {
      const source = readJson<Record<string, unknown>>(
        path.join(runDir, 'source.json'),
      ) ?? {};
      const state = readJson<LegacyRunState>(
        path.join(runDir, 'state.json'),
      );
      const has = (f: string): boolean => fs.existsSync(path.join(runDir, f));
      return { runDir, source, state, has };
    })
    .filter(({ has }) => has('transcript.txt') || has('source.json') || has('prompt.md'));
}

// ---------------------------------------------------------------------------
// Run state helpers (legacy format)
// ---------------------------------------------------------------------------

/** Absolute path to `state.json` inside a run dir. */
export function getRunStatePath(runDir: string): string {
  return path.join(runDir, 'state.json');
}

/** Read the legacy run state. Returns `null` if missing or invalid. */
export function readRunState(runDir: string): LegacyRunState | null {
  return readJson<LegacyRunState>(getRunStatePath(runDir));
}

/** Write a legacy run state to `state.json`. */
export function writeRunState(runDir: string, state: LegacyRunState): void {
  writeJson(getRunStatePath(runDir), state);
}

/** Build a fresh default legacy run state. */
export function initRunState(): LegacyRunState {
  return {
    stages: {
      transcribe: 'pending',
      clean: 'pending',
      summarize: 'pending',
      reformat: 'pending',
      brand_inject: 'pending',
      final: 'pending',
    },
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pipeline output resolvers (for browsing previous prep/publish runs)
// ---------------------------------------------------------------------------

/**
 * Find the latest `prep-*` output directory under `cwd/output/` or the
 * pipeline package's output directory. Returns `null` if not found.
 */
export function resolveLatestPrepDir(cwd: string): string | null {
  const resolve = (base: string, prefix: string): string | null => {
    if (!fs.existsSync(base)) return null;
    const runs = fs.readdirSync(base)
      .filter((d) => d.startsWith(prefix))
      .map((d) => path.join(base, d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return runs[0] ?? null;
  };

  return (
    resolve(path.resolve(cwd, 'output'), 'prep-') ??
    resolve(
      path.resolve(cwd, 'packages/pipeline-youtube-research-podcast/output'),
      'prep-',
    )
  );
}

/**
 * Find the latest `publish-*` output directory. Same search order as
 * {@link resolveLatestPrepDir}.
 */
export function resolveLatestPublishDir(cwd: string): string | null {
  const resolve = (base: string, prefix: string): string | null => {
    if (!fs.existsSync(base)) return null;
    const runs = fs.readdirSync(base)
      .filter((d) => d.startsWith(prefix))
      .map((d) => path.join(base, d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return runs[0] ?? null;
  };

  return (
    resolve(path.resolve(cwd, 'output'), 'publish-') ??
    resolve(
      path.resolve(cwd, 'packages/pipeline-youtube-research-podcast/output'),
      'publish-',
    )
  );
}

/**
 * Find the latest `deep_research_prompt.md` inside the latest prep run.
 */
export function resolveLatestPrepPrompt(cwd: string): string | null {
  const dir = resolveLatestPrepDir(cwd);
  if (!dir) return null;
  const prompt = path.join(dir, 'deep_research_prompt.md');
  return fs.existsSync(prompt) ? prompt : null;
}
