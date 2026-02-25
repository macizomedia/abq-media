# abq-media CLI Redesign — Agent Implementation Prompts

## Overview

These prompts implement the redesigned CLI surface. Execute in order.

---

## PROMPT 1: Transform Command — Core Implementation

```markdown
# Task: Implement `abq-media transform` Command

## Context
Replacing the overloaded `run` command with a cleaner `transform` verb that matches 
user mental models. This is the primary command of the CLI.

## Signature
```bash
abq-media transform <source> --into <format> [--using <recipe>] [options]
```

## Requirements

### 1. Source Detection
Automatically detect source type from input:

```typescript
// commands/transform.ts
type SourceType = 'youtube' | 'audio' | 'text' | 'idea' | 'artifact';

function detectSourceType(source: string): SourceType {
  // YouTube URLs
  if (source.match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/)) {
    return 'youtube';
  }
  // Audio files
  if (source.match(/\.(mp3|wav|m4a|ogg|flac)$/i)) {
    return 'audio';
  }
  // Text/markdown files
  if (source.match(/\.(txt|md|markdown)$/i)) {
    return 'text';
  }
  // If it's a quoted string or doesn't look like a path
  if (source.startsWith('"') || !source.includes('/') && !source.includes('.')) {
    return 'idea';
  }
  // Existing artifact (for chaining)
  if (source.match(/\.(md|txt)$/i) && fs.existsSync(source)) {
    return 'artifact';
  }
  throw new Error(`Cannot determine source type for: ${source}`);
}
```

### 2. Format Validation
Valid `--into` values:
- `transcript` — Raw transcription only
- `research` — Deep research report
- `podcast` — Full audio episode (includes TTS)
- `podcast-script` — Script only, no audio
- `article` — Styled written piece
- `translation` — Translated content
- `video-script` — Video narration script

### 3. Recipe Resolution
```typescript
async function resolveRecipe(
  formatName: string,
  recipeName?: string
): Promise<Recipe> {
  // If explicit recipe given, load it
  if (recipeName) {
    return loadRecipe(recipeName);
  }
  // Otherwise use format default
  const defaults: Record<string, string> = {
    'transcript': 'raw',
    'research': 'research-only',
    'podcast': 'default',
    'podcast-script': 'research-only',
    'article': 'article-default',
    'translation': 'translate',
    'video-script': 'video-default',
  };
  return loadRecipe(defaults[formatName]);
}
```

### 4. Interactive Mode
If `--into` is not provided, prompt user:

```typescript
if (!options.into) {
  const format = await select({
    message: 'What would you like to create?',
    options: [
      { value: 'podcast', label: 'Podcast episode', hint: 'research + script + audio' },
      { value: 'research', label: 'Research report', hint: 'deep analysis' },
      { value: 'article', label: 'Article', hint: 'styled written piece' },
      { value: 'transcript', label: 'Transcript', hint: 'raw text only' },
    ],
  });
  options.into = format;
}
```

### 5. Project Creation
Each transform creates a project directory:

```typescript
function createProjectDir(source: string, format: string): string {
  const slug = generateSlug(source); // e.g., "interview-economist-venezuela"
  const date = format(new Date(), 'yyyy-MM-dd');
  const projectName = `${slug}-${date}`;
  const projectDir = path.join(getProjectsRoot(), projectName);
  
  fs.mkdirSync(projectDir, { recursive: true });
  
  // Write source metadata
  fs.writeFileSync(
    path.join(projectDir, 'source.json'),
    JSON.stringify({ source, type: detectSourceType(source), createdAt: new Date() })
  );
  
  return projectDir;
}
```

### 6. Pipeline Execution
Delegate to the existing state machine but with recipe-driven stage selection:

```typescript
async function executeTransform(
  source: string,
  format: string,
  recipe: Recipe,
  projectDir: string
): Promise<TransformResult> {
  // Build initial context from recipe
  const ctx = createContext({
    projectDir,
    source,
    targetFormat: format,
    enabledStages: recipe.stages.filter(s => s.enabled).map(s => s.name),
    stageConfigs: recipe.stages,
  });
  
  // Run the pipeline
  const runner = new PipelineRunner(ctx);
  return runner.run();
}
```

### 7. Command Options
```typescript
export const transformCommand = new Command('transform')
  .description('Transform content into podcasts, articles, and more')
  .argument('<source>', 'URL, file path, or quoted text')
  .option('--into <format>', 'Output format')
  .option('--using <recipe>', 'Recipe name')
  .option('--lang <code>', 'Target language', 'es')
  .option('--name <string>', 'Project name (auto-generated if omitted)')
  .option('--voice <id>', 'ElevenLabs voice ID (overrides recipe)')
  .option('--style <humanizer>', 'Article humanizer (overrides recipe)')
  .option('--dry-run', 'Show plan without executing')
  .option('--output <dir>', 'Output directory')
  .action(async (source, options) => {
    // Implementation
  });
