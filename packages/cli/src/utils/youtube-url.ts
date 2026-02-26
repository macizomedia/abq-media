/**
 * @module utils/youtube-url
 * Value Object for validated YouTube URLs.
 *
 * Encapsulates URL validation and video ID extraction in a single immutable
 * object. Once constructed, a YouTubeUrl is guaranteed to contain a valid
 * YouTube URL with an extractable video ID.
 *
 * Usage:
 * ```ts
 * const yt = YouTubeUrl.parse('https://youtube.com/watch?v=abc123');
 * if (yt) {
 *   console.log(yt.videoId); // 'abc123'
 *   console.log(yt.url);     // 'https://youtube.com/watch?v=abc123'
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// ID extraction (private)
// ---------------------------------------------------------------------------

/**
 * Extract a YouTube video ID from a URL string.
 * Supports `youtu.be/<id>` and `youtube.com/watch?v=<id>`.
 * Returns `null` for invalid URLs.
 */
function extractVideoId(raw: string): string | null {
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

// ---------------------------------------------------------------------------
// YouTubeUrl Value Object
// ---------------------------------------------------------------------------

/**
 * Immutable Value Object wrapping a validated YouTube URL.
 *
 * Construction is only possible through the static factory methods `parse()`
 * and `from()`. The private constructor guarantees that every instance holds
 * a valid URL with a non-empty video ID.
 */
export class YouTubeUrl {
  /** The original validated URL string. */
  readonly url: string;

  /** The extracted YouTube video ID. */
  readonly videoId: string;

  private constructor(url: string, videoId: string) {
    this.url = url;
    this.videoId = videoId;
    Object.freeze(this);
  }

  // ── Factory methods ─────────────────────────────────────────────────

  /**
   * Parse a raw string into a YouTubeUrl.
   * Returns `null` if the string is not a valid YouTube URL.
   */
  static parse(raw: string): YouTubeUrl | null {
    const id = extractVideoId(raw);
    return id ? new YouTubeUrl(raw, id) : null;
  }

  /**
   * Parse a raw string into a YouTubeUrl.
   * Throws if the string is not a valid YouTube URL.
   */
  static from(raw: string): YouTubeUrl {
    const result = YouTubeUrl.parse(raw);
    if (!result) {
      throw new Error(`Invalid YouTube URL: ${raw}`);
    }
    return result;
  }

  // ── Value semantics ─────────────────────────────────────────────────

  /** Two YouTubeUrl instances are equal if they reference the same video. */
  equals(other: YouTubeUrl): boolean {
    return this.videoId === other.videoId;
  }

  /** Returns the original URL string. */
  toString(): string {
    return this.url;
  }

  /**
   * JSON serialization — stores as the plain URL string.
   * This is called automatically by `JSON.stringify()`.
   */
  toJSON(): string {
    return this.url;
  }
}
