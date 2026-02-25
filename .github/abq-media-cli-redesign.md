# abq-media CLI — Surface Redesign v2

## Design Philosophy

> **"The tool should speak the language of creation, not computation."**

Users think in transformations:
- "Turn this interview into a podcast"
- "Research this topic and write me an article"
- "Give me a transcript of this video"

They don't think in pipelines, states, or checkpoints.

---

## 1. Proposed Command Surface

### Primary Command: `transform`

The main verb. Everything else supports this.

```bash
abq-media transform <source> --into <format> [--using <recipe>]
```

**Examples:**
```bash
# YouTube video → Podcast (full pipeline with research)
abq-media transform "https://youtube.com/watch?v=..." --into podcast

# Audio file → Article with NYT style
abq-media transform ./interview.mp3 --into article --using nyt-style

# Raw idea → Research report
abq-media transform "Venezuelan rare earth minerals and China trade relations" --into research

# YouTube → Just the transcript
abq-media transform "https://youtube.com/..." --into transcript

# Existing research → Podcast script
abq-media transform ./research-report.md --into podcast-script

# Quick podcast (skip research phase)
abq-media transform "https://youtube.com/..." --into podcast --using quick
```

**Source Detection (automatic):**
| Input | Detected As |
|-------|-------------|
| `https://youtube.com/...` | YouTube video |
| `https://youtu.be/...` | YouTube video |
| `./file.mp3`, `./file.wav` | Audio file |
| `./file.txt`, `./file.md` | Text document |
| `"quoted string"` | Raw idea/prompt |
| `./report.md` + `--into podcast-script` | Existing artifact |

**Output Formats (`--into`):**
| Format | Description | Final Artifact |
|--------|-------------|----------------|
| `transcript` | Raw transcription | `.txt` |
| `research` | Deep research report | `.md` |
| `podcast` | Full audio episode | `.mp3` + script |
| `podcast-script` | Script only, no TTS | `.md` |
| `article` | Styled written piece | `.md` |
| `translation` | Translated content | `.txt` |
| `video-script` | Script for video | `.md` |

---

### Supporting Commands

```
abq-media setup              # First-time configuration (API keys, defaults)
abq-media projects           # List and manage past work
abq-media recipes            # Manage transformation recipes
abq-media prompts            # Customize AI behavior per stage
abq-media continue           # Resume last interrupted transform
abq-media doctor             # Environment health check
```

**Removed/Merged:**
- `init` → merged into `setup` (one-time) and auto-created on `transform`
- `run` → replaced by `transform`
- `status` → merged into `projects`
- `browse` → merged into `projects --open`
- `retry` → simplified to `continue`
- `config` → renamed to `setup` (for API keys) and `recipes` (for workflows)
- `export` → moved to `projects export <id>`
- `reset` → moved to `setup --reset`

---

## 2. Command Details

### `abq-media transform`

The workhorse. Handles all content transformation.

```
Usage: abq-media transform <source> [options]

Arguments:
  source                    URL, file path, or quoted text

Options:
  --into <format>          Output format (required)
                           transcript | research | podcast | podcast-script |
                           article | translation | video-script
  
  --using <recipe>         Recipe name (default: auto-selected)
  --lang <code>            Target language (default: es)
  --name <string>          Project name (default: auto-generated)
  --voice <id>             ElevenLabs voice (overrides recipe)
  --style <humanizer>      Article style (overrides recipe)
  --dry-run                Show what would happen without executing
  --continue               Resume from checkpoint if exists
  --output <dir>           Output directory (default: ./abq-projects/<name>)

Examples:
  abq-media transform "https://youtube.com/..." --into podcast
  abq-media transform ./interview.mp3 --into article --using lmd-style
  abq-media transform "AI governance in Latin America" --into research
  abq-media transform ./report.md --into podcast-script --lang es
```

**Interactive Mode:**
If called without `--into`, enters guided mode:

```
$ abq-media transform "https://youtube.com/watch?v=xyz"

┌  abq-media transform
│
◆  Detected: YouTube video
│  Title: "Interview with economist about Venezuela"
│  Duration: 45:23
│
◇  What would you like to create?
│  ● Podcast episode (research + script + audio)
│  ○ Research report (deep analysis)
│  ○ Article (styled written piece)
│  ○ Just transcript (raw text)
│
◇  Select a recipe:
│  ● default (full research pipeline)
│  ○ quick (skip research, faster)
│  ○ my-custom-recipe
│
└  Starting transformation...
```

---

### `abq-media setup`

First-time configuration. Replaces `init`.

```
Usage: abq-media setup [options]

Options:
  --api         Configure API keys only
  --defaults    Set default preferences
  --reset       Remove all configuration
  --show        Display current configuration
```

