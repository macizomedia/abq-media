# abq-media-workspace — Extended Architecture & Agent Prompts

## Vision Summary

**Configure once, transform anything.**

```
Input (video, audio, text)
    ↓
Processing Layer (deep research → fact-check → script generation)
    ↓
Output (video, audio, text)
    ↓
Buffer → Scheduled Publish
```

This document extends the base README into a complete modular system covering: content transformation, style/voice configuration, multi-format output, and scheduled distribution.

---

## 1. Domain Model — The Content Graph

Every piece of content flows through this unified model:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SOURCE LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│  YouTube URL │ Audio File │ PDF/Doc │ RSS Feed │ Manual Text        │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      EXTRACTION LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│  @abquanta/adapter-youtube     → metadata + captions                │
│  @abquanta/adapter-transcript  → ASR fallback                       │
│  @abquanta/adapter-document    → PDF/DOCX parsing                   │
│  @abquanta/adapter-audio       → Whisper transcription              │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     PROCESSING LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│  @abquanta/processor-digest      → talking points extraction        │
│  @abquanta/processor-research    → deep research prompt generation  │
│  @abquanta/processor-factcheck   → claim verification pipeline      │
│  @abquanta/processor-script      → output script generation         │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       OUTPUT LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│  @abquanta/output-podcast   → TTS + audio mixing                    │
│  @abquanta/output-article   → styled markdown/HTML                  │
│  @abquanta/output-video     → visual composition engine             │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    DISTRIBUTION LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│  @abquanta/channel-youtube      │  @abquanta/channel-instagram      │
│  @abquanta/channel-substack     │  @abquanta/channel-soundcloud     │
│  @abquanta/scheduler-buffer     → calendar-aware queue              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Configuration Schema — `abq.config.ts`

The "configure once" principle lives here:

