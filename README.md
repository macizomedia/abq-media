# abq-media

Modular content pipeline for ingesting, transcribing, researching, and publishing media — built on a typed stage architecture with real-time progress streaming.

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Link the CLI
npm link -w @abquanta/abq-media-cli

# Run setup (configure API keys)
abq-media setup

# Transform a YouTube video into a podcast
abq-media transform "https://youtube.com/watch?v=xyz" --into podcast
```

## Packages

| Package | Description |
|---------|-------------|
| `@abquanta/abq-media-core` | Pipeline runner, stages, config, providers |
| `@abquanta/abq-media-cli` | CLI interface (`abq-media` command) |
| `@abquanta/adapter-elevenlabs-tts` | ElevenLabs TTS adapter |
| `@abquanta/adapters-transcript` | Transcript format adapters |
| `@abquanta/adapters-tts-soundcloud` | SoundCloud TTS adapter |
| `@abquanta/adapters-youtube` | YouTube data adapter |
| `@abquanta/create-abq-module` | Scaffolding tool |
| `@abquanta/pipeline-youtube-research-podcast` | Standalone YouTube-to-podcast pipeline |

## Architecture

```
                 ┌──────────────────────────────────────────┐
                 │           CLI  (abq-media)               │
                 │  setup · transform · recipes · projects  │
                 └────────────────┬─────────────────────────┘
                                  │  core-bridge
                 ┌────────────────▼─────────────────────────┐
                 │             Core Pipeline                 │
                 │  Stage → Stage → Stage → … → Result      │
                 │  ├─ FallbackStage   (try alternatives)   │
                 │  ├─ ParallelStage   (concurrent work)    │
                 │  └─ PipelineEmitter (typed events)       │
                 └────────────────┬─────────────────────────┘
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
            ┌──────────┐   ┌──────────┐   ┌──────────┐
            │  Ingest   │   │ Process  │   │ Publish  │
            │  youtube  │   │ digest   │   │ article  │
            │  text     │   │ research │   │ podcast  │
            │  audio    │   │ prompt   │   │ reel     │
            └──────────┘   └──────────┘   │ social   │
                                          │ tts      │
                                          └──────────┘
```

## CLI Commands

```
Usage: abq-media <command> [subcommand] [options]

Commands:
  setup      Configure API keys and defaults
  transform  Transform content into artifacts
  recipes    List/create/edit recipes
  projects   List/open/export/continue projects
  prompts    List/show/edit/reset AI prompts
  doctor     Check environment readiness
  hello      Print a greeting
```

### `transform`

```bash
abq-media transform <source> [options]
```

| Option | Description |
|--------|-------------|
| `<source>` | YouTube URL, file path, or text |
| `--into <format>` | `transcript`, `research`, `podcast`, `article`, `translation`, `video-script` |
| `--using <recipe>` | Recipe name (auto-selected if omitted) |
| `--lang <code>` | BCP-47 language code (default: `es`) |
| `--name <name>` | Override project directory name |
| `--output <dir>` | Override output root directory |
| `--dry-run` | Plan only, skip execution |

### yt-dlp Options (YouTube sources)

When the source is a YouTube URL, the following flags control yt-dlp behavior:

| Flag | Description |
|------|-------------|
| `--simulate` | Probe only — no downloads, returns structured metadata report |
| `--ytdlp-verbose` | Increase yt-dlp verbosity (`--verbose`) |
| `--ytdlp-debug` | Maximum verbosity with protocol dump (`--verbose --print-traffic`) |
| `--ytdlp-quiet` | Suppress yt-dlp output (`--quiet`) |
| `--ytdlp-format <sel>` | yt-dlp format selector (e.g. `"bestaudio"`) |
| `--ytdlp-audio-format <f>` | Post-process audio format: `mp3`, `wav`, `opus`, `aac`, `flac`, `best` |
| `--ytdlp-sub-format <f>` | Subtitle format: `vtt`, `srt`, `ass`, `best` |
| `--ytdlp-sub-langs <langs>` | Subtitle languages, comma-separated (e.g. `"en,es"`) |
| `--cookies <path>` | Path to Netscape-format cookies file |
| `--cookies-from-browser <b>` | Extract cookies from browser: `chrome`, `firefox`, `safari`, `edge`, `brave` |
| `--proxy <url>` | HTTP/SOCKS proxy URL |
| `--rate-limit <rate>` | Download rate limit (e.g. `"50K"`, `"4.2M"`) |
| `--force-ipv4` | Force connections through IPv4 |
| `--geo-bypass` | Bypass geographic restrictions |

**Examples:**

```bash
# Probe a video without downloading anything
abq-media transform "https://youtube.com/watch?v=xyz" --simulate

# Verbose transcription with specific subtitle languages
abq-media transform "https://youtube.com/watch?v=xyz" --into transcript \
  --ytdlp-verbose --ytdlp-sub-langs "en,es"

# Download with cookies and rate limiting
abq-media transform "https://youtube.com/watch?v=xyz" --into podcast \
  --cookies ~/cookies.txt --rate-limit "2M"

# Use browser cookies (solves PO token / bot detection issues)
abq-media transform "https://youtube.com/watch?v=xyz" --into podcast \
  --cookies-from-browser chrome

# Force IPv4 and geo-bypass for restricted content
abq-media transform "https://youtube.com/watch?v=xyz" --into research \
  --force-ipv4 --geo-bypass

# Debug yt-dlp issues with full protocol dump
abq-media transform "https://youtube.com/watch?v=xyz" --into transcript \
  --ytdlp-debug
