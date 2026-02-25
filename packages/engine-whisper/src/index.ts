
import { TranscriptionEngine } from '@abq/core';
import { OpenAI } from '@openai/whisper';
import fs from 'node:fs';

export class WhisperEngine implements TranscriptionEngine {
  public name = 'whisper';
  private whisper: OpenAI;

  constructor(apiKey: string) {
    this.whisper = new OpenAI({ apiKey });
  }

  async transcribe(audioFilePath: string): Promise<string> {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    const transcription = await this.whisper.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
    });

    return transcription.text;
  }
