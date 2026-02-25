/**
 * @module utils/shell
 * Async shell execution with timeout and abort signal.
 * Replaces all execSync usage across the monorepo.
 */

import { exec as execCb } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

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
        killSignal: 'SIGTERM',
      },
      (error, stdout, stderr) => {
        if (signal?.aborted) {
          return reject(new Error('Command aborted'));
        }

        let exitCode = 0;
        if (error) {
          // When exec kills the process due to timeout, error.killed is true
          // and error.signal is set ('SIGTERM'). Node does NOT put the word
          // 'TIMEOUT' in the error message, so the old heuristic was broken.
          if (error.killed || error.signal) {
            exitCode = 124; // conventional "killed by timeout" code
          } else if (typeof error.code === 'number') {
            exitCode = error.code;
          } else {
            exitCode = 1;
          }
        }

        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode,
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

// ---------------------------------------------------------------------------
// Streaming shell execution (spawn-based, line-by-line callbacks)
// ---------------------------------------------------------------------------

export interface ShellStreamingOptions extends ShellOptions {
  /**
   * Called for every line written to stderr by the child process.
   * Useful for real-time progress parsing (e.g. yt-dlp download progress).
   */
  onStderrLine?: (line: string) => void;
  /**
   * Called for every line written to stdout by the child process.
   */
  onStdoutLine?: (line: string) => void;
}

/**
 * Run a command via `spawn` with **real-time** stderr/stdout streaming.
 *
 * Unlike {@link shell} (which uses `exec` and buffers all output until exit),
 * this function invokes callbacks per line while the process is running.
 *
 * @param bin   Executable name (e.g. `'yt-dlp'`).
 * @param args  Argument array — no shell quoting needed.
 * @param opts  Options including line callbacks.
 * @returns     Full ShellResult on process exit (stdout/stderr still collected).
 */
export function shellStreaming(
  bin: string,
  args: string[],
  opts: ShellStreamingOptions = {},
): Promise<ShellResult> {
  const { cwd, timeoutMs = 120_000, signal, env, onStderrLine, onStdoutLine } = opts;

  return new Promise<ShellResult>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error(`Command aborted before start: ${bin} ${args.join(' ')}`));
    }

    const child = spawn(bin, args, {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    // ── Timeout handling ─────────────────────────────────────────────
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killed = false;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 5000);
      }, timeoutMs);
    }

    // ── Abort signal ─────────────────────────────────────────────────
    const onAbort = () => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 5000);
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // ── Stdout line streaming ────────────────────────────────────────
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        stdoutChunks.push(line);
        onStdoutLine?.(line);
      });
    }

    // ── Stderr line streaming ────────────────────────────────────────
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', (line) => {
        stderrChunks.push(line);
        onStderrLine?.(line);
      });
    }

    // ── Exit handling ────────────────────────────────────────────────
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        return reject(new Error('Command aborted'));
      }

      let exitCode = code ?? 0;
      if (killed || sig) {
        exitCode = 124;
      }

      resolve({
        stdout: stdoutChunks.join('\n'),
        stderr: stderrChunks.join('\n'),
        exitCode,
      });
    });
  });
}
