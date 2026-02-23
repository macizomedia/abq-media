/**
 * @module stages/project-init
 * PROJECT_INIT — Prompt for project name, create run dir, load config.
 *
 * Extracted from monolith cmdRun() L876–L920.
 *
 * Input context:
 *   - `projectName` may already be set (from CLI flag)
 *
 * Output context:
 *   - `projectName` — resolved project name
 *   - `projectDir`  — absolute path to project dir
 *   - `runDir`      — absolute path to this run's output dir
 *   - `configPath`  — path to project config JSON
 *   - `legacyState` — initialised run state
 *
 * Next state: INPUT_SELECT
 */

import path from 'node:path';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, unwrapCancel } from '../ui/prompts.js';
import { ensureDir, readJson } from '../utils/fs.js';
import {
  listProjects,
  getProjectRunDir,
  getProjectConfigPath,
  getCredentialsPath,
  readRunState,
  writeRunState,
  initRunState,
} from '../utils/paths.js';

export async function projectInit(ctx: CLIContext): Promise<StageResult> {
  let projectName = ctx.projectName;

  // If no project name yet, prompt the user
  if (!projectName) {
    const projects = listProjects();

    if (projects.length) {
      const choice = await clack.select({
        message: 'Choose a project',
        options: [
          ...projects.map((p) => ({ value: p, label: p })),
          { value: '__new__' as const, label: 'New project' },
        ],
      });
      const picked = unwrapCancel(choice, 'PROJECT_INIT');

      if (picked === '__new__') {
        const name = await clack.text({
          message: 'Project name',
          initialValue: path.basename(process.cwd()),
        });
        projectName = String(unwrapCancel(name, 'PROJECT_INIT')).trim();
      } else {
        projectName = String(picked);
      }
    } else {
      const name = await clack.text({
        message: 'Project name',
        initialValue: path.basename(process.cwd()),
      });
      projectName = String(unwrapCancel(name, 'PROJECT_INIT')).trim();
    }
  }

  if (!projectName) projectName = 'default';

  // Create run directory and initialise legacy state
  const runDir = getProjectRunDir(projectName);
  ensureDir(runDir);
  const legacyState = readRunState(runDir) ?? initRunState();
  writeRunState(runDir, legacyState);

  // Load project config for lang default (used later)
  const configPath = getProjectConfigPath(projectName);
  const credentialsPath = getCredentialsPath();
  const projectConfig = readJson<Record<string, unknown>>(configPath) ?? {};
  const credentials = readJson<Record<string, unknown>>(credentialsPath) ?? {};
  const lang = (projectConfig.defaultLanguage ?? credentials.lang ?? 'es') as string;

  return {
    nextState: 'INPUT_SELECT',
    context: {
      ...ctx,
      projectName,
      projectDir: path.dirname(configPath),
      runDir,
      configPath,
      credentialsPath,
      lang,
      legacyState,
      currentState: 'INPUT_SELECT',
      stateHistory: [...ctx.stateHistory, 'PROJECT_INIT'],
    },
  };
}
