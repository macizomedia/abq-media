
export interface Engine {
  name: string;
}

export interface SourceEngine extends Engine {
  fetch(source: URL): Promise<{ title: string; content: Buffer }>;
}

export interface TranscriptionEngine extends Engine {
  transcribe(audio: Buffer): Promise<string>;
}

export interface TextToSpeechEngine extends Engine {
  synthesize(text: string): Promise<Buffer>;
}

export interface VideoEngine extends Engine {
  render(script: any): Promise<Buffer>;
}
