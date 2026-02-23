import { readFile, writeFile } from "node:fs/promises";

// --- Configuration ----------------------------------------------------------
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("Error: ELEVENLABS_API_KEY environment variable is not set.");
  process.exit(1);
}

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const MODEL_ID = "eleven_multilingual_v2";
const OUT_FORMAT = "mp3_44100_128";
const INPUT_FILE = "packages/pipeline-youtube-research-podcast/output/publish-2026-02-22T17-21-13-604Z/podcast_script.md";
const OUTPUT_FILE = "output/elevenlabs_test.mp3";

// --- ElevenLabs TTS via REST API --------------------------------------------
async function textToSpeech({ apiKey, voiceId, modelId, outputFormat, text }) {
  const baseUrl = "https://api.elevenlabs.io/v1/text-to-speech";
  const qs = outputFormat ? `?output_format=${encodeURIComponent(outputFormat)}` : "";
  const res = await fetch(`${baseUrl}/${voiceId}${qs}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// --- Main -------------------------------------------------------------------
const text = await readFile(INPUT_FILE, "utf-8");
console.log(`Read ${text.length} chars from ${INPUT_FILE}`);

const audio = await textToSpeech({
  apiKey: API_KEY,
  voiceId: VOICE_ID,
  modelId: MODEL_ID,
  outputFormat: OUT_FORMAT,
  text,
});

await writeFile(OUTPUT_FILE, audio);
console.log(`Audio written to ${OUTPUT_FILE} (${audio.length} bytes)`);
