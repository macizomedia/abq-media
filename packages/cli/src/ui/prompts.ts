/**
 * @module ui/prompts
 * Reusable @clack/prompts wrappers for common CLI interaction patterns.
 *
 * Extracted from the monolith's inline prompt code. Every stage should use
 * these helpers instead of raw `@clack/prompts` calls so that cancellation,
 * editor integration, and preview behaviour are consistent.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import * as clack from '@clack/prompts';

import { UserCancelledError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Editor helpers
// ---------------------------------------------------------------------------

/** Check whether a CLI command exists on the PATH. */
export function hasCmd(name: string): boolean {
  const res = spawnSync('command', ['-v', name], { stdio: 'ignore' });
  return res.status === 0;
}

/**
 * Auto-detect a GUI editor that supports `--wait`.
 * Returns a command string like `"code --wait"` or `""` if nothing found.
 */
export function detectEditorCommand(): string {
  const candidates = [
    { cmd: 'code', args: ['--wait'] },
    { cmd: 'cursor', args: ['--wait'] },
    { cmd: 'subl', args: ['--wait'] },
    { cmd: 'mate', args: ['-w'] },
  ];
  for (const c of candidates) {
    if (hasCmd(c.cmd)) return [c.cmd, ...c.args].join(' ');
  }
  return '';
}

/**
 * Open a file in the user's preferred editor (blocks until closed).
 * Falls back to `$EDITOR`, then auto-detection.
 * Returns `true` if the editor exited successfully.
 */
export function openInEditor(filePath: string, editorCommand = ''): boolean {
  const command = editorCommand || process.env.EDITOR || detectEditorCommand();
  if (!command) return false;
  const parts = command.split(' ').filter(Boolean);
  const bin = parts[0];
  const args = parts.slice(1);
  const res = spawnSync(bin, [...args, filePath], { stdio: 'inherit' });
  return res.status === 0;
}

/**
 * Inline terminal editor — paste lines, end with `.`, cancel with `/cancel`.
 * Writes the result to `filePath`. Returns `true` if content was saved.
 */
export async function editInTerminal(filePath: string): Promise<boolean> {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  clack.log.info('Editing mode (terminal).');
  clack.log.info('Paste your text. Finish with a single "." on its own line.');
  clack.log.info('Type "/cancel" to abort without changes.');
  if (current.trim()) {
    clack.log.info('Current content preview:');
    process.stdout.write(`${current}\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines: string[] = [];
  const askLine = (): Promise<string> => new Promise((resolve) => rl.question('> ', resolve));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await askLine();
    const trimmed = String(line || '').trim();
    if (trimmed === '/cancel') { rl.close(); return false; }
    if (trimmed === '.') break;
    lines.push(line);
  }
  rl.close();

  if (!lines.length) return false;
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  return true;
}

// ---------------------------------------------------------------------------
// Preview helpers
// ---------------------------------------------------------------------------

/**
 * Preview a markdown file using `bat`, `glow`, or plain `stdout`.
 */
export function previewMarkdown(filePath: string): void {
  if (!filePath || !fs.existsSync(filePath)) return;
  if (hasCmd('bat')) {
    spawnSync('bat', ['--style=plain', filePath], { stdio: 'inherit' });
    return;
  }
  if (hasCmd('glow')) {
    spawnSync('glow', [filePath], { stdio: 'inherit' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  process.stdout.write(`\n${content}\n`);
}

// ---------------------------------------------------------------------------
// Spinner helpers
// ---------------------------------------------------------------------------

/**
 * Run an async function inside a clack spinner.
 * Returns the function's result. Re-throws on failure after stopping the spinner.
 */
export async function withSpinnerAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const spin = clack.spinner();
  spin.start(label);
  try {
    const result = await fn();
    spin.stop('Done');
    return result;
  } catch (err) {
    spin.stop('Failed');
    throw err;
  }
}

/** Convenience wrapper for `clack.log.info`. */
export function statusNote(message: string): void {
  clack.log.info(message);
}

// ---------------------------------------------------------------------------
// View / Edit / Continue gate
// ---------------------------------------------------------------------------

/**
 * A reusable "view / edit / continue" gate that loops until the user
 * continues or cancels.
 *
 * @param filePath  Absolute path to the file being reviewed.
 * @param label     Display label (e.g. "Transcript ready").
 * @param editorCmd Optional editor command override.
 * @param state     Current CLI state name (for error context).
 * @returns `true` if the user continued, never returns `false` (throws on cancel).
 * @throws {UserCancelledError} if the user cancels.
 */
export async function reviewGate(
  filePath: string,
  label: string,
  editorCmd: string,
  state: string,
): Promise<true> {
  let gate = true;
  while (gate) {
    const action = await clack.select({
      message: label,
      options: [
        { value: 'view' as const, label: 'View' },
        { value: 'edit' as const, label: 'Edit (terminal)' },
        { value: 'continue' as const, label: 'Continue' },
      ],
    });
    if (clack.isCancel(action)) throw new UserCancelledError(state);
    if (action === 'view') previewMarkdown(filePath);
    if (action === 'edit') {
      const ok = openInEditor(filePath, editorCmd);
      if (!ok) await editInTerminal(filePath);
    }
    if (action === 'continue') gate = false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Cancel-safe wrappers
// ---------------------------------------------------------------------------

/**
 * Wrap a clack `select` result — throws {@link UserCancelledError} on cancel.
 */
export function unwrapCancel<T>(value: T | symbol, state: string): T {
  if (clack.isCancel(value)) throw new UserCancelledError(state);
  return value as T;
}

/** Re-export `clack` for stages that need raw access. */
export { clack };
