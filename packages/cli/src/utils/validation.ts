/**
 * @module utils/validation
 * Input validation helpers for URLs, audio files, and text files.
 *
 * YouTube validation is now delegated to the {@link YouTubeUrl} value object.
 * The `getYouTubeId()` and `isValidYouTubeUrl()` functions are kept for
 * backward compatibility but delegate to `YouTubeUrl.parse()` internally.
 */

import fs from 'node:fs';
import path from 'node:path';

import { YouTubeUrl } from './youtube-url.js';

// Re-export the value object for convenience
export { YouTubeUrl } from './youtube-url.js';

// ---------------------------------------------------------------------------
// YouTube URL validation
// ---------------------------------------------------------------------------

/** Supported audio file extensions (lowercase, with dot). */
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac', '.webm']);

/** Supported text file extensions (lowercase, with dot). */
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.vtt', '.srt']);

/**
 * Extract a YouTube video ID from a URL string.
 * Supports `youtu.be/<id>` and `youtube.com/watch?v=<id>`.
 * Returns `null` for invalid URLs.
 *
 * @deprecated Prefer `YouTubeUrl.parse(raw)?.videoId` for new code.
 */
export function getYouTubeId(raw: string): string | null {
  return YouTubeUrl.parse(raw)?.videoId ?? null;
}

/**
 * Check whether a string is a valid YouTube URL (has an extractable video ID).
 *
 * @deprecated Prefer `YouTubeUrl.parse(url) !== null` for new code.
 */
export function isValidYouTubeUrl(url: string): boolean {
  return YouTubeUrl.parse(url) !== null;
}

// ---------------------------------------------------------------------------
// Audio file validation
// ---------------------------------------------------------------------------

/**
 * Check whether a path points to an existing file with a supported audio extension.
 */
export function isValidAudioFile(filePath: string): boolean {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) return false;
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text file validation
// ---------------------------------------------------------------------------

/**
 * Check whether a path points to an existing file with a supported text extension.
 */
export function isValidTextFile(filePath: string): boolean {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// OpenRouter key validation (moved from monolith's isOpenRouterKey)
// ---------------------------------------------------------------------------

/**
 * Check whether a string looks like a valid OpenRouter API key.
 * Starts with `sk-or-` and is at least 20 characters.
 */
export function isOpenRouterKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith('sk-or-') && key.length >= 20;
}
