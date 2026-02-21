# Repository Development & Agent Policy

> **Authoritative guidance for human contributors and AI coding agents (GitHub Copilot, Claude, Codex, etc.).**
> This file is version-controlled. Changes require a PR reviewed by a Staff Engineer or Security Lead.
> Last substantive revision: see `git log -1 -- AGENTS.md`.

---

## Scope and authority

This document governs **all code changes** to this repository, whether authored by humans or AI agents. It supersedes any conflicting guidance in README files, inline comments, or verbal agreements. When in doubt, follow this file; if this file is silent, open a discussion before acting.

**Defaults (adjust if repo differs):** This document assumes a TypeScript/Node.js project using:

- Runtime: Node.js ≥ 20 LTS
- Package manager: `npm` (lockfile: `package-lock.json`)
- Linter: ESLint with `@typescript-eslint`
- Formatter: Prettier
- Test runner: Vitest
- Build: `tsc` + `esbuild` or `tsup`
- CI: GitHub Actions
- Container: Docker (multi-stage)
- Secrets scanning: `gitleaks` + GitHub secret scanning

If any tool differs, update the **Defaults** callout nearest to where it appears.

---

## Golden rules (must-follow)

These rules are non-negotiable. Any PR that violates them will be closed without merge.

1. **DO NOT commit secrets, credentials, tokens, or PII.** Not even in comments or test fixtures.
2. **DO NOT merge without passing CI.** All gates must be green; no force-merges to `main`.
3. **DO NOT make broad refactors without a pre-approved design issue.** One concern per PR.
4. **DO NOT break public APIs without a major version bump and deprecation cycle.**
5. **DO write or update tests for every bug fix and feature.** PRs with net-negative test coverage delta are rejected.
6. **DO keep PRs small.** Target < 400 lines changed. Split larger work into stacked PRs.
7. **DO explain your reasoning** in the PR description or commit body. "Why" matters more than "what."
8. **DO follow the commit message convention** defined in this file. No exceptions.
9. **DO run the full local quality pipeline before opening a PR.**
10. **DO ask before touching infrastructure, CI configuration, or security-critical paths.**

---

## Allowed vs forbidden changes

### Allowed without pre-approval

- Bug fixes scoped to a single module with accompanying tests
- Dependency patch-version bumps (automated via Renovate)
- Documentation improvements
- New features behind a feature flag
- Performance improvements with benchmarks attached to the PR
- Adding new API endpoints that do not alter existing contracts
- Refactoring a single function or file with zero behavior change (must include before/after tests proving equivalence)

### Requires a linked design issue and Staff Engineer approval

- New external service dependencies
- Database schema changes or new migrations
- Changes to authentication / authorization logic
- Changes to public API contracts (routes, response shapes, SDK interfaces)
- Any cross-cutting refactor touching > 5 files with shared logic
- Changes to CI pipelines, Dockerfiles, or deployment manifests
- Enabling or disabling ESLint rules project-wide
- Changes to this file

### Forbidden at all times