```

## Output
The command should:
1. Display detected source type
2. Show selected recipe and stages
3. Execute pipeline with progress indicators
4. Display final artifacts with paths
5. Save checkpoint on interruption

## Example Session
```
$ abq-media transform "https://youtube.com/watch?v=xyz" --into podcast

┌  abq-media transform
│
│  Source: YouTube video
│  Title: "Interview with economist about Venezuela"
│  Duration: 45:23
│
│  Format: podcast
│  Recipe: default
│
├─ Pipeline
│  ◆ Transcription ✓ (2:34)
│  ◆ Research prompt ✓ (0:12)
│  ◇ Research execution... (running)
│  ○ Script generation (pending)
│  ○ Text-to-speech (pending)
│
│  [Progress: 45%]
```
```

---

## PROMPT 2: Recipe System

```markdown
# Task: Implement Recipe System

## Context
Recipes are saved pipeline configurations. They define which stages run and how 
each stage is configured (prompts, models, output settings).

## File Format
Recipes are stored as YAML in `~/.abq-media/recipes/`:

```yaml
# ~/.abq-media/recipes/my-podcast-style.yaml
name: my-podcast-style
description: My personal podcast workflow with custom research depth
version: 1
base: default  # Optional: inherit from another recipe

stages:
  - name: transcript
    enabled: true
    
  - name: research-prompt
    enabled: true
    prompt: custom  # Use custom prompt from prompts/research-prompt.md
    
  - name: research
    enabled: true
    model: claude-sonnet-4-20250514
    max_tokens: 8000
    temperature: 0.7
    
  - name: script
    enabled: true
    format: conversational  # conversational | monologue | interview
    sections:
      - hook
      - context
      - deep-dive
      - takeaways
      
  - name: tts
    enabled: true
    provider: elevenlabs
    voice: Antoni
    model: eleven_multilingual_v2
    stability: 0.7
    similarity_boost: 0.8

output:
  keep_intermediate: true
  naming_template: "{date}-{title}"
```

## Built-in Recipes
Create these as defaults in `src/recipes/builtin/`:

### default.yaml
```yaml
name: default
description: Full pipeline with research
stages:
  - { name: transcript, enabled: true }
  - { name: research-prompt, enabled: true }
  - { name: research, enabled: true, max_tokens: 6000 }
  - { name: script, enabled: true }
  - { name: tts, enabled: true }
```

### quick.yaml
```yaml
name: quick
description: Fast podcast, skip research
stages:
  - { name: transcript, enabled: true }
  - { name: research-prompt, enabled: false }
  - { name: research, enabled: false }
  - { name: script, enabled: true }
  - { name: tts, enabled: true }
```

### research-only.yaml
```yaml
name: research-only
description: Deep research without audio output
stages:
  - { name: transcript, enabled: true }
  - { name: research-prompt, enabled: true }
  - { name: research, enabled: true, max_tokens: 10000 }
  - { name: script, enabled: false }
  - { name: tts, enabled: false }
```

### article-nyt.yaml
```yaml
name: article-nyt
description: NYT-style article
stages:
  - { name: transcript, enabled: true }
  - { name: article, enabled: true, humanizer: nyt }
```

## Recipe Loader
```typescript
// recipes/loader.ts
import { parse } from 'yaml';
import { Recipe, RecipeSchema } from './types';

