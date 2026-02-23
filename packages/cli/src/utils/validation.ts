/**
 * @module utils/validation
 * Input validation helpers for URLs, audio files, and text files.
 *
 * YouTube ID extraction is adapted from the monolith's `getYouTubeId()`.
 * Audio/text validators check extension AND existence on disk.
 */

import fs from 'node:fs';
import path from 'node:path';

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
 * Extracted from the monolith's `getYouTubeId()`.
 */
export function getYouTubeId(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace('/', '').trim() || null;
    }
    if (url.hostname.includes('youtube.com')) {
      return url.searchParams.get('v');
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

/**
 * Check whether a string is a valid YouTube URL (has an extractable video ID).
 */
export function isValidYouTubeUrl(url: string): boolean {
  return getYouTubeId(url) !== null;
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