- Committing `.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, or any credential file
- Disabling secret scanning or security CI steps
- `--force` push to `main` or `release/*`
- Vendoring code with an incompatible or unknown license
- Adding `eval()`, `new Function(string)`, or equivalent dynamic code execution without a security review issue
- Removing test coverage for existing paths without explicit approval
- Using `any` in TypeScript to silence a type error (use `unknown` + narrowing instead)
- Silent catch blocks: `catch (_e) {}` or `catch (e) { /* ignore */ }`

---

## Security policy

### Secrets management

```
# GOOD: committed example file with no real values
.env.example        ← commit this
.env.local          ← NEVER commit; in .gitignore
.env.production     ← NEVER commit; inject via CI/CD secrets
```

- Store secrets in GitHub Actions Secrets (CI), Doppler, or AWS Secrets Manager for runtime.
- Reference secrets via environment variables only. Never hardcode.
- Rotate any secret that is accidentally committed **immediately**; treat it as compromised regardless of whether the commit was pushed.
- Run `pnpm run secrets:scan` locally before pushing (wraps `gitleaks detect --source .`).

### Dependency security

- Run `pnpm audit --audit-level=high` in CI. Fail on `high` or `critical`.
- Renovate auto-creates PRs for patch bumps; minor/major bumps require human review.
- Do not add a new `npm` package without checking its: weekly downloads, last publish date, maintainer count, and whether it has a known CVE. Document this check in the PR.

### Input validation

- **All external input** (HTTP bodies, query params, headers, CLI args, env vars, file content) MUST be parsed and validated through a schema library (`zod` is the project default).
- Never trust `req.body` directly. Always validate before use.
- Sanitize before rendering HTML; use a trusted library (`DOMPurify` on client, `sanitize-html` on server).

### Authentication & authorization

- DO NOT roll your own auth primitives. Use established libraries (e.g., `jose` for JWT, `passport` for strategies).
- Enforce authorization at the **service layer**, not only at the route layer.
- Log auth failures with correlation ID; never log passwords or tokens even partially.

### Safe logging

```typescript
// GOOD
logger.info({ userId, action: "login", correlationId }, "User authenticated");

// BAD — never log secrets or full request bodies containing sensitive data
logger.info({ password: req.body.password }); // ❌
logger.info({ token: user.apiToken }); // ❌
logger.debug(JSON.stringify(req.body)); // ❌ unless explicitly scrubbed
```

- Use a structured logger (`pino` is the project default).
- Every backend request MUST include a `correlationId` (generated at edge, propagated via `AsyncLocalStorage`).
- PII fields to always redact: `password`, `token`, `secret`, `ssn`, `creditCard`, `cvv`, `pin`, `apiKey`. Configure `pino`'s `redact` option with these paths.

### Error handling

```typescript
// GOOD — typed, surfaced, logged with context
import { AppError } from "@/lib/errors";

try {
  await riskyOperation();
} catch (err) {
  if (err instanceof KnownDomainError) {
    throw new AppError("OPERATION_FAILED", "Context message", { cause: err });
  }
  throw err; // re-throw unknown errors; let the global handler deal with them
}

// BAD
try {
  await riskyOperation();
} catch (_e) {} // ❌ silent catch
```

- Define error types in `src/lib/errors.ts` with codes, HTTP status, and whether they are operational vs. programmer errors.
- Global uncaught exception / unhandled rejection handlers must log and terminate the process. Do not swallow them.

---

## Coding standards

### TypeScript

- `strict: true` in `tsconfig.json`. No overrides without a comment explaining why.
- Prefer `unknown` over `any`. If `any` is genuinely needed, add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with a one-line justification on the same line.
- Prefer `type` aliases for unions/primitives; use `interface` for object shapes that may be extended.
- Avoid `namespace`; use ES modules.
- Use `satisfies` operator to validate object shapes against types without widening.
- Return types on all exported functions must be explicit.

### Naming

| Construct                        | Convention                 | Example           |
| -------------------------------- | -------------------------- | ----------------- |
| Files (modules)                  | `kebab-case`               | `user-service.ts` |
| Classes                          | `PascalCase`               | `UserService`     |
| Interfaces / Types               | `PascalCase`               | `CreateUserDto`   |
| Functions / variables            | `camelCase`                | `getUserById`     |
| Constants (module-level)         | `SCREAMING_SNAKE`          | `MAX_RETRY_COUNT` |
| Env vars                         | `SCREAMING_SNAKE`          | `DATABASE_URL`    |
| React components (if applicable) | `PascalCase` file + export | `UserCard.tsx`    |

### File organization

```
src/
  api/            # Route handlers (thin layer, no business logic)
  services/       # Business logic
  repositories/   # Data access (DB, external APIs)
  lib/            # Shared utilities, errors, logger, config
  types/          # Shared TypeScript types and Zod schemas
  middleware/     # Express/Fastify middleware
  config/         # App configuration (reads from env, validated with Zod)
