# abq-media-workspace

Open-source modular pipeline for:

YouTube URL -> transcript -> talking points digest -> deep research prompt -> Spanish podcast -> (later) YouTube video engine.

## Maintainer

- GitHub org: `@abquanta`
- npm org: `@abquanta`
- License: MIT

## Status

- Phase: architecture + scaffolding
- Goal: deterministic CLI-first workflow, deployable to AWS Lambda + Step Functions

## Monorepo Modules

- `@abquanta/create-abq-module` - scaffold generator for new modules
- `@abquanta/abq-media-core` - shared domain models + pipeline contracts
- `@abquanta/abq-media-cli` - `abq-media` command-line interface
- `@abquanta/adapter-youtube` - URL normalization + metadata extraction
- `@abquanta/adapter-transcript` - captions/ASR abstraction
- `@abquanta/adapter-tts-soundcloud` - TTS + SoundCloud publishing
- `@abquanta/pipeline-youtube-research-podcast` - first end-to-end pipeline module scaffold

## Quick Start

```bash
npm install
npm run build
```

## Planned CLI

```bash
abq-media prep --url "https://youtube.com/..." --lang es
abq-media podcast --input deep_research.md --lang es --publish soundcloud
abq-media video --audio episode.mp3 --publish youtube
```

## Design Principles

1. Every component is an npm module (reusable, swappable).
2. Deterministic workflow (no hidden autonomous loops).
3. Lambda-friendly boundaries (small stateless functions).
4. Open interfaces for adapters (YouTube/transcript/TTS/publish).
5. Open-source by default with clear docs and examples.

## Repository Checklist (now and future)

Each repo/module should include:

- `README.md` with purpose, architecture, and usage examples
- `LICENSE` (MIT unless explicitly changed)
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md` (Keep a Changelog format)
- issue templates + PR template
- CI workflow (lint/test/build)

## Versioning and Release

- Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- SemVer for releases
- Tag format: `vX.Y.Z`
- Changelog generated per release

## Publishing Policy

- Scoped package names: `@abquanta/<module-name>`
- Public access on npm unless stated otherwise
- Keep adapters in separate modules to avoid lock-in

## Roadmap

### v0.1
- transcript + digest + deep research prompt

### v0.2
- Spanish podcast generation + SoundCloud publish

### v0.3
- video rendering engine + YouTube publish