**What it configures:**
1. API Keys (OpenRouter/OpenAI, ElevenLabs)
2. Default language
3. Default output directory
4. Default voice for podcasts
5. Default humanizer for articles
6. Organization info (optional, for branding)

**Stored in:** `~/.abq-media/config.json`

---

### `abq-media projects`

Manage past transformations.

```
Usage: abq-media projects [command] [options]

Commands:
  list                     Show all projects (default)
  open <id>                Interactive exploration of a project
  export <id>              Bundle artifacts into zip
  delete <id>              Remove project data
  continue <id>            Resume interrupted project

Options:
  --format <type>          Filter by output format
  --since <date>           Filter by date
  --status <state>         Filter: complete | failed | in-progress
```

**List View:**
```
$ abq-media projects

┌  Your Projects
│
│  ID          Created      Format    Status      Source
│  ─────────────────────────────────────────────────────────────
│  rare-earth  2 hours ago  podcast   complete    youtube/xyz
│  china-trade yesterday    research  complete    text
│  interview-1 3 days ago   podcast   failed      audio/interview.mp3
│  └─ Failed at: TTS_ELEVENLABS (rate limit)
│     Run: abq-media continue interview-1
│
└  3 projects (2 complete, 1 failed)
```

**Open View (interactive browser):**
```
$ abq-media projects open rare-earth

┌  Project: rare-earth
│  Created: 2 hours ago
│  Source: https://youtube.com/watch?v=xyz
│  Recipe: youtube-to-podcast (default)
│
├─ Artifacts
│  ├─ transcript.txt (14.2 KB)
│  ├─ research-prompt.md (2.1 KB)
│  ├─ research-report.md (28.4 KB)
│  ├─ podcast-script.md (8.7 KB)
│  └─ episode.mp3 (42.1 MB, 32:15)
│
├─ Actions
│  ● View artifact
│  ○ Export all (zip)
│  ○ Re-run with different recipe
│  ○ Delete project
│
└─ Select an action...
```

---

### `abq-media recipes`

Transformation recipes are **saved pipeline configurations**.

```
Usage: abq-media recipes [command] [options]

Commands:
  list                     Show all recipes
  show <name>              Display recipe details
  create <name>            Create new recipe (interactive)
  edit <name>              Modify existing recipe
  clone <source> <name>    Copy and modify a recipe
  delete <name>            Remove custom recipe
  export <name>            Export as JSON
  import <file>            Import recipe from JSON
```

**Built-in Recipes:**

| Recipe | Description | Stages |
|--------|-------------|--------|
| `default` | Full pipeline with research | transcript → research-prompt → research → script → tts |
| `quick` | Fast podcast, no research | transcript → script → tts |
| `research-only` | Deep analysis, no audio | transcript → research-prompt → research |
| `article-nyt` | NYT-style article | transcript → article (nyt humanizer) |
| `article-lmd` | Le Monde Diplomatique style | transcript → article (lmd humanizer) |
| `translate` | Spanish translation | transcript → translate |
| `raw` | Just transcription | transcript |

**Recipe Structure:**
```yaml
# ~/.abq-media/recipes/my-podcast-style.yaml
name: my-podcast-style
description: My personal podcast workflow
base: default

stages:
  transcript:
    enabled: true
  research-prompt:
    enabled: true
    prompt: $prompts/research-prompt-custom.md
  research:
    enabled: true
    model: claude-sonnet-4-20250514
    max_tokens: 8000
  script:
    enabled: true
    prompt: $prompts/podcast-script-custom.md
    format: conversational
  tts:
    enabled: true
    voice: "Antoni"
    model: "eleven_multilingual_v2"

output:
  include_intermediate: true  # Keep all artifacts
  naming: "{date}-{source-title}"
```

**Creating a Recipe:**
```
$ abq-media recipes create my-interview-style

┌  Create Recipe
│
◇  Base recipe to start from?
│  ● default (full pipeline)
│  ○ quick (no research)
│  ○ research-only
│
◇  Which stages to include?
│  ◉ Transcription
│  ◉ Research prompt generation
│  ◉ Deep research execution
│  ◉ Script generation
│  ◉ Text-to-speech
│
◇  Customize prompts?
│  ○ Use defaults
│  ● Open editor for each stage
│
│  [Opens $EDITOR with prompt templates]
│
◇  TTS Settings
│  Voice: Antoni
│  Model: eleven_multilingual_v2
│
└  Recipe saved: my-interview-style
```

---

### `abq-media prompts`

Fine-grained control over AI behavior at each stage.