```typescript
// abq.config.ts — root configuration
import { defineConfig } from '@abquanta/abq-media-core';

export default defineConfig({
  // ═══════════════════════════════════════════════════════════
  // ORGANIZATION IDENTITY
  // ═══════════════════════════════════════════════════════════
  org: {
    name: 'Abquanta',
    lang: 'es',
    timezone: 'Europe/Berlin',
  },

  // ═══════════════════════════════════════════════════════════
  // PODCAST CONFIGURATION
  // ═══════════════════════════════════════════════════════════
  podcast: {
    style: 'conversational' | 'monologue' | 'interview' | 'documentary',
    format: {
      intro: { duration: 15, music: 'assets/intro.mp3' },
      outro: { duration: 10, music: 'assets/outro.mp3' },
      segments: ['hook', 'context', 'deep-dive', 'takeaways', 'cta'],
    },
    voices: {
      host: {
        provider: 'elevenlabs' | 'openai' | 'google',
        voiceId: 'voice-id-here',
        settings: { stability: 0.7, similarity: 0.8 },
      },
      cohost: { /* optional second voice */ },
    },
    outputFormat: 'mp3',
    bitrate: 192,
  },

  // ═══════════════════════════════════════════════════════════
  // ARTICLE CONFIGURATION
  // ═══════════════════════════════════════════════════════════
  article: {
    tone: 'analytical' | 'narrative' | 'investigative' | 'explainer',
    format: 'long-form' | 'brief' | 'thread' | 'newsletter',
    humanizer: {
      preset: 'nyt' | 'lmd' | 'economist' | 'wired' | 'custom',
      // Custom humanizer definition
      custom: {
        name: 'abquanta-voice',
        traits: [
          'Direct opening without preamble',
          'Technical precision with accessible metaphors',
          'Venezuelan cultural references when relevant',
          'Skeptical of narratives, anchored in data',
          'Concludes with actionable insight, not summary',
        ],
        avoidPatterns: [
          'In this article we will...',
          'As we can see...',
          'In conclusion...',
        ],
        sentenceStructure: 'varied-length',
        paragraphDensity: 'medium',
      },
    },
    metadata: {
      generateSEO: true,
      generateOG: true,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // VIDEO CONFIGURATION
  // ═══════════════════════════════════════════════════════════
  video: {
    style: 'talking-head' | 'b-roll-narration' | 'animated-explainer' | 'documentary',
    format: {
      aspectRatio: '16:9' | '9:16' | '1:1',
      duration: { min: 60, max: 600 }, // seconds
      resolution: '1080p' | '4k',
    },
    composition: {
      intro: { template: 'templates/video-intro.json', duration: 5 },
      outro: { template: 'templates/video-outro.json', duration: 8 },
      transitions: 'cut' | 'fade' | 'wipe',
      lowerThirds: true,
      subtitles: { style: 'burnt-in', lang: ['es', 'en'] },
    },
    assets: {
      stockProvider: 'pexels' | 'unsplash' | 'storyblocks',
      musicLibrary: 'epidemic-sound' | 'artlist' | 'local',
      voiceover: '$ref:podcast.voices.host',
    },
    render: {
      engine: 'remotion' | 'ffmpeg' | 'shotstack',
      outputFormat: 'mp4',
      codec: 'h264',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // CHANNEL DISTRIBUTION
  // ═══════════════════════════════════════════════════════════
  channels: {
    youtube: {
      enabled: true,
      credentials: '$env:YOUTUBE_OAUTH',
      defaults: {
        visibility: 'public',
        category: 'Education',
        tags: ['venezuela', 'tech', 'abquanta'],
      },
    },
    instagram: {
      enabled: true,
      credentials: '$env:INSTAGRAM_TOKEN',
      formats: ['reels', 'stories', 'carousel'],
    },
    substack: {
      enabled: true,
      credentials: '$env:SUBSTACK_TOKEN',
      publication: 'abquanta',
    },
    soundcloud: {
      enabled: true,
      credentials: '$env:SOUNDCLOUD_TOKEN',
      playlist: 'abquanta-podcast',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // SCHEDULER / BUFFER
  // ═══════════════════════════════════════════════════════════
  scheduler: {
    provider: 'internal' | 'buffer' | 'asana' | 'notion',
    calendar: {
      // Optimal posting windows per channel
      youtube: { days: ['tue', 'thu'], time: '14:00' },
      instagram: { days: ['mon', 'wed', 'fri'], time: '18:00' },
      substack: { days: ['sun'], time: '09:00' },
      soundcloud: { days: ['tue'], time: '06:00' },
    },
    queue: {
      maxPending: 20,
      autoPublish: false, // require manual approval
      notifyOn: ['scheduled', 'published', 'failed'],
    },
  },

  // ═══════════════════════════════════════════════════════════
  // PROCESSING DEFAULTS
  // ═══════════════════════════════════════════════════════════
  processing: {
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      fallback: 'openai:gpt-4o',
    },
    factCheck: {
      enabled: true,
      sources: ['wikipedia', 'reuters', 'ap'],
      threshold: 0.8, // confidence threshold
    },
    research: {
      depth: 'standard' | 'deep' | 'exhaustive',
      maxSources: 10,
    },
  },
});
```

---

## 3. Extended Monorepo Structure

```
abq-media-workspace/
├── packages/
│   ├── core/
│   │   └── @abquanta/abq-media-core        # Domain models, contracts, config loader
│   │
│   ├── adapters/
│   │   ├── @abquanta/adapter-youtube       # URL → metadata + captions
│   │   ├── @abquanta/adapter-transcript    # ASR abstraction (Whisper, AssemblyAI)
│   │   ├── @abquanta/adapter-document      # PDF/DOCX/TXT extraction
│   │   └── @abquanta/adapter-audio         # Audio file → transcript
│   │
│   ├── processors/
│   │   ├── @abquanta/processor-digest      # Content → talking points
│   │   ├── @abquanta/processor-research    # Digest → deep research prompt
│   │   ├── @abquanta/processor-factcheck   # Claims verification
│   │   └── @abquanta/processor-script      # Research → output script
│   │
│   ├── outputs/
│   │   ├── @abquanta/output-podcast        # Script → TTS → mixed audio
│   │   ├── @abquanta/output-article        # Script → styled text
│   │   └── @abquanta/output-video          # Script → visual composition
│   │
│   ├── channels/
│   │   ├── @abquanta/channel-youtube       # Upload + metadata
│   │   ├── @abquanta/channel-instagram     # Reels/Stories/Carousel
│   │   ├── @abquanta/channel-substack      # Newsletter publishing
│   │   └── @abquanta/channel-soundcloud    # Podcast hosting
│   │
│   ├── scheduler/
│   │   └── @abquanta/scheduler-buffer      # Queue + calendar management
│   │
│   ├── cli/
│   │   └── @abquanta/abq-media-cli         # Main CLI interface
│   │
│   └── pipelines/
│       └── @abquanta/pipeline-youtube-research-podcast
│
├── templates/
│   ├── video-intro.json
│   ├── video-outro.json
│   └── humanizers/
│       ├── nyt.json
│       ├── lmd.json
│       └── economist.json
│
├── abq.config.ts
├── package.json
├── turbo.json
└── README.md
```

