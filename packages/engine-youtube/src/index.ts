
import { SourceEngine } from '@abq/core';
import YTDlpWrap from 'yt-dlp-wrap';
import fs from 'node:fs';
import path from 'node:path';

// This should be configured or discovered
const YTDLP_PATH = '/usr/local/bin/yt-dlp';

export class YouTubeEngine implements SourceEngine {
  public name = 'youtube';
  private ytdlp: YTDlpWrap;

  constructor() {
    this.ytdlp = new YTDlpWrap(YTDLP_PATH);
  }

  async fetch(source: URL): Promise<{ title: string; content: Buffer; audioFilePath: string }> {
    const videoId = this.extractVideoId(source.toString());
    if (!videoId) {
      throw new Error(`Could not extract video ID from ${source}`);
    }

    const outputDir = path.join('/tmp', 'abq-media', videoId);
    fs.mkdirSync(outputDir, { recursive: true });
    const audioFilePath = path.join(outputDir, 'audio.mp3');

    await this.ytdlp.exec([
      source.toString(),
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '-x',
      '--audio-format', 'mp3',
      '-o', audioFilePath,
    ]);

    const metadata = await this.ytdlp.getVideoInfo(source.toString());
    const title = metadata.title || 'Unknown Title';

    const content = fs.readFileSync(audioFilePath);

    return { title, content, audioFilePath };
  }

  private extractVideoId(input: string): string {
    try {
      const u = new URL(
        String(input || '')
          .replace(/\\\?/g, '?')
          .replace(/\\&/g, '&')
          .replace(/\\=/g, '=')
          .trim(),
      );
      if (u.hostname.includes('youtu.be')) {
        return u.pathname.replace('/', '').trim();
      }
      if (u.searchParams.get('v')) return u.searchParams.get('v')!;
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('shorts');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    } catch {
      // ignore
    }
    return '';
  }