tests/
  unit/           # Mirror src/ structure
  integration/    # Require real or containerized dependencies
  e2e/            # Full stack; run in CI only on main and release branches
```

### Formatting & lint

- Prettier is the source of truth for formatting. Do not manually format; run `pnpm format`.
- ESLint enforces logic rules. Run `pnpm lint`.
- To disable a lint rule inline:

```typescript
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by schema validation above
const value = map.get(key)!;
```

A justification comment is **mandatory**. Reviewers will reject bare disables.

- Do not disable `no-unused-vars`, `no-console`, or security-related rules file-wide.

### Performance

- Avoid N+1 queries. Use batch fetches, `dataloader`, or join queries.
- Do not block the event loop. Move CPU-intensive work to a worker thread or queue.
- Use streaming (`ReadableStream`, `pipeline`) for large file I/O.
- Profile before optimizing. Attach a flamegraph or benchmark to performance PRs.

### Comments

- Write comments for **why**, not **what**. Code should explain what; comments explain decisions, edge cases, and non-obvious constraints.
- Use `// TODO(username): <issue-url>` format. No bare `TODO` without an owner and a linked issue.
- Use `// HACK:` with an explanation and an issue link when taking a deliberate shortcut.

### Generated and vendored files

- Generated files (e.g., GraphQL types, OpenAPI clients) must include a header: `// DO NOT EDIT — generated by <tool>. See <script>.`
- Commit generated files only if they are part of the public API surface or required for zero-install usage.
- Vendored code lives in `vendor/` with its original license file. Never modify vendored code in-place; patch via a wrapper or fork.
- `pnpm-lock.yaml` is always committed. Never delete it. If it conflicts, resolve it with `pnpm install` and commit the result.

---

## Testing & quality gates

### Requirements

- **Unit tests**: every service function, utility, and validation schema. Target ≥ 90% branch coverage on `src/services/` and `src/lib/`.
- **Integration tests**: every repository method and external API client.
- **Bug fixes**: MUST include a regression test that fails before the fix and passes after. State this explicitly in the PR.
- **New features**: MUST include happy-path, error-path, and at least one edge-case test.

### Running tests

```bash
pnpm test              # unit tests (watch mode off)
pnpm test:watch        # unit tests with watch
pnpm test:integration  # requires Docker; spins up test DB
pnpm test:coverage     # generates lcov + text summary
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint
pnpm format:check      # prettier --check
pnpm secrets:scan      # gitleaks
```

### Local quality pipeline (run before every PR)

```bash
pnpm run qa
# Runs: typecheck → lint → format:check → test → test:integration → secrets:scan
```

### CI gates on `main` (all must pass before merge)

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `pnpm test --coverage` exits 0 AND coverage delta ≥ 0%
- [ ] `pnpm test:integration` exits 0
- [ ] `pnpm audit --audit-level=high` exits 0
- [ ] `gitleaks detect` exits 0
- [ ] Docker build succeeds
- [ ] At least 1 approved review from a code owner

---

## Dependency and supply-chain policy

- **Evaluate before adding**: check npm stats, license, CVE history, and bundle size impact (`bundlephobia`).
- **License allowlist**: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC. Any other license requires legal review.
- **License denylist**: GPL, AGPL, LGPL (unless legal approves), UNLICENSED, CC-BY-NC.
- **Peer dependency pinning**: exact pin (`1.2.3`) for security-critical packages (auth, crypto, parsing). Use `^` for everything else.
- **Renovate configuration** (`renovate.json`) is the single source of update automation. Do not manually bump deps in bulk PRs.
- **Do not use `npm install` or `yarn`**. Use `pnpm` exclusively to avoid lockfile drift.
- **Remove unused dependencies** as part of any refactor touching that module.

---

## Documentation rules

