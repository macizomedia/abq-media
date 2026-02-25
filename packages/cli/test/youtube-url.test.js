import { test, describe } from 'node:test';
import assert from 'node:assert';

import { YouTubeUrl } from '../dist/utils/youtube-url.js';

// ---------------------------------------------------------------------------
// YouTubeUrl.parse — valid URLs
// ---------------------------------------------------------------------------

describe('YouTubeUrl.parse — valid URLs', () => {
  test('parses youtube.com/watch?v=<id>', () => {
    const yt = YouTubeUrl.parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.ok(yt, 'should return a YouTubeUrl');
    assert.equal(yt.videoId, 'dQw4w9WgXcQ');
    assert.equal(yt.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  test('parses youtu.be/<id> short links', () => {
    const yt = YouTubeUrl.parse('https://youtu.be/dQw4w9WgXcQ');
    assert.ok(yt, 'should return a YouTubeUrl');
    assert.equal(yt.videoId, 'dQw4w9WgXcQ');
  });

  test('parses URL with extra query params', () => {
    const yt = YouTubeUrl.parse('https://www.youtube.com/watch?v=abc123&t=42');
    assert.ok(yt);
    assert.equal(yt.videoId, 'abc123');
  });

  test('parses URL without www prefix', () => {
    const yt = YouTubeUrl.parse('https://youtube.com/watch?v=xyz789');
    assert.ok(yt);
    assert.equal(yt.videoId, 'xyz789');
  });
});

// ---------------------------------------------------------------------------
// YouTubeUrl.parse — invalid URLs
// ---------------------------------------------------------------------------

describe('YouTubeUrl.parse — invalid URLs', () => {
  test('returns null for empty string', () => {
    assert.equal(YouTubeUrl.parse(''), null);
  });

  test('returns null for non-URL string', () => {
    assert.equal(YouTubeUrl.parse('not a url'), null);
  });

  test('returns null for non-YouTube URL', () => {
    assert.equal(YouTubeUrl.parse('https://example.com/watch?v=abc'), null);
  });

  test('returns null for YouTube URL without video ID', () => {
    assert.equal(YouTubeUrl.parse('https://www.youtube.com/'), null);
  });

  test('returns null for youtu.be without path', () => {
    assert.equal(YouTubeUrl.parse('https://youtu.be/'), null);
  });
});

// ---------------------------------------------------------------------------
// YouTubeUrl.from — throwing factory
// ---------------------------------------------------------------------------

describe('YouTubeUrl.from', () => {
  test('returns YouTubeUrl for valid URL', () => {
    const yt = YouTubeUrl.from('https://youtube.com/watch?v=test123');
    assert.equal(yt.videoId, 'test123');
  });

  test('throws for invalid URL', () => {
    assert.throws(
      () => YouTubeUrl.from('not-a-url'),
      /Invalid YouTube URL/,
    );
  });
});

// ---------------------------------------------------------------------------
// Value semantics
// ---------------------------------------------------------------------------

describe('YouTubeUrl — value semantics', () => {
  test('equals() returns true for same video ID', () => {
    const a = YouTubeUrl.from('https://youtube.com/watch?v=abc');
    const b = YouTubeUrl.from('https://youtu.be/abc');
    assert.ok(a.equals(b));
  });

  test('equals() returns false for different video IDs', () => {
    const a = YouTubeUrl.from('https://youtube.com/watch?v=abc');
    const b = YouTubeUrl.from('https://youtube.com/watch?v=xyz');
    assert.ok(!a.equals(b));
  });

  test('toString() returns the original URL', () => {
    const url = 'https://www.youtube.com/watch?v=test';
    const yt = YouTubeUrl.from(url);
    assert.equal(yt.toString(), url);
    assert.equal(`${yt}`, url);
  });

  test('toJSON() returns the plain URL string', () => {
    const url = 'https://youtube.com/watch?v=abc';
    const yt = YouTubeUrl.from(url);
    assert.equal(yt.toJSON(), url);
  });

  test('JSON.stringify() serializes to the URL string', () => {
    const yt = YouTubeUrl.from('https://youtube.com/watch?v=abc');
    const json = JSON.stringify({ youtubeUrl: yt });
    const parsed = JSON.parse(json);
    assert.equal(parsed.youtubeUrl, 'https://youtube.com/watch?v=abc');
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip (simulates checkpoint save/restore)
// ---------------------------------------------------------------------------

describe('YouTubeUrl — serialization round-trip', () => {
  test('survives JSON.stringify → parse → YouTubeUrl.parse', () => {
    const original = YouTubeUrl.from('https://youtube.com/watch?v=roundtrip');

    // Simulate checkpoint serialize
    const serialized = JSON.stringify({ youtubeUrl: original });
    const deserialized = JSON.parse(serialized);

    // Simulate checkpoint deserialize
    const restored = YouTubeUrl.parse(deserialized.youtubeUrl);
    assert.ok(restored);
    assert.equal(restored.videoId, original.videoId);
    assert.equal(restored.url, original.url);
    assert.ok(original.equals(restored));
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('YouTubeUrl — immutability', () => {
  test('url and videoId are readonly (cannot reassign)', () => {
    const yt = YouTubeUrl.from('https://youtube.com/watch?v=frozen');
    // Attempting property reassignment should throw in strict mode
    // or silently fail. Either way, the value must not change.
    try {
      (/** @type {any} */ (yt)).url = 'hacked';
    } catch {
      // Expected in strict mode
    }
    assert.equal(yt.url, 'https://youtube.com/watch?v=frozen');

    try {
      (/** @type {any} */ (yt)).videoId = 'hacked';
    } catch {
      // Expected in strict mode
    }
    assert.equal(yt.videoId, 'frozen');
  });
});