const BUILTIN_DIR = path.join(__dirname, 'builtin');
const USER_DIR = path.join(os.homedir(), '.abq-media', 'recipes');

export async function loadRecipe(name: string): Promise<Recipe> {
  // Check user recipes first
  const userPath = path.join(USER_DIR, `${name}.yaml`);
  if (fs.existsSync(userPath)) {
    return parseRecipeFile(userPath);
  }
  
  // Fall back to builtin
  const builtinPath = path.join(BUILTIN_DIR, `${name}.yaml`);
  if (fs.existsSync(builtinPath)) {
    return parseRecipeFile(builtinPath);
  }
  
  throw new Error(`Recipe not found: ${name}`);
}

export async function parseRecipeFile(filepath: string): Promise<Recipe> {
  const content = await fs.readFile(filepath, 'utf-8');
  const raw = parse(content);
  
  // Handle inheritance
  if (raw.base) {
    const base = await loadRecipe(raw.base);
    return mergeRecipes(base, raw);
  }
  
  return RecipeSchema.parse(raw);
}

function mergeRecipes(base: Recipe, override: Partial<Recipe>): Recipe {
  // Deep merge stages, override wins
  const stages = base.stages.map(baseStage => {
    const overrideStage = override.stages?.find(s => s.name === baseStage.name);
    return overrideStage ? { ...baseStage, ...overrideStage } : baseStage;
  });
  
  return {
    ...base,
    ...override,
    stages,
  };
}
```

## Commands

### `abq-media recipes list`
```
$ abq-media recipes

┌  Recipes
│
│  Built-in:
│  ─────────────────────────────────────────
│  default          Full pipeline with research
│  quick            Fast podcast, skip research
│  research-only    Deep research without audio
│  article-nyt      NYT-style article
│  article-lmd      Le Monde Diplomatique style
│  translate        Spanish translation
│  raw              Just transcription
│
│  Custom:
│  ─────────────────────────────────────────
│  my-podcast       My personal podcast workflow
│  interview-style  For interview transcripts
│
└  7 built-in, 2 custom recipes
```

### `abq-media recipes create`
Interactive recipe builder:

```typescript
export async function createRecipe() {
  const name = await text({
    message: 'Recipe name:',
    validate: (v) => v.match(/^[a-z0-9-]+$/) ? undefined : 'Use lowercase, numbers, hyphens only'
  });
  
  const base = await select({
    message: 'Start from:',
    options: [
      { value: 'default', label: 'Full pipeline (default)' },
      { value: 'quick', label: 'Quick (no research)' },
      { value: 'scratch', label: 'Blank recipe' },
    ],
  });
  
  const stages = await multiselect({
    message: 'Enable stages:',
    options: [
      { value: 'transcript', label: 'Transcription', selected: true },
      { value: 'research-prompt', label: 'Research prompt' },
      { value: 'research', label: 'Research execution' },
      { value: 'script', label: 'Script generation' },
      { value: 'tts', label: 'Text-to-speech' },
      { value: 'article', label: 'Article generation' },
    ],
  });
  
  // Save recipe
  const recipe = buildRecipe(name, base, stages);
  await saveRecipe(recipe);
  
  log.success(`Recipe saved: ${name}`);
  log.info(`Edit prompts: abq-media prompts edit ${name}`);
}
```

### `abq-media recipes edit <name>`
Opens recipe in $EDITOR, validates on save.
```

---

## PROMPT 3: Projects Command

