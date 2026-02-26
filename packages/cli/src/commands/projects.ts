/**
 * @module commands/projects
 * `abq-media projects` command family.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { clack } from '../ui/prompts.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { getCredentialsPath, resolvePathFromCwd, resolveProjectsRootDir } from '../utils/paths.js';
import { continueTransformProject } from './transform.js';

interface ProjectManifest {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  source?: {
    type?: string;
    value?: string;
    title?: string;
    url?: string;
    path?: string;
  };
  recipe?: string;
  targetFormat?: string;
  status?: 'complete' | 'failed' | 'in-progress' | 'planned';
  failedAt?: string | null;
  failureReason?: string | null;
  artifacts?: Array<{ name: string; stage?: string; size?: number }>;
}

interface ListOptions {
  status?: 'complete' | 'failed' | 'in-progress' | 'planned';
  format?: string;
  since?: Date;
}

interface SetupConfig {
  defaults?: {
    outputDir?: string;
  };
}

function subcommand(): string {
  return process.argv[3] || 'list';
}

function argAt(index: number): string {
  return process.argv[index] || '';
}

function arg(flag: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? '' : (process.argv[i + 1] || '');
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function configuredOutputDir(): string | undefined {
  const cfg = readJson<SetupConfig>(getCredentialsPath());
  return cfg?.defaults?.outputDir;
}

function projectRootCandidates(): string[] {
  const seen = new Set<string>();
  const configured = configuredOutputDir();
  const roots = [
    resolveProjectsRootDir(configured),
    resolveProjectsRootDir(undefined),
    configured ? resolvePathFromCwd(configured, os.homedir()) : '',
    path.join(os.homedir(), 'abq-projects'),
    path.join(os.homedir(), '.abq-media', 'projects'),
  ];

  return roots.filter((root) => {
    if (!root || seen.has(root)) return false;
    seen.add(root);
    return true;
  });
}

function scanProjectDirs(): string[] {
  return projectRootCandidates()
    .filter((root) => fs.existsSync(root))
    .flatMap((root) => fs.readdirSync(root)
      .map((entry) => path.join(root, entry))
      .filter((entry) => fs.statSync(entry).isDirectory()))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function loadProjectById(id: string): { dir: string; manifest: ProjectManifest } {
  for (const root of projectRootCandidates()) {
    const dir = path.join(root, id);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = readJson<ProjectManifest>(manifestPath);
    if (!manifest) {
      throw new Error(`Cannot parse manifest: ${manifestPath}`);
    }

    return { dir, manifest };
  }

  throw new Error(`Project not found or manifest missing: ${id}`);
}

function scanProjects(): Array<{ dir: string; manifest: ProjectManifest }> {
  return scanProjectDirs()
    .map((dir) => ({ dir, manifest: readJson<ProjectManifest>(path.join(dir, 'manifest.json')) }))
    .filter((entry): entry is { dir: string; manifest: ProjectManifest } => !!entry.manifest);
}

function applyProjectFilters(
  projects: Array<{ dir: string; manifest: ProjectManifest }>,
  options: ListOptions,
): Array<{ dir: string; manifest: ProjectManifest }> {
  return projects.filter(({ manifest }) => {
    if (options.status && (manifest.status ?? 'in-progress') !== options.status) return false;
    if (options.format && (manifest.targetFormat ?? '') !== options.format) return false;
    if (options.since) {
      const createdAt = manifest.createdAt ? new Date(manifest.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
      if (createdAt < options.since) return false;
    }
    return true;
  });
}

function parseListOptions(): ListOptions {
  const status = arg('--status') as ListOptions['status'];
  const format = arg('--format');
  const sinceArg = arg('--since');
  const since = sinceArg ? new Date(sinceArg) : undefined;

  return {
    status: status || undefined,
    format: format || undefined,
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
  };
}

async function listProjects(options: ListOptions): Promise<void> {
  const projects = applyProjectFilters(scanProjects(), options);

  clack.intro('Your Projects');

  if (!projects.length) {
    clack.log.info(`No projects found in: ${projectRootCandidates().join(', ')}`);
    clack.outro('Done');
    return;
  }

  for (const { manifest } of projects) {

    const status = manifest.status ?? 'in-progress';
    const statusIcon = {
      complete: '✓',
      failed: '✗',
      'in-progress': '◇',
      planned: '○',
    }[status];

    clack.log.message(`${statusIcon} ${manifest.id}`);
    clack.log.message(`  ${(manifest.source?.title || manifest.source?.value || '').slice(0, 96)}`);
    clack.log.message(`  ${manifest.targetFormat ?? 'unknown'} · ${status}`);

    if (status === 'failed') {
      clack.log.warning(`  Failed at: ${manifest.failedAt ?? 'unknown stage'}`);
      clack.log.info(`  Resume: abq-media projects continue ${manifest.id}`);
    }
  }

  clack.outro(`${projects.length} projects`);
}

async function viewArtifact(projectDir: string, artifactName: string): Promise<void> {
  const artifactPath = path.join(projectDir, artifactName);
  if (!fs.existsSync(artifactPath)) {
    clack.log.error(`Artifact not found: ${artifactName}`);
    return;
  }

  const editor = process.env.EDITOR || 'vi';
  const result = spawnSync(editor, [artifactPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    clack.log.error(`Editor exited with status ${result.status ?? 'unknown'}`);
  }
}

async function deleteProject(projectId: string): Promise<void> {
  let projectPath = '';
  try {
    projectPath = loadProjectById(projectId).dir;
  } catch {
    projectPath = '';
  }

  if (!projectPath || !fs.existsSync(projectPath)) {
    clack.log.error(`Project not found: ${projectId}`);
    process.exitCode = 1;
    return;
  }

  const forceDelete = hasFlag('--yes') || hasFlag('-y');
  if (!forceDelete) {
    const confirm = await clack.confirm({ message: `Delete project ${projectId}?`, initialValue: false });
    if (clack.isCancel(confirm) || !confirm) {
      clack.cancel('Aborted.');
      return;
    }
  }

  fs.rmSync(projectPath, { recursive: true, force: true });
  clack.outro(`Deleted project: ${projectId}`);
}

async function rerunProject(projectId: string): Promise<void> {
  const { dir, manifest } = loadProjectById(projectId);
  const sourceFile = path.join(dir, 'source.json');
  if (!fs.existsSync(sourceFile)) {
    clack.log.error('Cannot re-run: source metadata missing.');
    process.exitCode = 1;
    return;
  }

  const sourceMeta = readJson<{ source?: string }>(sourceFile) ?? {};
  const source = sourceMeta.source;
  const format = manifest.targetFormat;
  if (!source || !format) {
    clack.log.error('Cannot re-run: missing source or target format in metadata.');
    process.exitCode = 1;
    return;
  }

  const args = [
    path.join(import.meta.dirname, '..', 'cli.js'),
    'transform',
    source,
    '--into',
    format,
  ];
  if (manifest.recipe) {
    args.push('--using', manifest.recipe);
  }
  if (hasFlag('--dry-run')) {
    args.push('--dry-run');
  }

  const res = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    clack.log.error('Re-run failed.');
    process.exitCode = 1;
    return;
  }

  clack.outro(`Re-run completed for project: ${projectId}`);
}

async function openProject(projectId: string): Promise<void> {
  if (!projectId) {
    clack.log.error('Usage: abq-media projects open <id>');
    process.exitCode = 1;
    return;
  }

  const { dir, manifest } = loadProjectById(projectId);
  const editor = process.env.EDITOR || 'vi';

  clack.intro(`Project: ${manifest.id}`);
  clack.log.info(`Created: ${manifest.createdAt}`);
  clack.log.info(`Source: ${manifest.source?.url || manifest.source?.path || manifest.source?.value || 'n/a'}`);
  clack.log.info(`Recipe: ${manifest.recipe ?? 'n/a'}`);
  clack.log.info(`Status: ${manifest.status ?? 'in-progress'}`);

  if (manifest.artifacts?.length) {
    clack.log.info('Artifacts:');
    for (const artifact of manifest.artifacts) {
      const size = artifact.size ? `${artifact.size} bytes` : 'size unknown';
      clack.log.message(`  ${artifact.name} (${size})`);
    }
  }

  const actionValue = await clack.select({
    message: 'Action',
    options: [
      { value: 'view', label: 'View artifact' },
      { value: 'export', label: 'Export all (zip)' },
      { value: 'rerun', label: 'Re-run with current recipe' },
      { value: 'delete', label: 'Delete project' },
      { value: 'back', label: 'Back' },
    ],
  }) as symbol | string;
  if (clack.isCancel(actionValue)) {
    clack.cancel('Aborted.');
    return;
  }
  const action = actionValue as string;

  if (action === 'view') {
    const options = (manifest.artifacts ?? []).map((artifact) => ({
      value: artifact.name,
      label: artifact.name,
      hint: artifact.stage,
    }));

    if (!options.length) {
      clack.log.warning('No artifacts found in manifest.');
      clack.outro('Done');
      return;
    }

    const pick = await clack.select({ message: 'Choose artifact', options });
    if (clack.isCancel(pick)) {
      clack.cancel('Aborted.');
      return;
    }
    await viewArtifact(dir, pick as string);
  }

  if (action === 'export') {
    await exportProject(projectId);
    return;
  }

  if (action === 'rerun') {
    await rerunProject(projectId);
    return;
  }

  if (action === 'delete') {
    await deleteProject(projectId);
    return;
  }

  clack.outro('Done');
}

async function exportProject(projectId: string, outputPath?: string): Promise<void> {
  if (!projectId) {
    clack.log.error('Usage: abq-media projects export <id> [output.zip]');
    process.exitCode = 1;
    return;
  }

  const { dir, manifest } = loadProjectById(projectId);
  const defaultTarget = outputPath || path.join(os.homedir(), `${projectId}.zip`);

  const zipAvailable = spawnSync('sh', ['-lc', 'command -v zip >/dev/null 2>&1']).status === 0;
  if (!zipAvailable) {
    clack.log.error('zip is not available on this system.');
    process.exitCode = 1;
    return;
  }

  ensureDir(path.dirname(defaultTarget));
  const cmd = `cd "${dir}" && zip -r "${defaultTarget}" .`;
  const res = spawnSync('sh', ['-lc', cmd], { stdio: 'inherit' });
  if (res.status !== 0) {
    clack.log.error('Failed to create zip export.');
    process.exitCode = 1;
    return;
  }

  manifest.updatedAt = new Date().toISOString();
  writeJson(path.join(dir, 'manifest.json'), manifest);

  clack.outro(`Exported to: ${defaultTarget}`);
}

function findLatestCheckpoint(projectDir: string): string | null {
  const runDirs = fs.readdirSync(projectDir)
    .filter((entry) => entry.startsWith('run-'))
    .map((entry) => path.join(projectDir, entry))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const runDir of runDirs) {
    const checkpointDir = path.join(runDir, 'checkpoints');
    if (!fs.existsSync(checkpointDir)) continue;
    const checkpoints = fs.readdirSync(checkpointDir)
      .filter((file) => file.endsWith('.json'))
      .sort();
    if (!checkpoints.length) continue;
    return path.join(checkpointDir, checkpoints[checkpoints.length - 1]);
  }

  return null;
}

function findLatestFailedProjectId(): string | null {
  const failed = scanProjects()
    .filter(({ manifest }) => (manifest.status ?? 'in-progress') === 'failed')
    .sort((a, b) => {
      const left = new Date(a.manifest.updatedAt ?? a.manifest.createdAt ?? 0).getTime();
      const right = new Date(b.manifest.updatedAt ?? b.manifest.createdAt ?? 0).getTime();
      return right - left;
    });
  return failed[0] ? failed[0].manifest.id : null;
}

async function continueProject(projectId?: string): Promise<void> {
  const targetProjectId = projectId || findLatestFailedProjectId();
  if (!targetProjectId) {
    clack.log.warning('No failed projects to resume.');
    return;
  }

  const { dir } = loadProjectById(targetProjectId);
  const checkpoint = findLatestCheckpoint(dir);

  if (!checkpoint) {
    clack.log.error(`No checkpoint found for project ${targetProjectId}`);
    process.exitCode = 1;
    return;
  }

  clack.log.info(`Resuming from: ${checkpoint}`);
  try {
    await continueTransformProject(targetProjectId);
    clack.outro(`Project resumed and completed: ${targetProjectId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    clack.log.error(`Failed to resume project: ${message}`);
    process.exitCode = 1;
  }
}

export async function cmdProjects(): Promise<void> {
  const sub = subcommand();

  if (sub === 'list') {
    await listProjects(parseListOptions());
    return;
  }

  if (sub.startsWith('--')) {
    await listProjects(parseListOptions());
    return;
  }

  if (sub === 'open') {
    await openProject(argAt(4));
    return;
  }

  if (sub === 'export') {
    await exportProject(argAt(4), argAt(5) || undefined);
    return;
  }

  if (sub === 'continue') {
    await continueProject(argAt(4) || undefined);
    return;
  }

  if (sub === 'rerun') {
    await rerunProject(argAt(4));
    return;
  }

  if (sub === 'delete') {
    await deleteProject(argAt(4));
    return;
  }

  clack.log.error(`Unknown projects subcommand: ${sub}`);
  clack.log.info('Use: abq-media projects [list|open <id>|export <id> [out.zip]|continue [id]|rerun <id> [--dry-run]|delete <id> [--yes]]');
  process.exitCode = 1;
}