---

## 4. CLI Interface — Extended Commands

```bash
# ═══════════════════════════════════════════════════════════════════
# PREP STAGE — Extract and process source content
# ═══════════════════════════════════════════════════════════════════
abq-media prep --url "https://youtube.com/..." --lang es
abq-media prep --file "./interview.mp3" --lang es
abq-media prep --doc "./report.pdf" --lang es

# ═══════════════════════════════════════════════════════════════════
# OUTPUT STAGE — Generate specific format
# ═══════════════════════════════════════════════════════════════════

# Podcast
abq-media podcast --input digest.json --style conversational --voices host,cohost
abq-media podcast --input digest.json --publish soundcloud

# Article
abq-media article --input research.md --tone analytical --humanizer nyt
abq-media article --input research.md --format thread --publish substack

# Video
abq-media video --input script.md --style b-roll-narration --aspect 16:9
abq-media video --audio episode.mp3 --style talking-head --publish youtube

# ═══════════════════════════════════════════════════════════════════
# SCHEDULING
# ═══════════════════════════════════════════════════════════════════
abq-media schedule --content ./outputs/episode-01/ --channel youtube --date "2025-03-01T14:00"
abq-media schedule --list
abq-media schedule --approve ep-001

# ═══════════════════════════════════════════════════════════════════
# FULL PIPELINE
# ═══════════════════════════════════════════════════════════════════
abq-media run youtube-research-podcast --url "https://youtube.com/..." --lang es --publish soundcloud
abq-media run url-to-thread --url "https://..." --humanizer abquanta-voice --publish substack
```

---

## 5. Video Engine — Detailed Architecture

The video module deserves extra attention given its complexity:

```
┌─────────────────────────────────────────────────────────────────────┐
│                       VIDEO COMPOSITION PIPELINE                    │
└─────────────────────────────────────────────────────────────────────┘

Input Script (JSON)
    │
    ├── Scene Segmentation
    │   └── Split script into timed segments with visual cues
    │
    ├── Asset Resolution
    │   ├── B-roll matching (semantic search against stock libraries)
    │   ├── Image generation (DALL-E/Midjourney for custom visuals)
    │   ├── Chart/diagram generation (mermaid, d3 → video frames)
    │   └── Audio track selection (mood-based music matching)
    │
    ├── Voiceover Generation
    │   └── TTS with timing markers per segment
    │
    ├── Composition Assembly
    │   ├── Timeline construction (Remotion/FFmpeg)
    │   ├── Transition application
    │   ├── Lower-thirds overlay
    │   ├── Subtitle burn-in
    │   └── Audio mixing (voice + music + sfx)
    │
    └── Render + Export
        ├── Multi-format export (YouTube, Instagram, TikTok)
        └── Thumbnail generation (AI-selected keyframes)
```

### Video Style Presets

| Style | Description | Primary Use |
|-------|-------------|-------------|
| `talking-head` | Avatar/AI presenter with slides | Educational |
| `b-roll-narration` | Voiceover with relevant footage | Documentary |
| `animated-explainer` | Motion graphics with narration | Concepts |
| `documentary` | Mixed media, interviews, archival | Investigative |
| `short-form` | 60s optimized, vertical, punchy | Reels/TikTok |

---

## 6. Humanizer Presets — Article Styling

