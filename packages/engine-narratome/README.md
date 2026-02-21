# @abquanta/engine-narratome

Generate narratome.json from research prompts and render it into video using Pexels B-roll, ElevenLabs TTS, and ffmpeg.

Built as part of Abquanta's Content & Community and
Observatory verticals. The Narratome Engine is Abquanta's
visual intelligence storytelling system — taking research
and constructing story worlds for journalism, analysis,
and civic education.

## Install

```bash
npm install -w @abquanta/engine-narratome
```

## Configuration

Create `.abq-module.json` in your working directory (or edit the template):

```json
{
  "llmProvider": "openrouter",
  "llmModel": "google/gemini-2.0-flash:free",
  "elevenLabsApiKey": "",
  "voiceIdA": "pNInz6obpgDQGcFmaJgB",
  "voiceIdB": "EXAVITQu4vr4xnSDxMaL",
  "pexelsApiKey": "",
  "lang": "es",
  "defaultFormat": "briefing",
  "defaultDuration": 120
}
```

Environment fallback:

- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `ELEVENLABS_API_KEY`
- `PEXELS_API_KEY`

## Usage

Generate a narratome:

```bash
abq-narratome generate --input deep_research_prompt.md --format briefing --lang es --duration 120
```

Render a narratome:

```bash
abq-narratome render --input output/narratome-*/narratome.json --output output/episode.mp4
```

Run generate + render:

```bash
abq-narratome run --input deep_research_prompt.md --format briefing --lang es
```

Doctor check:

```bash
abq-narratome doctor
```
