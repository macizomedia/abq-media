/**
 * @module utils/index
 * Re-exports all shared utilities.
 */

export { shell, shellStrict, hasCommand, shellStreaming, type ShellResult, type ShellOptions, type ShellStreamingOptions } from './shell.js';
export { ensureDir, nowStamp, makeTempDir, rmSafe, readJsonSafe, writeJson, writeText } from './fs.js';
export { loadDotenv } from './env.js';