```
Usage: abq-media prompts [command] [options]

Commands:
  list                     Show all prompt templates
  show <stage>             Display prompt for a stage
  edit <stage>             Edit prompt in $EDITOR
  reset <stage>            Restore default prompt
  export                   Export all prompts
  import <dir>             Import prompts from directory
```

**Stages with customizable prompts:**
| Stage | Purpose |
|-------|---------|
| `research-prompt` | How to generate the research prompt from transcript |
| `research` | System prompt for deep research |
| `script` | How to transform research into podcast script |
| `article` | How to style the article (+ humanizer) |
| `translate` | Translation instructions |
| `video-script` | Video-specific script generation |

**Editing a Prompt:**
```
$ abq-media prompts edit research-prompt

# Opens in $EDITOR:
# ─────────────────────────────────────────────────
# STAGE: research-prompt
# PURPOSE: Generate deep research prompt from transcript
# 
# AVAILABLE VARIABLES:
#   {{transcript}} - The full transcript text
#   {{metadata.title}} - Source title
#   {{metadata.duration}} - Source duration
#   {{lang}} - Target language
# ─────────────────────────────────────────────────

You are a research analyst preparing a deep investigation brief.

Given this transcript:
{{transcript}}

Generate a comprehensive research prompt that will:
1. Identify the core claims and assertions
2. List specific facts that need verification
3. Suggest related topics to explore
4. Frame questions for deeper analysis

Focus on: geopolitical implications, economic data, primary sources.
Output language: {{lang}}
```

---

### `abq-media continue`

Resume interrupted work. Simplified from `retry`.

```
Usage: abq-media continue [project-id]

Arguments:
  project-id    Project to resume (default: most recent failed)

Options:
  --from <stage>    Restart from specific stage
  --force           Ignore checkpoint, restart from beginning
```

**Example:**
```
$ abq-media continue

┌  Resume Project
│
│  Found: interview-1 (failed 3 days ago)
│  Failed at: TTS_ELEVENLABS
│  Reason: Rate limit exceeded
│
◇  How to proceed?
│  ● Retry from failure point (TTS)
│  ○ Restart from script generation
│  ○ Start over completely
│
└  Resuming from TTS_ELEVENLABS...
```

---

### `abq-media doctor`

Environment health check.

```
$ abq-media doctor

┌  Environment Check
│
│  ✓ Node.js 20.11.0
│  ✓ FFmpeg installed
│  ✓ yt-dlp installed
│
│  API Keys:
│  ✓ OpenRouter configured
│  ✓ ElevenLabs configured
│  ✗ OpenAI not configured (optional)
│
│  Storage:
│  ✓ Config: ~/.abq-media/config.json
│  ✓ Projects: ~/abq-projects/ (3 projects, 142 MB)
│  ✓ Recipes: 4 custom, 6 built-in
│
│  Network:
│  ✓ OpenRouter API reachable
│  ✓ ElevenLabs API reachable
│  ✓ YouTube accessible
│
└  All systems operational
```

---

## 3. Information Architecture

### Mental Model Alignment

```
User's World                    CLI Surface
────────────────────────────    ────────────────────────────
"I have this video"        →    abq-media transform <url>
"Make it a podcast"        →    --into podcast
"Use my style"             →    --using my-recipe
"Where's my stuff?"        →    abq-media projects
"How do I customize?"      →    abq-media recipes / prompts
"Something broke"          →    abq-media continue
"Is everything working?"   →    abq-media doctor
"First time setup"         →    abq-media setup
```

### Command Frequency (expected usage)

```
Daily Use:
  transform     ████████████████████  (primary action)
  projects      ████████              (check status)
  continue      ████                  (when things fail)

Weekly Use:
  recipes       ████                  (refine workflows)
  prompts       ██                    (tune AI behavior)

Occasional:
  setup         █                     (initial config)
  doctor        █                     (troubleshooting)
```

---

## 4. Cognitive Load Reduction

### Before (Current)

User must understand:
- What "init" creates
- What "run" does and its many branches
- Pipeline stages and states
- When to use "retry" vs "run"
- Difference between "config" and stage settings

**Commands to learn: 10**
**Concepts to understand: ~15**

### After (Proposed)

User must understand:
- `transform` turns X into Y
- Recipes customize how
- Projects store results

**Commands to learn: 6** (transform, projects, recipes, prompts, setup, doctor)
**Concepts to understand: ~5** (source, format, recipe, project, prompt)

---

## 5. Progressive Disclosure

### Level 1: Just Works
```bash
abq-media transform "https://youtube.com/..." --into podcast
```
Uses all defaults. No configuration needed beyond API keys.

### Level 2: Choose Recipe
```bash
abq-media transform "https://youtube.com/..." --into podcast --using quick
```
User discovers recipes exist, picks from built-ins.

