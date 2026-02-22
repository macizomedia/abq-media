# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Workspace-level (run from repo root)

```bash
npm install          # Install all workspace dependencies
npm run build        # Build all packages
npm test             # Run all package tests
npm run lint         # Lint all packages

# Pipeline shortcuts (delegate to pipeline-youtube-research-podcast)
npm run yt:doctor    # Check environment readiness
npm run yt:prep -- --url "https://youtube.com/watch?v=..." --lang es
npm run yt:latest    # Print path to latest output run
npm run yt:podcast -- --input ./deep_research.md --lang es
npm run yt:publish -- --input ./prompt.md --lang es

# TTS shortcuts (delegate to adapter-elevenlabs-tts)
npm run tts:render -- --input path/to/podcast_script.md
npm run tts:doctor
```

### CLI package (packages/cli)

```bash
node packages/cli/src/cli.js init       # Interactive project setup
node packages/cli/src/cli.js run        # Guided TUI pipeline (input → transcript → article)
node packages/cli/src/cli.js run --debugger  # Use sample artifacts, no external calls
node packages/cli/src/cli.js doctor     # Check OpenRouter API key + connectivity
node packages/cli/src/cli.js reset      # Remove project data or credentials

# Run CLI tests
node --test packages/cli/test/smoke.test.js
```

### Pipeline package (packages/pipeline-youtube-research-podcast)

```bash
# All these run from repo root via npm run yt:prep etc., or directly:
node packages/pipeline-youtube-research-podcast/src/cli.js prep --url "..." --lang es
node packages/pipeline-youtube-research-podcast/src/cli.js prep --transcript-file ./t.txt --lang es
node packages/pipeline-youtube-research-podcast/src/cli.js prep --text-file ./notes.md --lang es
node packages/pipeline-youtube-research-podcast/src/cli.js doctor
node packages/pipeline-youtube-research-podcast/src/cli.js latest
node packages/pipeline-youtube-research-podcast/src/cli.js publish --input ./prompt.md --lang es

# Run pipeline tests
node --test packages/pipeline-youtube-research-podcast/test/smoke.test.js
```

## Architecture

This is an npm workspaces monorepo (Node ≥20, ESM throughout — all packages use `"type": "module"`).

### Two-layer CLI design

The repo has **two separate CLI entry points** that serve different purposes:

1. **`packages/cli`** (`abq-media` binary) — High-level TUI workflow for end users. Uses `@clack/prompts` for interactive menus. Orchestrates the pipeline by shelling out to `npm run yt:prep` / `npm run yt:publish` as child processes. State is stored in `~/.abq-media/projects/<name>/runs/`. Handles transcript caching via a per-project `registry.json`.

2. **`packages/pipeline-youtube-research-podcast`** (`abq-yt-rp` binary) — The actual pipeline logic. Handles YouTube caption fetching, Whisper/ASR fallback, LLM-based digest generation, deep research prompt generation, and publish (article + social posts + podcast script). Outputs land in `packages/pipeline-youtube-research-podcast/output/prep-<timestamp>/` and `output/publish-<timestamp>/`.

### Pipeline flow (prep stage)

```
YouTube URL / audio file / text file
  ↓
Transcript (caption API → yt-dlp subs → local Whisper → API ASR)
  ↓
Digest (talking points, LLM or heuristic fallback)
  ↓
deep_research_prompt.md  ← output artifact for human review
```

### Pipeline flow (publish stage)

```
deep_research_prompt.md (optionally edited by user)
  ↓
LLM generates: podcast_script.md, article.md, reel_script.md, social_posts.md
```

### LLM / ASR configuration

Each package reads `.abq-module.json` from the working directory (not committed). Supported providers: `openrouter`, `openrouter-agent`, `openai`. OpenRouter keys start with `sk-or-`. The CLI stores credentials globally in `~/.abq-media/credentials.json`.

### Transcript fallback chain (YouTube)

1. YouTube timedtext API captions
2. `yt-dlp` subtitle fallback (`.vtt`)
3. Local Whisper CLI (`yt-dlp` audio + `whisper`)
4. API ASR (`yt-dlp` audio + OpenAI/OpenRouter transcription API)

`metadata.json` in each prep output includes `transcriptMode` to identify which path was used.

### Active packages

| Package | Binary | Purpose |
|---------|--------|---------|
| `packages/cli` | `abq-media` | TUI orchestrator |
| `packages/pipeline-youtube-research-podcast` | `abq-yt-rp` | Core pipeline logic |
| `packages/adapter-elevenlabs-tts` | `abq-el-tts` | TTS: renders `HOST_A:`/`HOST_B:` dialogue scripts to MP3 via ElevenLabs + ffmpeg |

### Output structure

- Pipeline outputs: `packages/pipeline-youtube-research-podcast/output/prep-<ts>/` and `output/publish-<ts>/`
- CLI run state: `~/.abq-media/projects/<name>/runs/<ts>/state.json`
- CLI exports (zip): `~/.abq-media/projects/<name>/exports/`

### Planned but not yet implemented

`packages/engine-narratome`, `packages/adapters-youtube`, `packages/adapters-transcript`, `packages/adapters-tts-soundcloud`, `packages/core`, `packages/create-abq-module` — scaffold exists but logic is not wired up.

## Conventions

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, etc.) and SemVer
- All packages are ESM; use `import`/`export`, not `require`
- Tests use Node's built-in test runner (`node:test` + `node:assert`), not Jest/Mocha
- Package names are scoped: `@abquanta/<module-name>`
- The `--` separator is required when passing args through workspace scripts: `npm run yt:prep -- --url "..."`