```markdown
# Task: Implement `abq-media projects` Command

## Context
Projects are past transformations. Users need to list, explore, resume, and export them.

## Project Structure
Each project lives in `~/abq-projects/<project-name>/`:

```
my-project-2024-02-23/
├── source.json           # Original input metadata
├── manifest.json         # Project metadata + status
├── checkpoint.json       # For resumption
├── transcript.txt        # Stage outputs
├── research-prompt.md
├── research-report.md
├── podcast-script.md
└── episode.mp3
```

### manifest.json
```json
{
  "id": "my-project-2024-02-23",
  "name": "Interview with economist",
  "createdAt": "2024-02-23T10:30:00Z",
  "updatedAt": "2024-02-23T11:15:00Z",
  "source": {
    "type": "youtube",
    "url": "https://youtube.com/watch?v=xyz",
    "title": "Interview with economist about Venezuela"
  },
  "recipe": "default",
  "targetFormat": "podcast",
  "status": "complete",
  "failedAt": null,
  "failureReason": null,
  "artifacts": [
    { "name": "transcript.txt", "stage": "transcript", "size": 14200 },
    { "name": "research-prompt.md", "stage": "research-prompt", "size": 2100 },
    { "name": "research-report.md", "stage": "research", "size": 28400 },
    { "name": "podcast-script.md", "stage": "script", "size": 8700 },
    { "name": "episode.mp3", "stage": "tts", "size": 44100000 }
  ],
  "duration": {
    "total": "42:15",
    "stages": {
      "transcript": 154,
      "research-prompt": 12,
      "research": 89,
      "script": 45,
      "tts": 180
    }
  }
}
```

## Commands

### `abq-media projects` (list)
```typescript
export async function listProjects(options: ListOptions) {
  const projects = await scanProjects();
  
  // Apply filters
  let filtered = projects;
  if (options.status) {
    filtered = filtered.filter(p => p.status === options.status);
  }
  if (options.format) {
    filtered = filtered.filter(p => p.targetFormat === options.format);
  }
  if (options.since) {
    filtered = filtered.filter(p => new Date(p.createdAt) >= options.since);
  }
  
  // Display
  intro('Your Projects');
  
  for (const project of filtered) {
    const statusIcon = {
      complete: '✓',
      failed: '✗',
      'in-progress': '◇',
    }[project.status];
    
    log.message(`${statusIcon} ${project.id}`);
    log.message(`  ${project.source.title || project.source.url}`);
    log.message(`  ${project.targetFormat} · ${project.status} · ${timeAgo(project.createdAt)}`);
    
    if (project.status === 'failed') {
      log.warning(`  Failed at: ${project.failedAt}`);
      log.info(`  Resume: abq-media continue ${project.id}`);
    }
  }
  
  outro(`${filtered.length} projects`);
}
```

### `abq-media projects open <id>`
Interactive browser for exploring artifacts:

```typescript
export async function openProject(projectId: string) {
  const project = await loadProject(projectId);
  
  intro(`Project: ${project.id}`);
  
  log.message(`Created: ${format(project.createdAt, 'PPpp')}`);
  log.message(`Source: ${project.source.url || project.source.path}`);
  log.message(`Recipe: ${project.recipe}`);
  log.message(`Status: ${project.status}`);
  
  // List artifacts
  log.message('');
  log.message('Artifacts:');
  for (const artifact of project.artifacts) {
    log.message(`  ${artifact.name} (${formatBytes(artifact.size)})`);
  }
  
  // Action menu
  const action = await select({
    message: 'Action:',
    options: [
      { value: 'view', label: 'View artifact' },
      { value: 'export', label: 'Export all (zip)' },
      { value: 'rerun', label: 'Re-run with different recipe' },
      { value: 'delete', label: 'Delete project' },
      { value: 'back', label: 'Back to list' },
    ],
  });
  
  switch (action) {
    case 'view':
      await viewArtifact(project);
      break;
    case 'export':
      await exportProject(project);
      break;
    case 'rerun':
      await rerunProject(project);
      break;
    case 'delete':
      await deleteProject(project);
      break;
  }
}
```

### `abq-media projects export <id>`
Bundle project into zip:

```typescript
export async function exportProject(projectId: string, outputPath?: string) {
  const project = await loadProject(projectId);
  const zipPath = outputPath || `${project.id}.zip`;
  
  const s = spinner();
  s.start('Creating export bundle...');
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = fs.createWriteStream(zipPath);
  
  archive.pipe(output);
  
  // Add all artifacts
  for (const artifact of project.artifacts) {
    const filepath = path.join(project.dir, artifact.name);
    archive.file(filepath, { name: artifact.name });
  }
  
  // Add manifest
  archive.append(JSON.stringify(project, null, 2), { name: 'manifest.json' });
  
  await archive.finalize();
  
  s.stop(`Exported to: ${zipPath}`);
}
```

### `abq-media projects continue <id>`
Resume from checkpoint:

```typescript
export async function continueProject(projectId?: string, options?: ContinueOptions) {
  // Find project to resume
  let project: Project;
  if (projectId) {
    project = await loadProject(projectId);
  } else {
    // Find most recent failed project
    const projects = await scanProjects();
    const failed = projects.filter(p => p.status === 'failed');
    if (failed.length === 0) {
      log.warning('No failed projects to resume.');
      return;
    }
    project = failed.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )[0];
  }
  
  intro('Resume Project');
  
  log.message(`Project: ${project.id}`);
  log.message(`Failed at: ${project.failedAt}`);
  log.message(`Reason: ${project.failureReason}`);
  
  const action = await select({
    message: 'How to proceed?',
    options: [
      { value: 'retry', label: `Retry from ${project.failedAt}` },
      { value: 'from', label: 'Choose stage to restart from' },
      { value: 'restart', label: 'Start over completely' },
    ],
  });
  
  // Load checkpoint and resume
  const checkpoint = await loadCheckpoint(project.dir);
  
  if (action === 'from') {
    const stage = await select({
      message: 'Restart from:',
      options: checkpoint.completedStages.map(s => ({
        value: s, label: s
      })),
    });
    checkpoint.currentStage = stage;
  } else if (action === 'restart') {
    // Clear checkpoint
    checkpoint.currentStage = 'transcript';
    checkpoint.completedStages = [];
  }
  
  // Resume pipeline
  const runner = new PipelineRunner(checkpoint.context);
  await runner.run();
}
```
```

