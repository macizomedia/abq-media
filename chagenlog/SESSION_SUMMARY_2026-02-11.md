# Session Summary — 2026-02-11

## Objective
Build a modular @abquanta npm framework and first pipeline module:
YouTube -> transcript -> digest -> deep research prompt -> (later) podcast/video.

## Major Outcomes

### 1) Framework + Guardrails
- Created monorepo scaffold at `projects/abq-media`.
- Enforced standards via `PROJECT_GUARDRAILS.md`:
  - npm-module-first
  - `@abquanta` naming
  - open-source by default
  - version-control and repo docs conventions
  - module `init` command convention
- Added reusable module template at `templates/abquanta-module` with MIT + standard docs.

### 2) Module Generator
- Implemented `@abquanta/create-abq-module`.
- Added helper script: `projects/abq-media/scripts/create-module.sh`.

### 3) First Pipeline Module
- Created `@abquanta/pipeline-youtube-research-podcast`.
- Added commands:
  - `init`
  - `doctor`
  - `prep`
  - `latest`
  - `podcast` (stub)

### 4) Prep Pipeline Evolution
Implemented progressively:
- URL normalization + robust video-id parsing.
- Input modes:
  - `--url`
  - `--transcript-file`
  - `--text`
  - `--text-file`
- Transcript fallback chain for `--url`:
  1. YouTube timedtext captions
  2. `yt-dlp` subtitle `.vtt`
  3. local Whisper CLI (`whisper`) transcription
  4. API ASR fallback (OpenAI/OpenRouter transcription endpoint)
- LLM digest provider modes:
  - `openai`
  - `openrouter`
  - `openrouter-agent` endpoint
  - heuristic fallback if unavailable
- Metadata enriched with `transcriptMode` and `digestMode`.

### 5) OpenRouter Agent Integration
- Implemented HTTP server mode in `openrouter-agent`:
  - `GET /health`
  - `POST /infer`
- Added scripts:
  - `npm run start:server`
  - `npm run dev:server`

### 6) Usability
- Added `latest` helper command:
  - `latest`
  - `latest --open prompt|digest|transcript|metadata`

## Known Issues / Notes
- Some YouTube videos still fail direct caption retrieval.
- Local Whisper install can fail on older macOS toolchains.
- API ASR fallback depends on valid key/model/quota.
- OpenRouter free model path worked at infra level but failed when account/key had credit/account restrictions.
- OpenAI key was temporarily stored in `.abq-module.json`; rotate and move to env vars.

## Commit Recorded
- `49e82cb` — `feat(pipeline): add latest command for newest prep outputs`

## Recommendation
Publish first as prerelease (`alpha`) instead of stable `latest`.
