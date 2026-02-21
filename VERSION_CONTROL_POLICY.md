# Version Control & Release Policy

This document defines how we work in Git, how we version packages, and how we publish. It is aligned with the current repo tooling and the updated AGENTS.md.

## Scope

- Applies to all packages in this monorepo.
- If a package needs different rules, document the exception in that package's README.

## Branching Model

- Trunk-based development with short-lived feature branches.
- `main` must always be deployable.
- Branch prefixes:
- `feature/` for new functionality
- `fix/` for bug fixes
- `chore/` for tooling or docs
- `experiment/` for spikes that are never merged

Rules:
- Keep branches under 3 days.
- Always merge to `main` via PR.
- No direct pushes to `main`.

## Commit Convention

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`.
- Include a package scope when relevant: `feat(engine-narratome): ...`.
- Subject line max 72 characters, imperative mood.

## Pull Requests

- One concern per PR.
- PRs must include test evidence or a note explaining why tests are not needed.
- Use a short description of why, not just what.

## CI Gates (Minimum)

- Run workspace tests: `npm run -ws test`.
- Run workspace lint if available: `npm run -ws lint`.
- Run workspace build if available: `npm run -ws build`.

If a package has no lint or build scripts yet, it should return success with a clear message until implemented.

## Testing Expectations

- Feature and bug-fix PRs must include tests.
- Doc-only changes do not require tests.
- If tests are intentionally skipped, the PR must state why.

## Versioning Strategy

- Independent versions per package.
- Use pre-release `0.x` until a package is stable.
- Semantic Versioning applies per package.

## Release Tags

- Repo release tags use `vX.Y.Z` when we cut a coordinated release.
- Package release tags use `@abquanta/<pkg>@X.Y.Z` when publishing.

## Publishing Policy

- Publish only packages marked ready in their README.
- Add `publishConfig.access` to each package, default `public` unless stated otherwise.
- Publishing is blocked until npm auth is resolved.

## Changelog

- Changelog is per package.
- Update the package changelog only at release time.

## Documentation Ownership

- Root README explains the platform and top-level workflow.
- Each package README is the source of truth for usage and configuration.

## API Stability

- CLI commands and flags are part of the public API.
- Config keys in `.abq-module.json` are part of the public API.
- Changes to these require at least a minor version bump, or a major bump if breaking.