---

## PROMPT 4: Setup Command (Replacing Init + Config)

```markdown
# Task: Implement `abq-media setup` Command

## Context
Consolidates API configuration, defaults, and first-time setup into one command.
Replaces both `init` and `config`.

## What It Configures

### API Keys (required)
- OpenRouter API key (or OpenAI)
- ElevenLabs API key

### Defaults (optional)
- Default language (es, en, etc.)
- Default recipe
- Default output directory
- Default voice for TTS
- Default humanizer for articles

### Organization (optional)
- Organization name (for branding)
- Social media handles (for kit generation)

## Config Storage
`~/.abq-media/config.json`:

```json
{
  "version": 1,
  "api": {
    "llm": {
      "provider": "openrouter",
      "apiKey": "sk-or-...",
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "tts": {
      "provider": "elevenlabs",
      "apiKey": "..."
    }
  },
  "defaults": {
    "language": "es",
    "recipe": "default",
    "outputDir": "~/abq-projects",
    "voice": "Antoni",
    "humanizer": "abquanta"
  },
  "organization": {
    "name": "Abquanta",
    "handles": {
      "youtube": "@abquanta",
      "instagram": "@abquanta",
      "twitter": "@abquanta"
    }
  }
}
```

## Implementation

### First-time Setup (no existing config)
```typescript
export async function setup(options: SetupOptions) {
  const configPath = getConfigPath();
  const exists = fs.existsSync(configPath);
  
  if (!exists || options.reset) {
    await runFullSetup();
  } else if (options.api) {
    await configureApiKeys();
  } else if (options.defaults) {
    await configureDefaults();
  } else if (options.show) {
    displayConfig();
  } else {
    // Show menu
    const action = await select({
      message: 'What would you like to configure?',
      options: [
        { value: 'api', label: 'API keys' },
        { value: 'defaults', label: 'Default settings' },
        { value: 'org', label: 'Organization info' },
        { value: 'show', label: 'View current config' },
        { value: 'reset', label: 'Reset everything' },
      ],
    });
    // Handle action...
  }
}

async function runFullSetup() {
  intro('Welcome to abq-media');
  
  log.message('Let\'s configure your environment.');
  
  // LLM Provider
  const llmProvider = await select({
    message: 'LLM provider:',
    options: [
      { value: 'openrouter', label: 'OpenRouter (recommended)', hint: 'Access multiple models' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
    ],
  });
  
  const llmKey = await password({
    message: `${llmProvider} API key:`,
    validate: (v) => v.length > 10 ? undefined : 'Invalid key format',
  });
  
  // Validate key
  const s = spinner();
  s.start('Validating API key...');
  const valid = await validateLLMKey(llmProvider, llmKey);
  if (!valid) {
    s.stop('Invalid API key');
    return;
  }
  s.stop('API key validated');
  
  // ElevenLabs
  const ttsKey = await password({
    message: 'ElevenLabs API key:',
  });
  
  s.start('Validating ElevenLabs key...');
  const ttsValid = await validateElevenLabsKey(ttsKey);
  s.stop(ttsValid ? 'ElevenLabs validated' : 'Invalid (TTS will be unavailable)');
  
  // Defaults
  const language = await select({
    message: 'Default language:',
    options: [
      { value: 'es', label: 'Spanish' },
      { value: 'en', label: 'English' },
      { value: 'pt', label: 'Portuguese' },
    ],
  });
  
  // Save config
  const config = {
    version: 1,
    api: {
      llm: { provider: llmProvider, apiKey: llmKey },
      tts: { provider: 'elevenlabs', apiKey: ttsKey },
    },
    defaults: { language },
  };
  
  await saveConfig(config);
  
  outro('Setup complete! Run: abq-media transform <source> --into <format>');
}
```

### `abq-media setup --show`
```
$ abq-media setup --show

┌  Configuration
│
│  API Keys:
│  LLM: openrouter (configured) ✓
│  TTS: elevenlabs (configured) ✓
│
│  Defaults:
│  Language: es
│  Recipe: default
│  Output: ~/abq-projects
│  Voice: Antoni
│
│  Organization:
│  Name: Abquanta
│  YouTube: @abquanta
│
└  Config file: ~/.abq-media/config.json
```

### `abq-media setup --reset`
Confirm and delete all configuration.
```

---

## PROMPT 5: Prompts Command (AI Customization)

```markdown
# Task: Implement `abq-media prompts` Command

## Context
Users customize AI behavior by editing prompt templates for each stage.
Prompts are stored in `~/.abq-media/prompts/`.

## Prompt Stages

| Stage | File | Purpose |
|-------|------|---------|
| research-prompt | research-prompt.md | Generate research questions from transcript |
| research | research.md | System prompt for deep research |
| script | script.md | Transform research into podcast script |
| article | article.md | Generate styled article |
| translate | translate.md | Translation instructions |
| video-script | video-script.md | Video narration script |

## Default Prompts
Ship defaults in `src/prompts/defaults/`:

```markdown
<!-- research-prompt.md -->
# Research Prompt Generator

Given this transcript, generate a comprehensive research prompt.

## Transcript
{{transcript}}

## Instructions
1. Identify the 3-5 core claims or assertions
2. List specific facts that need verification
3. Suggest 2-3 related topics to explore
4. Frame 5 questions for deeper analysis

Focus on: factual accuracy, geopolitical context, primary sources.
Output language: {{lang}}
```

## Variable Interpolation
Prompts support variables:
- `{{transcript}}` — Full transcript text
- `{{research}}` — Research report (if available)
- `{{metadata.title}}` — Source title
- `{{metadata.duration}}` — Source duration
- `{{lang}}` — Target language
- `{{config.organization.name}}` — Org name from config

## Implementation

### `abq-media prompts list`
```typescript
export async function listPrompts() {
  const stages = ['research-prompt', 'research', 'script', 'article', 'translate', 'video-script'];
  
  intro('Prompt Templates');
  
  for (const stage of stages) {
    const isCustom = await hasCustomPrompt(stage);
    const icon = isCustom ? '✎' : '○';
    const label = isCustom ? '(custom)' : '(default)';
    log.message(`${icon} ${stage} ${label}`);
  }
  
  outro('Edit: abq-media prompts edit <stage>');
}
```

### `abq-media prompts show <stage>`
Display the current prompt (custom or default).

### `abq-media prompts edit <stage>`
```typescript
export async function editPrompt(stage: string) {
  const promptPath = getPromptPath(stage);
  
  // Copy default if no custom exists
  if (!fs.existsSync(promptPath)) {
    const defaultPath = getDefaultPromptPath(stage);
    await fs.copyFile(defaultPath, promptPath);
  }
  
  // Add header comment
  const header = `
# ─────────────────────────────────────────────────────────────
# STAGE: ${stage}
# 
# Available variables:
#   {{transcript}}     - Full transcript text
#   {{research}}       - Research report (if available)
#   {{metadata.title}} - Source title
#   {{lang}}           - Target language
#
# Save and close to apply changes.
# ─────────────────────────────────────────────────────────────

`;
  
  // Open in editor
  const editor = process.env.EDITOR || 'nano';
  spawn(editor, [promptPath], { stdio: 'inherit' });
  
  log.success(`Prompt saved: ${promptPath}`);
}
```

### `abq-media prompts reset <stage>`
Restore default prompt for a stage.

### Per-Recipe Prompts
Recipes can override prompts:

```yaml
# In recipe file
stages:
  - name: research-prompt
    prompt: my-research-prompt  # Uses ~/.abq-media/prompts/my-research-prompt.md
```

This allows different recipes to use different prompts for the same stage.
```

---

## PROMPT 6: Command Registration & Help

```markdown
# Task: Wire Up Command Registration

## Context
All commands are implemented. Now register them in the main CLI entry point.

## Implementation

```typescript
// src/index.ts
import { Command } from 'commander';
import { transformCommand } from './commands/transform';
import { projectsCommand } from './commands/projects';
import { recipesCommand } from './commands/recipes';
import { promptsCommand } from './commands/prompts';
import { setupCommand } from './commands/setup';
import { doctorCommand } from './commands/doctor';
import { continueCommand } from './commands/continue';

const program = new Command();

program
  .name('abq-media')
  .description('Transform content into podcasts, articles, and more')
  .version('0.2.0');

// Primary command
program.addCommand(transformCommand);

// Supporting commands
program.addCommand(projectsCommand);
program.addCommand(recipesCommand);
program.addCommand(promptsCommand);
program.addCommand(continueCommand);

// Configuration
program.addCommand(setupCommand);
program.addCommand(doctorCommand);

// Default action (no command) - show help with examples
program.action(() => {
  program.help();
  console.log(`
Examples:
  $ abq-media transform "https://youtube.com/..." --into podcast
  $ abq-media transform ./interview.mp3 --into article
  $ abq-media projects
  $ abq-media continue

Quick start:
  $ abq-media setup
  $ abq-media transform "https://youtube.com/..." --into podcast
`);
});

program.parse();
```

## Help Text
Each command should have clear, example-rich help:

```
$ abq-media transform --help

Usage: abq-media transform <source> [options]

Transform content into podcasts, articles, and more.

Arguments:
  source                    URL, file path, or quoted text

Options:
  --into <format>          Output format (required)
                           transcript | research | podcast | podcast-script |
                           article | translation | video-script
  --using <recipe>         Recipe name (default: auto-selected)
  --lang <code>            Target language (default: es)
  --name <string>          Project name (auto-generated if omitted)
  --dry-run                Show plan without executing
  -h, --help               Show this help

Examples:
  # YouTube video to podcast
  $ abq-media transform "https://youtube.com/watch?v=xyz" --into podcast

  # Audio file to article with custom style
  $ abq-media transform ./interview.mp3 --into article --using nyt-style

  # Raw idea to research report
  $ abq-media transform "AI governance in Latin America" --into research

  # Quick podcast (skip research)
  $ abq-media transform "https://youtube.com/..." --into podcast --using quick
```
```

---

## Summary: Implementation Order

| Order | Prompt | Command | Effort |
|-------|--------|---------|--------|
| 1 | Setup | `setup` | 2h |
| 2 | Transform | `transform` | 4h |
| 3 | Recipes | `recipes` | 3h |
| 4 | Projects | `projects` | 3h |
| 5 | Prompts | `prompts` | 2h |
| 6 | Registration | CLI wiring | 1h |

**Total: ~15 hours**

Start with `setup` because `transform` depends on config existing.
Then `transform` as the core action.
Then `recipes` and `projects` to support it.
Finally `prompts` for power users.