```json
// templates/humanizers/nyt.json
{
  "name": "New York Times",
  "traits": {
    "opening": "Start with a scene, anecdote, or striking fact",
    "structure": "Inverted pyramid with narrative weaving",
    "voice": "Authoritative but accessible",
    "sentence_length": "varied, averaging 18-22 words",
    "paragraph_length": "3-5 sentences",
    "transitions": "Subtle, often implicit"
  },
  "vocabulary": {
    "prefer": ["observed", "noted", "according to", "suggests"],
    "avoid": ["basically", "actually", "in order to", "utilize"]
  },
  "patterns": {
    "lead": "narrative | anecdotal | declarative",
    "nut_graf": "paragraph 3-4",
    "quotes": "integrated, not leading"
  }
}

// templates/humanizers/lmd.json (Le Monde Diplomatique)
{
  "name": "Le Monde Diplomatique",
  "traits": {
    "opening": "Contextualize within broader geopolitical framework",
    "structure": "Thesis-driven analytical essay",
    "voice": "Intellectual, critical, globally conscious",
    "sentence_length": "longer, complex, subordinate clauses",
    "paragraph_length": "5-8 sentences, dense",
    "transitions": "Explicit logical connectors"
  },
  "vocabulary": {
    "prefer": ["hegemony", "neoliberal", "paradigm", "structural"],
    "avoid": ["breaking", "exclusive", "sources say"]
  },
  "patterns": {
    "lead": "analytical | contextual",
    "thesis": "paragraph 1-2",
    "evidence": "historical precedent + current data"
  }
}
```

---

## 7. Modular Agent Prompts

These prompts guide your coding agent (Claude Code, Copilot, etc.) for each module:

---

### PROMPT 01: Core Module — `@abquanta/abq-media-core`

```markdown
# Task: Implement @abquanta/abq-media-core

## Context
This is the foundation module for the abq-media-workspace monorepo. It provides shared domain models, TypeScript interfaces, and the configuration loader.

## Requirements

1. **Configuration Loader**
   - Load and validate `abq.config.ts` from project root
   - Support environment variable interpolation (`$env:VAR_NAME`)
   - Support cross-references (`$ref:podcast.voices.host`)
   - Export typed config object

2. **Domain Models**
   - `Source`: Represents input content (url, file path, type)
   - `Digest`: Extracted talking points with timestamps
   - `Research`: Deep research output with citations
   - `Script`: Output-ready script with segments
   - `Asset`: Media asset reference (audio, video, image)
   - `PublishJob`: Scheduled publish task

3. **Pipeline Contracts**
   - `Adapter<TInput, TOutput>`: Extraction interface
   - `Processor<TInput, TOutput>`: Transformation interface
   - `OutputGenerator<TScript, TAsset>`: Generation interface
   - `Channel<TAsset>`: Distribution interface

4. **Utilities**
   - `createPipeline(...steps)`: Compose pipeline from steps
   - `validateConfig(config)`: Zod schema validation
   - `resolveAssetPath(ref)`: Resolve local/remote assets

## Tech Stack
- TypeScript strict mode
- Zod for schema validation
- No runtime dependencies except zod

## File Structure
```
packages/core/
├── src/
│   ├── config/
│   │   ├── loader.ts
│   │   ├── schema.ts
│   │   └── types.ts
│   ├── models/
│   │   ├── source.ts
│   │   ├── digest.ts
│   │   ├── research.ts
│   │   ├── script.ts
│   │   └── index.ts
│   ├── contracts/
│   │   ├── adapter.ts
│   │   ├── processor.ts
│   │   ├── output.ts
│   │   ├── channel.ts
│   │   └── index.ts
│   ├── pipeline/
│   │   └── composer.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

## Constraints
- Zero side effects on import
- All exports must be typed
- Prefer interfaces over types for extensibility
- Document public API with TSDoc
```

---

### PROMPT 02: YouTube Adapter — `@abquanta/adapter-youtube`

```markdown
# Task: Implement @abquanta/adapter-youtube

## Context
Extract metadata and transcripts from YouTube URLs. Part of the extraction layer in abq-media-workspace.

## Requirements

1. **URL Normalization**
   - Accept: youtube.com/watch, youtu.be, youtube.com/shorts
   - Extract video ID
   - Validate URL format

2. **Metadata Extraction**
   - Title, description, duration
   - Channel name, subscriber count
   - View count, publish date
   - Thumbnail URLs
   - Use youtube-dl/yt-dlp or YouTube Data API

3. **Transcript Extraction**
   - Fetch auto-generated captions
   - Fetch manual captions if available
   - Support language selection
   - Return timestamped segments
   - Fallback: return null (let adapter-transcript handle ASR)