### Level 3: Custom Recipe
```bash
abq-media recipes create my-style
abq-media transform "..." --into podcast --using my-style
```
User creates own workflow.

### Level 4: Prompt Engineering
```bash
abq-media prompts edit research
```
User fine-tunes AI behavior per stage.

---

## 6. Error Recovery Design

### Failure States → Clear Actions

| Failure | Message | Action |
|---------|---------|--------|
| API rate limit | "ElevenLabs rate limit. Wait 1 hour or use different voice." | `abq-media continue` |
| Network error | "Could not reach YouTube. Check connection." | `abq-media continue` |
| Invalid URL | "Not a valid YouTube URL. Supported: youtube.com, youtu.be" | Fix input |
| Missing API key | "ElevenLabs key not configured." | `abq-media setup --api` |
| Stage failure | "Research generation failed. Checkpoint saved." | `abq-media continue --from research` |

### Checkpoint Messaging

```
┌  Transform interrupted
│
│  ✓ Transcription complete
│  ✓ Research prompt generated
│  ✗ Research execution failed
│     Error: Context length exceeded
│
│  Checkpoint saved. To resume:
│    abq-media continue
│
│  To retry with smaller model:
│    abq-media continue --from research
│    (then edit recipe to use smaller context)
│
└
```

---

## 7. Deliverables Map

What the tool actually produces:

```
Transform Into       Primary Artifact        Supporting Artifacts
────────────────────────────────────────────────────────────────
transcript           transcript.txt          metadata.json
research             research-report.md      transcript.txt, research-prompt.md
podcast              episode.mp3             transcript.txt, research-report.md, 
                                             podcast-script.md
podcast-script       podcast-script.md       transcript.txt, research-report.md
article              article.md              transcript.txt
translation          translated.txt          transcript.txt
video-script         video-script.md         transcript.txt, research-report.md
```

All artifacts are kept in project directory:
```
~/abq-projects/
└── rare-earth-2024-02-23/
    ├── source.json           # Original input metadata
    ├── transcript.txt
    ├── research-prompt.md
    ├── research-report.md
    ├── podcast-script.md
    ├── episode.mp3
    ├── checkpoint.json       # For resume
    └── manifest.json         # Project metadata
```

---

## 8. Migration Path

From current commands to new surface:

| Current | New |
|---------|-----|
| `abq-media init` | `abq-media setup` (first time) or auto on `transform` |
| `abq-media run` | `abq-media transform` |
| `abq-media status` | `abq-media projects` |
| `abq-media browse` | `abq-media projects open <id>` |
| `abq-media retry` | `abq-media continue` |
| `abq-media prompts` | `abq-media prompts` (same) |
| `abq-media config` | `abq-media setup` (API) + `abq-media recipes` (workflows) |
| `abq-media export` | `abq-media projects export <id>` |
| `abq-media doctor` | `abq-media doctor` (same) |
| `abq-media reset` | `abq-media setup --reset` |

---

## 9. Implementation Priority

### Phase 1: Core Transform (MVP)
- [ ] `transform` command with basic flags
- [ ] Auto source detection
- [ ] Built-in recipes (default, quick, research-only)
- [ ] Project directory structure
- [ ] Basic `projects list`

### Phase 2: Recipe System
- [ ] `recipes list/show/create/edit`
- [ ] Recipe YAML format
- [ ] Recipe inheritance (base + overrides)

### Phase 3: Prompt Customization
- [ ] `prompts edit/show`
- [ ] Variable interpolation in prompts
- [ ] Per-recipe prompt overrides

### Phase 4: Polish
- [ ] `projects open` interactive browser
- [ ] `doctor` full health check
- [ ] Export/import recipes
- [ ] Tab completion

---

## 10. Command Reference Card

```
┌─────────────────────────────────────────────────────────────────────┐
│  abq-media — Content Transformation CLI                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TRANSFORM (primary action)                                         │
│  abq-media transform <source> --into <format> [--using <recipe>]    │
│                                                                     │
│  Formats: transcript | research | podcast | podcast-script |        │
│           article | translation | video-script                      │
│                                                                     │
│  MANAGE                                                             │
│  abq-media projects              List all projects                  │
│  abq-media projects open <id>    Explore project artifacts          │
│  abq-media continue [id]         Resume failed transform            │
│                                                                     │
│  CUSTOMIZE                                                          │
│  abq-media recipes               Manage transformation recipes      │
│  abq-media prompts               Edit AI prompts per stage          │
│                                                                     │
│  CONFIGURE                                                          │
│  abq-media setup                 API keys and defaults              │
│  abq-media doctor                Environment health check           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```
