# @abquanta/pipeline-youtube-research-podcast

YouTube -> transcript -> talking points -> deep research prompt -> Spanish podcast pipeline.

## Why this exists

Provide a deterministic, CLI-first pipeline for turning YouTube source material into structured research prep and podcast-ready assets.

## Installation

```bash
npm install
```

## Usage

### Init module metadata + keys

```bash
npm run init
```

### Environment doctor (recommended first)

```bash
npx abq-yt-rp doctor
```

### Latest run helper

```bash
# print latest output run path
npx abq-yt-rp latest

# print path to latest deep research prompt
npx abq-yt-rp latest --open prompt
```

### Prep from YouTube URL

```bash
npx abq-yt-rp prep --url "https://youtube.com/watch?v=VIDEO_ID&t=534s" --lang es
```

Tip: pass clean URLs (do not escape `?` and `&` with backslashes).

If caption fetch fails, you can run prep with alternate inputs:

```bash
# Existing transcript
npx abq-yt-rp prep --transcript-file ./transcript.txt --lang es

# Raw text inline
npx abq-yt-rp prep --text "your source text here..." --lang es

# Raw text from file
npx abq-yt-rp prep --text-file ./notes.md --lang es
```

Creates:

- `output/prep-*/metadata.json`
- `output/prep-*/transcript.txt`
- `output/prep-*/digest.md`
- `output/prep-*/deep_research_prompt.md`

### Podcast stage (stub)

```bash
npx abq-yt-rp podcast --input ./deep_research.md --lang es
```

## LLM Configuration

Use `.abq-module.json` in your working directory.

### Option A: direct OpenRouter

```json
{
  "llmProvider": "openrouter",
  "llmApiKey": "sk-or-...",
  "model": "openrouter/auto"
}
```

### Option B: OpenRouter headless agent endpoint

```json
{
  "llmProvider": "openrouter-agent",
  "agentEndpoint": "http://127.0.0.1:8787/infer",
  "llmApiKey": "optional_if_agent_requires_it",
  "model": "openrouter/auto"
}
```

### Option C: OpenAI-compatible endpoint

```json
{
  "llmProvider": "openai",
  "llmApiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini"
}
```

If config is missing/invalid, digest falls back to heuristic extraction.

### Optional API ASR fallback config

```json
{
  "asrProvider": "openai",
  "asrApiKey": "sk-...",
  "asrModel": "gpt-4o-mini-transcribe",
  "asrBaseUrl": "https://api.openai.com/v1"
}
```

OpenRouter variant:

```json
{
  "asrProvider": "openrouter",
  "asrApiKey": "sk-or-...",
  "asrModel": "openai/whisper-1",
  "asrBaseUrl": "https://openrouter.ai/api/v1"
}
```

If `asrProvider/asrApiKey` are omitted, API ASR fallback is skipped.

## Architecture

- `prep`: ingest + transcript + digest + research-prompt artifacts
  - current transcript order for YouTube input:
    1) YouTube timedtext API captions
    2) `yt-dlp` subtitle fallback (`.vtt`)
    3) local Whisper fallback (`yt-dlp` audio + `whisper` CLI)
    4) API ASR fallback (`yt-dlp` audio + OpenAI/OpenRouter transcription API)
  - alternate non-YouTube inputs: `--transcript-file` / `--text` / `--text-file`
  - metadata includes `transcriptMode` for debugging (`youtube-captions`, `yt-dlp-subs`, `whisper-local`, `asr-openai`, `asr-openrouter`, `transcript-file`, `text-inline`, `text-file`)
- `podcast`: script + tts + publish (planned)

## Local Whisper Requirements (optional fallback)

Whisper fallback is used only when captions/subtitles are unavailable.

Required local tools:

```bash
brew install yt-dlp
python3 -m pip install -U openai-whisper
# ffmpeg is usually required by whisper
brew install ffmpeg
```

Optional model override:

- In `.abq-module.json`: `"whisperModel": "base" | "small" | "medium" | ...`
- Or env var: `WHISPER_MODEL=small`

## Development

```bash
npm run lint
npm test
npm run build
```

## Versioning and Release

- SemVer
- Conventional Commits
- Git tags: `vX.Y.Z`

## Publishing

```bash
npm publish --access public
```

## Open Source

MIT License.
