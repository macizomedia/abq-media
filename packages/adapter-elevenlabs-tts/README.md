# @abquanta/adapter-elevenlabs-tts

Render a 2-host dialogue podcast script into a single MP3 using ElevenLabs TTS + ffmpeg.

Built as part of Abquanta's Content & Community initiative.
Abquanta is a civic-tech and strategic intelligence platform
focused on Venezuela, data sovereignty, and the global AI/Rare Minerals race.

## Install

```bash
npm install -w @abquanta/adapter-elevenlabs-tts
```

## Configuration

Create `.abq-module.json` in your working directory:

```json
{
  "elevenLabsApiKey": "YOUR_ELEVENLABS_API_KEY",
  "voiceIdA": "pNInz6obpgDQGcFmaJgB",
  "voiceIdB": "EXAVITQu4vr4xnSDxMaL",
  "elevenLabsModel": "eleven_multilingual_v2",
  "outputFormat": "mp3_44100_128"
}
```

Environment fallback:

- `ELEVENLABS_API_KEY`

## Usage

Render a podcast script:

```bash
abq-el-tts render --input path/to/podcast_script.md
```

Custom output path:

```bash
abq-el-tts render --input path/to/podcast_script.md --output output/podcast.mp3
```

Doctor check:

```bash
abq-el-tts doctor
```

## Input Format

```
HOST_A: El petróleo venezolano vuelve a ser noticia esta semana...
HOST_B: Exacto, y lo que mucha gente no sabe es que...
HOST_A: ¿Qué significa eso para la transición política?
HOST_B: Significa que el tablero geopolítico está cambiando...
```

Lines beginning with `HOST_A:` go to voice A, `HOST_B:` to voice B. All other lines are skipped.