4. **Output Format**
   ```typescript
   interface YouTubeExtraction {
     videoId: string;
     metadata: VideoMetadata;
     transcript: TranscriptSegment[] | null;
     thumbnails: Thumbnail[];
   }
   ```

## Tech Stack
- TypeScript
- yt-dlp (via execa) or youtube-transcript package
- @abquanta/abq-media-core for types

## CLI Integration
```bash
# Standalone usage
npx @abquanta/adapter-youtube extract "https://youtube.com/watch?v=..."
```

## Constraints
- Handle rate limits gracefully
- Cache metadata for 24h
- No API key required for basic extraction (use yt-dlp)
- API key optional for enhanced metadata
```

---

### PROMPT 03: Podcast Output — `@abquanta/output-podcast`

```markdown
# Task: Implement @abquanta/output-podcast

## Context
Transform scripts into polished podcast audio using TTS and audio mixing.

## Requirements

1. **Script Parsing**
   - Accept Script model from core
   - Parse segments: intro, content blocks, outro
   - Extract voice assignments per segment

2. **TTS Integration**
   - Support providers: ElevenLabs, OpenAI TTS, Google TTS
   - Apply voice settings from config (stability, similarity)
   - Generate audio per segment
   - Handle provider fallback

3. **Audio Composition**
   - Assemble segments in order
   - Apply intro/outro music with crossfade
   - Add segment transitions (brief pause, music swell)
   - Normalize audio levels
   - Mix voice with background music

4. **Output**
   ```typescript
   interface PodcastOutput {
     audioFile: string; // path to final MP3
     duration: number; // seconds
     chapters: Chapter[]; // for podcast players
     transcript: string; // SRT/VTT for accessibility
   }
   ```

5. **Configuration Integration**
   - Read from `abq.config.ts → podcast`
   - Support style presets (conversational, monologue, etc.)
   - Apply format (intro/outro templates)

## Tech Stack
- TypeScript
- ffmpeg (via fluent-ffmpeg)
- ElevenLabs SDK / OpenAI SDK
- @abquanta/abq-media-core

## CLI Integration
```bash
npx @abquanta/output-podcast generate --input script.json --output episode.mp3
npx @abquanta/output-podcast generate --input script.json --style conversational
```

## Constraints
- Lambda-compatible (use /tmp for intermediate files)
- Max 20 min episodes in single invocation
- Longer episodes: chunked processing
```

---

### PROMPT 04: Article Output — `@abquanta/output-article`

```markdown
# Task: Implement @abquanta/output-article

## Context
Transform research/scripts into styled articles using humanizer presets.

## Requirements