```

### Environment Variables

yt-dlp settings can also be configured via environment variables (useful for CI or `.env` files):

| Variable | Maps to | Example |
|----------|---------|---------|
| `YTDLP_VERBOSITY` | Verbosity level | `verbose` |
| `YTDLP_SIMULATE=1` | Simulate mode | `1` |
| `YTDLP_COOKIES` | Cookies file path | `~/cookies.txt` |
| `YTDLP_COOKIES_FROM_BROWSER` | Browser name | `chrome` |
| `YTDLP_PROXY` | Proxy URL | `socks5://127.0.0.1:1080` |
| `YTDLP_RATE_LIMIT` | Rate limit | `50K` |
| `YTDLP_AUDIO_FORMAT` | Audio format | `opus` |
| `YTDLP_SUBTITLE_FORMAT` | Subtitle format | `srt` |

CLI flags take precedence over env vars, which take precedence over config files.

### Configuration Files

Settings are loaded in order (later layers override earlier):

1. `.abq-module.json` — project-level config
2. `~/.abq-media/credentials.json` — user-level credentials
3. Environment variables
4. CLI flags

**`.abq-module.json` example with yt-dlp config:**

```json
{
  "lang": "es",
  "ytdlp": {
    "verbosity": "normal",
    "simulate": false,
    "audioFormat": "mp3",
    "audioQuality": 5,
    "subtitleFormat": "vtt",
    "subtitleLangs": ["en", "es"],
    "subtitleTimeoutMs": 60000,
    "audioTimeoutMs": 120000,
    "workarounds": {
      "forceIpv4": false,
      "geoBypass": false,
      "sleepInterval": 0,
      "sleepSubtitles": 0,
      "retries": 10,
      "fragmentRetries": 10
    }
  }
}
```

## yt-dlp Sub-Stage Architecture

The YouTube ingest pipeline decomposes yt-dlp operations into four micro-stages with real-time progress streaming:

```
youtubeIngestStage  (FallbackStage)
├─ captionsStage            (YouTube timedtext API)
├─ ytdlpSubsStage           ┬─ ytdlp:probe
│  (transcribe:ytdlp)       └─ ytdlp:subtitles
└─ ytAsrStage                ┬─ ytdlp:probe
   (transcribe:yt-asr)       ├─ ytdlp:audio
                              ├─ ytdlp:post-process
                              └─ ASR transcription
```

| Stage | Purpose |
|-------|---------|
| `ytdlp:probe` | Runs `yt-dlp --simulate --dump-json` — returns structured metadata with available formats, subtitles, and video info. Terminal in simulate mode. |
| `ytdlp:subtitles` | Downloads subtitles with configurable format and language selection. Emits real-time progress events. |
| `ytdlp:audio` | Downloads audio with format/quality selection. Streams download progress (percent, speed, ETA). |
| `ytdlp:post-process` | FFmpeg conversion optimized for ASR (mono, 16kHz, 64kbps). Isolated so failures preserve downloaded audio. |

### Programmatic API

```typescript
import { youtubeIngestStage, probeStage, type YtdlpOverrides } from '@abquanta/abq-media-core';

// Use the full fallback pipeline
const result = await pipeline.run({
  url: 'https://youtube.com/watch?v=abc123',
  ytdlp: {
    simulate: true,           // probe only — no downloads
    verbosity: 'verbose',
    audioFormat: 'opus',
    workarounds: { geoBypass: true },
  },
});

// Or use probeStage directly for metadata extraction
import { buildYtdlpArgs, formatCommandPreview } from '@abquanta/abq-media-core';
const args = buildYtdlpArgs('probe', resolvedConfig, url);
console.log(formatCommandPreview(args));
```

## Prerequisites

- Node.js `>=20`
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (for YouTube sources)
- [FFmpeg](https://ffmpeg.org/) (for audio post-processing)

## Troubleshooting

### YouTube PO Token / Bot Detection

YouTube requires a **Proof of Origin (PO) token** to serve content. If you see:
```
[youtube] [pot] PO Token Providers: none
```

This means yt-dlp cannot authenticate with YouTube. **Solutions:**

1. **Use browser cookies** (recommended):
   ```bash
   abq-media transform "https://youtube.com/watch?v=xyz" --into podcast \
     --cookies-from-browser chrome
   ```
   This extracts cookies from your logged-in browser session. Supported browsers: `chrome`, `firefox`, `safari`, `edge`, `brave`, `chromium`, `opera`, `vivaldi`.

2. **Export cookies file manually**:
   Use a browser extension like "Get cookies.txt" to export cookies, then:
   ```bash
   abq-media transform "https://youtube.com/watch?v=xyz" --into podcast \
     --cookies ~/cookies.txt
   ```

3. **Set as environment variable** (persists across runs):
   ```bash
   export YTDLP_COOKIES_FROM_BROWSER=chrome
   abq-media transform "https://youtube.com/watch?v=xyz" --into podcast
   ```

### Timeout Errors (exit code 124)

If audio downloads time out, the default is 5 minutes. You can increase it in `.abq-module.json`:
```json
{
  "ytdlp": { "audioTimeoutMs": 600000 }
}
```

### Geo-Restricted Content

```bash
abq-media transform "https://youtube.com/watch?v=xyz" --into podcast \
  --geo-bypass --force-ipv4
```

## Guides

- [Setup + Recipe + Transform](docs/setup-recipe-transform-guide.md)
- [yt-dlp Sub-Stage Plan](packages/core/src/stages/ingest/ytdlp/YTDLP_SUBSTAGE_PLAN.md)
- [Architecture](chagenlog/ARCHITECTURE.md)

## Maintainer

- GitHub org: `@abquanta`
- npm org: `@abquanta`
- License: MIT

## Status

- Phase: architecture + scaffolding
