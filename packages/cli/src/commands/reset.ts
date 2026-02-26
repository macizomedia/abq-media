/**
 * @module commands/reset
 * `abq-media reset` — Remove project data or credentials.
 *
 * Supports both flag-driven (--project, --all, --credentials) and
 * interactive selection.
 *
 * Extracted from monolith cmdReset() L675–L747.
 */

import fs from 'node:fs';
import path from 'node:path';

import { clack } from '../ui/prompts.js';
import { getProjectsDir, getCredentialsPath, listProjects } from '../utils/paths.js';

// ---------------------------------------------------------------------------
// argv helpers
// ---------------------------------------------------------------------------

function arg(flag: string, fallback = ''): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function doResetProject(name: string): boolean {
  const dir = path.join(getProjectsDir(), name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function doResetAll(): boolean {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function doResetCreds(): boolean {
  const p = getCredentialsPath();
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function cmdReset(): Promise<void> {
  const targetProject = arg('--project');
  const resetAll = hasFlag('--all');
  const resetCreds = hasFlag('--credentials');

  // Flag-driven mode
  if (resetAll || targetProject || resetCreds) {
    const confirm = await clack.confirm({ message: 'This will delete local data. Continue?', initialValue: false });
    if (clack.isCancel(confirm) || !confirm) { clack.cancel('Aborted.'); return; }

    const results: string[] = [];
    if (resetAll) results.push(`Projects reset: ${doResetAll() ? 'ok' : 'none'}`);
    if (targetProject) results.push(`Project ${targetProject}: ${doResetProject(targetProject) ? 'ok' : 'not found'}`);
    if (resetCreds) results.push(`Credentials: ${doResetCreds() ? 'ok' : 'none'}`);
    clack.outro(results.join('\n'));
    return;
  }

  // Interactive mode
  const choice = await clack.select({
    message: 'Reset options',
    options: [
      { value: 'project' as const, label: 'Reset one project' },
      { value: 'all' as const, label: 'Reset all projects' },
      { value: 'creds' as const, label: 'Reset credentials' },
      { value: 'cancel' as const, label: 'Cancel' },
    ],
  });
  if (clack.isCancel(choice) || choice === 'cancel') { clack.cancel('Aborted.'); return; }

  if (choice === 'project') {
    const projects = listProjects();
    if (!projects.length) { clack.cancel('No projects found.'); return; }
    const pick = await clack.select({
      message: 'Choose project',
      options: projects.map((p) => ({ value: p, label: p })),
    });
    if (clack.isCancel(pick)) { clack.cancel('Aborted.'); return; }
    const confirm = await clack.confirm({ message: `Delete project ${pick}?`, initialValue: false });
    if (clack.isCancel(confirm) || !confirm) { clack.cancel('Aborted.'); return; }
    clack.outro(`Project ${pick}: ${doResetProject(pick as string) ? 'ok' : 'not found'}`);
    return;
  }

  if (choice === 'all') {
    const confirm = await clack.confirm({ message: 'Delete ALL projects?', initialValue: false });
    if (clack.isCancel(confirm) || !confirm) { clack.cancel('Aborted.'); return; }
    clack.outro(`Projects reset: ${doResetAll() ? 'ok' : 'none'}`);
    return;
  }

  if (choice === 'creds') {
    const confirm = await clack.confirm({ message: 'Delete stored credentials?', initialValue: false });
    if (clack.isCancel(confirm) || !confirm) { clack.cancel('Aborted.'); return; }
    clack.outro(`Credentials: ${doResetCreds() ? 'ok' : 'none'}`);
    return;
  }
}