- Every exported function, class, and type MUST have a JSDoc comment.
- Every HTTP endpoint MUST be documented in the OpenAPI spec (`openapi.yaml` at repo root) before or alongside its implementation PR.
- Architecture Decision Records (ADRs) live in `docs/adr/`. Use the template `docs/adr/0000-template.md`. Create an ADR for any decision that is hard to reverse or affects > 1 team.
- The `README.md` must always reflect the current "getting started in < 5 minutes" experience. Update it in the same PR that changes the dev setup.
- Do not write speculative or aspirational documentation. Document what the code does now.

---

## Git & version control strategy

**Chosen model: Trunk-Based Development with short-lived feature branches.**

Rationale: Trunk-based development (TBD) maximizes integration frequency, reduces merge conflicts, and forces continuous integration discipline. It pairs well with feature flags for incomplete work, producing faster feedback cycles than GitFlow without sacrificing release safety. Long-lived branches are the primary source of "big bang" merge pain; we eliminate them.

Key invariants:

- `main` is always deployable.
- Feature branches live for ≤ 3 days. If a branch is older, it must be integrated incrementally or the work decomposed.
- `release/*` branches are cut from `main` only when preparing a versioned release and are immediately tagged and merged back.
- `hotfix/*` branches are cut from the release tag, not from `main`, and merged into both `main` and the active release branch.

---

## Branching model

```
main ──────────────────────────────────────────────────────► (always deployable)
  │
  ├─── feature/GH-123-user-auth ──► (≤ 3 days) ──► PR ──► merge to main
  ├─── fix/GH-456-null-pointer   ──► (≤ 1 day)  ──► PR ──► merge to main
  ├─── chore/update-node-20      ──► (≤ 1 day)  ──► PR ──► merge to main
  │
  └─── release/v2.3.0  (cut from main at release time)
         └─── hotfix/GH-789-critical-crash  ──► PR ──► merge to release/v2.3.0 + main
                tag: v2.3.1
```

### Branch naming

| Prefix        | Use case                   | Example                            |
| ------------- | -------------------------- | ---------------------------------- |
| `feature/`    | New functionality          | `feature/GH-101-oauth-login`       |
| `fix/`        | Bug fix                    | `fix/GH-202-token-expiry`          |
| `chore/`      | Tooling, CI, deps, docs    | `chore/upgrade-pnpm-9`             |
| `hotfix/`     | Critical production fix    | `hotfix/GH-303-crash-on-null-user` |
| `experiment/` | Spike / throwaway research | `experiment/perf-bun-runtime`      |

Rules:

- Always include the GitHub issue number when one exists.
- Use `kebab-case` only.
- Keep names ≤ 60 characters.
- Never use personal names or dates as identifiers.

---

## Commit message convention