1. **Humanizer Engine**
   - Load preset from templates/humanizers/*.json
   - Apply style traits to LLM prompt
   - Support custom humanizer definitions
   - Chain: raw content → LLM → styled output

2. **Format Support**
   - `long-form`: Full article (1500-3000 words)
   - `brief`: Summary (300-500 words)
   - `thread`: Twitter/X thread format (numbered tweets)
   - `newsletter`: Email-optimized with sections

3. **LLM Integration**
   - Use provider from config (Anthropic preferred)
   - Construct prompt with humanizer traits
   - Apply tone, avoid patterns
   - Validate output structure

4. **Metadata Generation**
   - SEO title and meta description
   - Open Graph tags
   - Suggested tags/categories
   - Reading time estimate

5. **Output**
   ```typescript
   interface ArticleOutput {
     content: string; // Markdown
     html: string; // Rendered HTML
     metadata: ArticleMetadata;
     format: 'long-form' | 'brief' | 'thread' | 'newsletter';
   }
   ```

## Tech Stack
- TypeScript
- Anthropic SDK / OpenAI SDK
- marked (Markdown → HTML)
- @abquanta/abq-media-core

## Humanizer Prompt Template
```
You are a writer for {humanizer.name}. 

Style traits:
{humanizer.traits}

Vocabulary preferences:
- Use: {humanizer.vocabulary.prefer}
- Avoid: {humanizer.vocabulary.avoid}

Transform the following content into a {format} article:

{input_content}
```

## Constraints
- Preserve factual accuracy from source
- No hallucinated quotes or sources
- Maintain voice consistency throughout
```

---

### PROMPT 05: Video Output — `@abquanta/output-video`

```markdown
# Task: Implement @abquanta/output-video

## Context
Compose videos from scripts using automated asset matching, TTS, and video rendering.

## Requirements

1. **Scene Segmentation**
   - Parse script into timed segments
   - Extract visual cues/keywords per segment
   - Calculate duration per segment

2. **Asset Resolution**
   - **B-roll**: Semantic search against Pexels/Unsplash/Storyblocks API
   - **Images**: Optional DALL-E/Midjourney generation
   - **Charts**: Mermaid/D3 → PNG/video frames
   - **Music**: Mood-based selection from library
   - Cache resolved assets

3. **Voiceover Generation**
   - Delegate to @abquanta/output-podcast TTS
   - Extract timing markers for sync

4. **Composition**
   - Build timeline with segments
   - Apply transitions between scenes
   - Overlay lower-thirds (speaker name, topic)
   - Burn-in subtitles
   - Mix audio tracks (voice, music, sfx)

5. **Rendering**
   - Support engines: Remotion (React), FFmpeg, Shotstack API
   - Multi-format export (16:9, 9:16, 1:1)
   - Thumbnail extraction

6. **Output**
   ```typescript
   interface VideoOutput {
     videoFile: string;
     thumbnails: string[];
     subtitles: { srt: string; vtt: string };
     duration: number;
     aspectRatio: string;
   }
   ```

## Tech Stack
- TypeScript
- Remotion (preferred) or FFmpeg
- Pexels/Unsplash API
- @abquanta/output-podcast (for TTS)
- @abquanta/abq-media-core

## Style Presets Implementation
```typescript
const STYLE_PRESETS = {
  'talking-head': {
    layout: 'presenter-center',
    background: 'gradient',
    slides: true,
  },
  'b-roll-narration': {
    layout: 'fullscreen-video',
    voiceover: true,
    lowerThirds: true,
  },
  // ...
};
```

## Constraints
- Lambda: Use Shotstack API for serverless
- Local: Remotion for quality control
- Max 10 min videos per invocation
- Longer: chunked rendering + concatenation
```

---

### PROMPT 06: Scheduler Buffer — `@abquanta/scheduler-buffer`

```markdown
# Task: Implement @abquanta/scheduler-buffer

## Context
Manage content queue and scheduled publishing across channels.

## Requirements

1. **Queue Management**
   - Add content to queue with metadata
   - Set publish date/time per channel
   - Support draft/pending/approved/published states
   - Max pending items from config

2. **Calendar Integration**
   - Read optimal times from config
   - Suggest next available slot per channel
   - Avoid conflicts (no double-posting)
   - Support manual override

3. **Approval Workflow**
   - Default: manual approval required
   - Optional: auto-publish for specific channels
   - Notification hooks (webhook, email)

4. **Execution**
   - Cron-triggered publish check
   - Call appropriate channel adapter
   - Update status on success/failure
   - Retry logic for failures

5. **External Providers** (optional)
   - Buffer API integration
   - Notion database sync
   - Asana task creation

6. **Data Model**
   ```typescript
   interface PublishJob {
     id: string;
     contentRef: string; // path to output
     channel: ChannelType;
     scheduledAt: Date;
     status: 'draft' | 'pending' | 'approved' | 'published' | 'failed';
     metadata: ChannelMetadata;
     attempts: number;
     lastError?: string;
   }
   ```

## Tech Stack
- TypeScript
- SQLite (local) or DynamoDB (Lambda)
- node-cron for local scheduler
- EventBridge for Lambda

## CLI Integration
```bash
abq-media schedule --content ./ep01/ --channel youtube --date "2025-03-01T14:00"
abq-media schedule --list
abq-media schedule --approve job-123
abq-media schedule --run  # manual trigger
```

## Constraints
- Idempotent publish operations
- Store minimal data (refs, not content)
- Support dry-run mode
```

---

### PROMPT 07: CLI Interface — `@abquanta/abq-media-cli`

```markdown
# Task: Implement @abquanta/abq-media-cli

## Context
Main command-line interface for the entire abq-media-workspace system.

## Requirements

1. **Command Structure**
   ```
   abq-media <command> [subcommand] [options]
   
   Commands:
     prep      Extract and process source content
     podcast   Generate podcast audio
     article   Generate styled article
     video     Generate video content
     schedule  Manage publish queue
     run       Execute full pipeline
     config    View/validate configuration
   ```

2. **Global Options**
   - `--config <path>`: Custom config file
   - `--verbose`: Detailed logging
   - `--dry-run`: Simulate without executing
   - `--output <dir>`: Override output directory

3. **Interactive Mode**
   - `abq-media` with no args → interactive menu
   - Step-by-step pipeline builder
   - Preview outputs before generation

4. **Progress Reporting**
   - Spinner for long operations
   - Progress bar for multi-step pipelines
   - Clear error messages with suggestions

5. **Configuration**
   - `abq-media config show`: Display current config
   - `abq-media config validate`: Check for errors
   - `abq-media config init`: Generate starter config

## Tech Stack
- TypeScript
- Commander.js or yargs
- Inquirer for interactive prompts
- ora for spinners
- chalk for colors

## Example Flows
```bash
# Full pipeline
abq-media run youtube-research-podcast \
  --url "https://youtube.com/watch?v=..." \
  --lang es \
  --publish soundcloud

# Step by step
abq-media prep --url "https://youtube.com/..."
abq-media podcast --input ./outputs/digest.json
abq-media schedule --content ./outputs/ep01/ --channel soundcloud
```

## Constraints
- Exit codes: 0 success, 1 error, 2 user abort
- Support piping: `cat urls.txt | abq-media prep --batch`
- Config file required for most operations
```

---

## 8. Implementation Roadmap

### Phase 0.1 — Foundation (Current)
- [x] Monorepo setup (turbo, pnpm)
- [ ] `@abquanta/abq-media-core` — config + models
- [ ] `@abquanta/adapter-youtube` — extraction
- [ ] `@abquanta/processor-digest` — talking points
- [ ] Basic CLI scaffold

### Phase 0.2 — Podcast MVP
- [ ] `@abquanta/processor-research` — deep research
- [ ] `@abquanta/output-podcast` — TTS + mixing
- [ ] `@abquanta/channel-soundcloud` — publishing
- [ ] End-to-end pipeline: URL → Podcast → SoundCloud

### Phase 0.3 — Article Engine
- [ ] `@abquanta/output-article` — humanizer system
- [ ] Humanizer presets (NYT, LMD, custom)
- [ ] `@abquanta/channel-substack` — publishing
- [ ] Thread format for X/Twitter

### Phase 0.4 — Video Engine
- [ ] `@abquanta/output-video` — composition
- [ ] B-roll asset resolution
- [ ] Remotion integration
- [ ] `@abquanta/channel-youtube` — publishing
- [ ] `@abquanta/channel-instagram` — reels

### Phase 0.5 — Scheduler
- [ ] `@abquanta/scheduler-buffer` — queue
- [ ] Calendar-aware scheduling
- [ ] Approval workflow
- [ ] Multi-channel orchestration

---

## 9. Design Principles (Expanded)

1. **Every component is an npm module** — Reusable, swappable, independently versioned.

2. **Deterministic workflow** — No hidden autonomous loops. Every transformation is explicit and auditable.

3. **Lambda-friendly boundaries** — Small stateless functions. Use /tmp for intermediate files. External state in S3/DynamoDB.

4. **Open interfaces for adapters** — Any source, any output, any channel. Contracts in core, implementations swappable.

5. **Open-source by default** — Clear docs, examples, MIT license. Community contributions welcome.

6. **Configure once, run anywhere** — Single `abq.config.ts` drives all behavior. No per-command configuration sprawl.

7. **Human in the loop** — Manual approval by default. AI assists, human decides.

8. **Fail gracefully** — Every step can fail. Retry logic, clear error messages, resumable pipelines.

---

## 10. Quick Reference — File Locations

| Purpose | Location |
|---------|----------|
| Root config | `abq.config.ts` |
| Humanizer presets | `templates/humanizers/*.json` |
| Video templates | `templates/video-*.json` |
| Pipeline outputs | `outputs/<job-id>/` |
| Cached assets | `.cache/` |
| Scheduler DB | `.data/scheduler.db` |

---

*This document serves as the architectural blueprint and coding agent guide for abq-media-workspace. Each PROMPT section can be fed directly to Claude Code or similar agents for implementation.*
