/**
 * @module utils/shell
 * Async shell execution with timeout and abort signal.
 * Replaces all execSync usage across the monorepo.
 */

import { exec as execCb } from 'node:child_process';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellOptions {
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Timeout in ms. Default: 120_000 (2 min). Use 0 for no timeout. */
  timeoutMs?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Environment variables to merge with process.env. */
  env?: Record<string, string>;
}

/**
 * Run a shell command asynchronously with timeout and abort support.
 * Resolves even on non-zero exit code (check result.exitCode).
 * Rejects only on signal abort or spawn failure.
 */
export function shell(command: string, opts: ShellOptions = {}): Promise<ShellResult> {
  const { cwd, timeoutMs = 120_000, signal, env } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error(`Command aborted before start: ${command}`));
    }

    const child = execCb(
      command,
      {
        cwd,
        timeout: timeoutMs || undefined,
        env: env ? { ...process.env, ...env } : undefined,
        maxBuffer: 50 * 1024 * 1024, // 50MB
      },
      (error, stdout, stderr) => {
        if (signal?.aborted) {
          return reject(new Error('Command aborted'));
        }
        const exitCode = error?.code ?? (typeof error?.message === 'string' && error.message.includes('TIMEOUT') ? 124 : 0);
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
        });
      },
    );

    // Wire up abort signal
    if (signal) {
      const onAbort = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      child.on('exit', () => signal.removeEventListener('abort', onAbort));
    }
  });
}

/** Convenience: run a command and throw if exit code is non-zero. */
export async function shellStrict(command: string, opts: ShellOptions = {}): Promise<ShellResult> {
  const result = await shell(command, opts);
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (exit ${result.exitCode}): ${command}\nstderr: ${result.stderr.slice(0, 500)}`,
    );
  }
  return result;
}

/** Check if a CLI tool is available on PATH. */
export async function hasCommand(name: string): Promise<boolean> {
  try {
    const result = await shell(`command -v ${name}`, { timeoutMs: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