Format: **Conventional Commits** (https://www.conventionalcommits.org)

```
<type>(<scope>): <short description>

[optional body — explain WHY, not what]

[optional footer: BREAKING CHANGE, Closes #<issue>, Co-authored-by:]
```

### Types

| Type       | When to use                         | Version bump |
| ---------- | ----------------------------------- | ------------ |
| `feat`     | New user-facing feature             | `minor`      |
| `fix`      | Bug fix                             | `patch`      |
| `perf`     | Performance improvement             | `patch`      |
| `refactor` | Code change with no behavior change | `patch`      |
| `test`     | Adding or correcting tests          | none         |
| `docs`     | Documentation only                  | none         |
| `chore`    | Tooling, build, CI                  | none         |
| `ci`       | CI/CD pipeline changes              | none         |
| `revert`   | Reverts a previous commit           | `patch`      |

Add `!` after the type/scope for breaking changes: `feat(api)!: rename user endpoint`

### Rules

- Subject line ≤ 72 characters, imperative mood ("add", not "added" or "adds").
- No period at end of subject.
- Body wrapped at 80 characters.
- Reference issues in the footer: `Closes #123` or `Refs #456`.

### Good commit examples

```
feat(auth): add OAuth2 Google login flow

Implements the authorization code flow with PKCE.
Token refresh is handled by the existing session middleware.

Closes #101
```

```
fix(api): handle null user on /profile endpoint

The profile handler crashed when a deleted user's token was
still valid. Now returns 404 with a structured error.

Closes #202
```

```
chore(deps): upgrade pnpm to 9.4.0

Resolves a peer dependency warning introduced in Node 20.13.
No behavior change.
```

```
feat(payments)!: replace Stripe v1 with Stripe v2 API

BREAKING CHANGE: The webhook signature verification now requires
the STRIPE_WEBHOOK_SECRET env var. Update .env.example.

Migration guide: docs/migrations/stripe-v2.md
Closes #310
```

### Bad commit examples (rejected)

```
fixed stuff          ❌ — not descriptive, wrong tense
WIP                  ❌ — never commit WIP to main
Update README        ❌ — no type prefix
feat: did a lot      ❌ — too vague, likely covers multiple concerns
```

---

## Pull request workflow

1. **Open a draft PR early** (within 1 day of starting work) so others can see intent and give early feedback.
2. **Self-review your diff** before marking ready. Check: does every change have a purpose? Is there anything you would flag in someone else's PR?
3. **Fill out the PR template** completely. Do not delete sections; write "N/A" if not applicable.
4. **Link the issue**: `Closes #<n>` in the PR description or footer.
5. **Attach evidence**: test output, screenshot, benchmark result — whatever proves the change works.
6. **Mark ready for review** only when CI is green.
7. **Address all review comments** before requesting re-review. Reply to each comment; "Done" is acceptable only for trivial fixes.
8. **Squash or rebase** onto `main` before merge (no merge commits). Use squash-merge for feature branches; rebase-merge for chores/docs with clean commit histories.
9. **Delete the branch** after merge.

### When not to open a PR

- Experiments or spikes: use `experiment/` branches; they are never merged.
- Direct pushes to `main`: forbidden for all contributors including maintainers.

---

## Code review checklist

Reviewers MUST check the following before approving. Copy this into your review comment when leaving a full review.

```markdown
## Review Checklist

### Correctness

- [ ] The change solves the stated problem
- [ ] Edge cases and error paths are handled
- [ ] No obvious logic bugs or off-by-one errors

### Security

- [ ] No secrets, tokens, or PII in code or tests
- [ ] All external input is validated
- [ ] Authorization is enforced at the right layer

### Testing

- [ ] Tests exist for new code and modified paths
- [ ] Bug fixes have a regression test
- [ ] Tests are readable and test behavior, not implementation

### Quality

- [ ] TypeScript types are correct; no inappropriate `any`
- [ ] No silent catches or ignored errors
- [ ] Logging uses structured format; no PII logged
- [ ] No N+1 queries or blocking I/O in hot paths

### Maintainability

- [ ] Code is in the right layer (route/service/repo)
- [ ] Naming is clear and consistent with conventions
- [ ] No drive-by refactors unrelated to the PR's purpose
- [ ] Exported functions have JSDoc

### Documentation

- [ ] README/OpenAPI updated if behavior changed
- [ ] ADR created if this is a hard-to-reverse decision
- [ ] CHANGELOG entry added (or labels will generate it)
```

---

## Release process

### Semantic versioning rules

| Change                                  | Version bump      | Example         |
| --------------------------------------- | ----------------- | --------------- |
| Breaking public API change              | MAJOR             | `1.x.x → 2.0.0` |
| New backward-compatible feature         | MINOR             | `1.2.x → 1.3.0` |
| Bug fix, perf, refactor (no API change) | PATCH             | `1.2.3 → 1.2.4` |
| Security patch                          | PATCH (expedited) | `1.2.3 → 1.2.4` |

**What counts as a public API:** HTTP routes and their request/response shapes, exported TypeScript types from the package root, CLI commands and flags, environment variable names and semantics.

**Deprecation policy:** Before removing a public API, mark it deprecated for at least one MINOR release with a `@deprecated` JSDoc and a migration path. Breaking changes require a MAJOR bump even after the deprecation cycle.

### Release steps

```bash
# 1. Ensure main is green
git checkout main && git pull

# 2. Create release branch
git checkout -b release/v2.3.0

# 3. Bump version (updates package.json and generates CHANGELOG)
pnpm run release          # wraps `commit-and-tag-version` or `release-it`

# 4. Push and open PR for release branch
git push -u origin release/v2.3.0
# PR title: "chore(release): v2.3.0"

# 5. After CI passes and PR is approved, merge to main
# 6. Tag on main
git tag -a v2.3.0 -m "Release v2.3.0"
git push origin v2.3.0

# 7. GitHub Actions release workflow triggers:
#    - Publishes to npm (if applicable)
#    - Builds and pushes Docker image tagged v2.3.0 + latest
#    - Creates GitHub Release from CHANGELOG entry
#    - Deploys to production (if auto-deploy enabled)
```

### Changelog strategy

Using **Keep a Changelog** format (https://keepachangelog.com) with labels from PRs used to auto-populate entries.

**PR label taxonomy:**

| Label          | Changelog section   | Version bump triggered |
| -------------- | ------------------- | ---------------------- |
| `breaking`     | ⚠️ Breaking Changes | MAJOR                  |
| `feature`      | ✨ Added            | MINOR                  |
| `bug`          | 🐛 Fixed            | PATCH                  |
| `security`     | 🔒 Security         | PATCH                  |
| `performance`  | ⚡ Performance      | PATCH                  |
| `deprecated`   | 💤 Deprecated       | MINOR                  |
| `removed`      | 🗑️ Removed          | MAJOR                  |
| `docs`         | 📚 Documentation    | none                   |
| `chore`        | 🔧 Chores           | none                   |
| `dependencies` | 📦 Dependencies     | none                   |

Every PR must have at least one label from this taxonomy before merge. CI will fail without it.

### Database migrations

- Migrations live in `db/migrations/` and are run with `pnpm db:migrate`.
- Migrations MUST be backward-compatible for at least one release (expand-contract pattern):
  1. **Expand**: add new column/table (old code still works)
  2. **Migrate**: deploy new code reading the new column
  3. **Contract**: remove old column in a later release
- Never drop a column in the same release that stops writing to it.
- Migration files are named `YYYYMMDDHHMMSS_description.ts` and are immutable once merged to `main`.
- Rollback scripts are required alongside every migration.

### Config changes

- New required env vars must be added to `.env.example` with a descriptive comment in the same PR.
- Env vars must be validated at startup via the Zod config schema in `src/config/index.ts`. The app must fail fast if required vars are missing.
- Renaming an env var requires a deprecation cycle: support both old and new names for one release.

---

## Hotfix & rollback

### Hotfix flow

```bash
# 1. Identify the bad release tag
# e.g., v2.3.0 is broken in production

# 2. Cut hotfix branch from the release tag (NOT from main)
git checkout v2.3.0
git checkout -b hotfix/GH-789-crash-on-null-user

# 3. Apply the minimal fix — nothing else
# Write a failing test first, then fix

# 4. Open PR targeting main AND release/v2.3.0
# Title: "hotfix(auth): fix null user crash [GH-789]"
# Get expedited review (aim for < 2 hours)

# 5. After approval, merge to main first, then cherry-pick to release branch
git checkout main && git merge --no-ff hotfix/GH-789-crash-on-null-user
git checkout release/v2.3.0 && git cherry-pick <merge-commit-sha>

# 6. Tag the patch release
git tag -a v2.3.1 -m "Hotfix: null user crash (GH-789)"
git push origin v2.3.1

# 7. Deploy immediately via CI
```

### Rollback procedure

```bash
# Option A: Redeploy previous Docker image (preferred — fast)
# In CI/CD or deployment tool, re-trigger deployment with IMAGE_TAG=v2.2.9

# Option B: Git revert (if option A is not possible)
git revert <bad-commit-sha> --no-edit
git push origin main
# This creates a new commit; does NOT rewrite history

# NEVER: git push --force main  ← this is forbidden
```

### Incident notes

- Create a GitHub Issue titled `[INCIDENT] <date> <brief description>` within 1 hour of a production incident.
- Tag it `incident` and link to the hotfix PR.
- Add a postmortem comment within 72 hours using the template:

```
  ## Postmortem
  **Timeline:** (UTC)
  **Root cause:**
  **Impact:**
  **Mitigation applied:**
  **Preventive actions:** (link to follow-up issues)
```

---

## Agent operating procedure (Copilot)

This section governs how AI coding agents (Copilot, Claude, Cursor, etc.) MUST operate in this repository.

### Before making any change

1. **State your plan** in a short "Agent Plan" block (template below) before writing any code.
2. **Confirm scope**: identify which files will change and why.
3. **Ask first** if the change touches: auth, CI, migrations, public API contracts, security utilities, or this file.
4. **Do not assume** — if requirements are ambiguous, ask a clarifying question rather than guessing.

### Agent plan format

```
## Agent Plan

**Task:** [one sentence — what is being changed]
**Reason:** [why this change is needed, linked issue if available]
**Files changed:**
- `src/services/user-service.ts` — add null check before profile lookup
- `tests/unit/user-service.test.ts` — add regression test for GH-202

**Approach:** [2-4 sentences describing the implementation strategy]
**How tested:** [what tests will be run; what the expected output is]
**Risks / assumptions:** [anything uncertain or that requires human verification]
```

### What agents MUST do

- Follow all rules in this document exactly as a human contributor would.
- Generate tests alongside every feature or fix. Never deliver code without tests.
- Use the project's existing utilities (logger, error classes, config) — do not introduce duplicates.
- Keep diffs minimal and focused. One logical change per PR.
- Explain non-obvious decisions in commit bodies or inline comments.
- Run `pnpm run qa` (or describe which checks would be run) and report results.
- Flag security-relevant changes explicitly in the PR description.

### What agents MUST NOT do

- **Do not refactor unrelated code** while implementing a feature or fix. If you see a smell, open a separate issue.
- **Do not upgrade dependencies** unless the task explicitly requires it.
- **Do not introduce new top-level dependencies** without asking first.
- **Do not change type signatures of exported functions** without confirming it is intentional.
- **Do not delete tests**, even ones that appear redundant. Open an issue proposing removal instead.
- **Do not use `any` types** to silence TypeScript errors. Find the correct type.
- **Do not write speculative code** ("we might need this later"). Only implement what the task requires.
- **Do not add `console.log` statements** to production code. Use the structured logger.
- **Do not hallucinate APIs** — verify that a function/method exists in the codebase before calling it.
- **Do not open PRs that fail CI**. Fix all issues before considering the work done.

### Agent communication style

- Be concise and factual in PR descriptions.
- If you are uncertain about something, say so explicitly and ask.
- If a requirement conflicts with a rule in this document, surface the conflict and ask the human to resolve it.
- If asked to do something forbidden by this document, refuse, explain why, and suggest an alternative.

---

## Appendix: templates and examples

### PR description template

````markdown
## Summary

<!-- One paragraph: what changed and why. Link the issue. -->

Closes #

## Type of change

<!-- Delete rows that do not apply -->

| Type                          | Applies? |
| ----------------------------- | -------- |
| Bug fix                       | ☐        |
| New feature                   | ☐        |
| Breaking change               | ☐        |
| Refactor (no behavior change) | ☐        |
| Performance improvement       | ☐        |
| Documentation                 | ☐        |
| Dependency update             | ☐        |
| CI / tooling                  | ☐        |

## What changed

## <!-- Bullet list of concrete changes. Be specific about files and functions. -->

-

## How to test

<!-- Steps for a reviewer to verify this locally or evidence that it works. -->

1.
2.

```bash
# Command to reproduce / verify
pnpm test -- --reporter=verbose user-service
```

## Evidence

<!-- Screenshot, test output, benchmark result, or curl response. -->

## Checklist

- [ ] I have run `pnpm run qa` and all checks pass
- [ ] I have added or updated tests
- [ ] I have updated documentation (README, OpenAPI, ADR) if needed
- [ ] I have added the correct PR label(s)
- [ ] I have not committed any secrets or PII
- [ ] This PR contains no unrelated changes
````

### Example release notes format

```markdown
## [2.3.0] — 2025-08-15

### ✨ Added

- OAuth2 Google login flow with PKCE (#101) — @contributor

### 🐛 Fixed

- Handle null user on /profile endpoint (#202) — @contributor
- Prevent token reuse after logout (#215) — @contributor

### ⚡ Performance

- Replace sequential DB calls in feed loader with batched query (#198) — @contributor

### 📦 Dependencies

- Upgrade pnpm to 9.4.0 (#220)
- Bump zod from 3.22.0 to 3.23.0 (#219)

### 🔧 Chores

- Migrate CI to GitHub Actions reusable workflows (#211)

---

Full diff: https://github.com/org/repo/compare/v2.2.9...v2.3.0
```

### Example CI checklist snippet (for PR comments or status checks)

```markdown
## CI Status

| Check                       | Status                   |
| --------------------------- | ------------------------ |
| TypeScript (`tsc --noEmit`) | ✅ Pass                  |
| ESLint                      | ✅ Pass                  |
| Prettier                    | ✅ Pass                  |
| Unit tests (142/142)        | ✅ Pass                  |
| Integration tests (38/38)   | ✅ Pass                  |
| Coverage delta              | ✅ +1.2%                 |
| `pnpm audit`                | ✅ No high/critical CVEs |
| Secret scan (`gitleaks`)    | ✅ No secrets detected   |
| Docker build                | ✅ Pass                  |
| Code owners approved        | ✅ 1/1                   |
```

### Example agent plan (complete)

```
## Agent Plan

**Task:** Fix null pointer crash when fetching profile of a deleted user.
**Reason:** GH-202 — production crash reported; deleted users retain valid JWTs
  until expiry.
**Files changed:**
- `src/services/user-service.ts` — add existence check after DB lookup; throw
  `NotFoundError` if user record is null.
- `src/api/profile.ts` — confirm error is mapped to HTTP 404 (already handled
  by global error middleware; no change needed — documenting for transparency).
- `tests/unit/user-service.test.ts` — add test case: "throws NotFoundError
  when user does not exist in DB".

**Approach:** After `userRepository.findById()`, check if the result is null
before accessing properties. Throw `new NotFoundError('USER_NOT_FOUND')` which
the global handler maps to 404. This matches the pattern in `order-service.ts`.

**How tested:**
- New unit test mocks `findById` returning `null` and asserts `NotFoundError`.
- Existing tests unaffected (all return valid users).
- `pnpm test -- user-service` must show 100% pass.

**Risks / assumptions:** Assumes JWT expiry is the only path to get a token
for a deleted user. If soft-delete or anonymization exists, a separate issue
should address those cases.
```

### Example `.env.example` entry format

```bash
# Required. PostgreSQL connection string.
# Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DATABASE_URL=postgresql://postgres:changeme@localhost:5432/myapp_dev

# Required. Secret used to sign session JWTs. Minimum 32 chars.
# Generate with: openssl rand -base64 32
SESSION_SECRET=replace-with-a-real-secret-at-least-32-chars

# Optional. Set to "true" to enable verbose SQL logging. Default: false.
DB_LOG_QUERIES=false

# Optional. Sentry DSN for error tracking. Leave blank to disable.
SENTRY_DSN=
```

---

_This file is the single source of truth. If you disagree with a rule, open a PR against this file with your proposal — do not silently deviate._
