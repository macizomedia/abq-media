
import { TextToSpeechEngine } from '@abq/core';
import { ElevenLabsClient } from 'elevenlabs';
import fs from 'node:fs';

export class ElevenLabsEngine implements TextToSpeechEngine {
  public name = 'elevenlabs';
  private elevenlabs: ElevenLabsClient;

  constructor(apiKey: string) {
    this.elevenlabs = new ElevenLabsClient({ apiKey });
  }

  async synthesize(text: string, voiceId: string, outputFilePath: string): Promise<Buffer> {
    const audio = await this.elevenlabs.generate({
      voice: voiceId,
      text,
      model_id: 'eleven_multilingual_v2'
    });

    const chunks = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }

    const content = Buffer.concat(chunks);
    await fs.promises.writeFile(outputFilePath, content);
    return content;
  }
