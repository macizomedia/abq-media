/**
 * @module stages/tts-render
 * TTS_RENDER — Render podcast script to MP3 via ElevenLabs adapter.
 *
 * Shells out to the adapter-elevenlabs-tts CLI (same as monolith).
 * Requires ELEVENLABS_API_KEY in credentials or environment.
 *
 * Extracted from monolith cmdRun() L1369–L1394.
 *
 * Input context:
 *   - `podcastScriptPath` — path to podcast_script.md
 *   - `runDir`
 *
 * Output context:
 *   - `audioPath` — path to podcast.mp3
 *   - updated `legacyState`
 *
 * Next state: PACKAGE
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, withSpinnerAsync, hasCmd } from '../ui/prompts.js';
import { readJson } from '../utils/fs.js';
import { getCredentialsPath, writeRunState } from '../utils/paths.js';

export async function ttsRender(ctx: CLIContext): Promise<StageResult> {
  const podcastScriptPath = ctx.podcastScriptPath ?? path.join(ctx.runDir, 'podcast_script.md');

  if (!fs.existsSync(podcastScriptPath)) {
    clack.log.warn('No podcast script found. Generate one first.');
    return {
      nextState: 'PACKAGE',
      context: {
        ...ctx,
        currentState: 'PACKAGE',
        stateHistory: [...ctx.stateHistory, 'TTS_RENDER'],
      },
    };
  }

  // Resolve API key
  const moduleConfig = readJson<Record<string, unknown>>(path.resolve(process.cwd(), '.abq-module.json')) ?? {};
  const globalCreds = readJson<Record<string, unknown>>(getCredentialsPath()) ?? {};
  const ttsKey =
    (moduleConfig.elevenLabsApiKey as string) ||
    (globalCreds.elevenLabsApiKey as string) ||
    process.env.ELEVENLABS_API_KEY ||
    '';

  if (!ttsKey) {
    clack.log.error(
      'ElevenLabs API key not set. Run "abq-media init" to add it, or set ELEVENLABS_API_KEY.',
    );
    return {
      nextState: 'PACKAGE',
      context: {
        ...ctx,
        currentState: 'PACKAGE',
        stateHistory: [...ctx.stateHistory, 'TTS_RENDER'],
      },
    };
  }

  const audioOut = path.join(ctx.runDir, 'podcast.mp3');
  // Resolve adapter path relative to this file: ../../adapter-elevenlabs-tts/src/cli.js
  const ttsScript = path.resolve(import.meta.dirname, '..', '..', '..', 'adapter-elevenlabs-tts', 'src', 'cli.js');
  const ttsCmd = `node "${ttsScript}" render --input "${podcastScriptPath}" --output "${audioOut}"`;
  clack.log.info(`Will run: ${ttsCmd}`);

  const confirmTts = await clack.confirm({ message: 'Run ElevenLabs TTS now?', initialValue: false });
  if (clack.isCancel(confirmTts) || !confirmTts) {
    return {
      nextState: 'PACKAGE',
      context: {
        ...ctx,
        currentState: 'PACKAGE',
        stateHistory: [...ctx.stateHistory, 'TTS_RENDER'],
      },
    };
  }

  try {
    await withSpinnerAsync('Rendering audio…', async () => {
      execSync(ttsCmd, {
        cwd: process.cwd(),
        env: { ...process.env, ELEVENLABS_API_KEY: ttsKey },
        stdio: 'pipe',
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clack.log.error(`TTS failed: ${message}`);
    return {
      nextState: 'PACKAGE',
      context: {
        ...ctx,
        currentState: 'PACKAGE',
        stateHistory: [...ctx.stateHistory, 'TTS_RENDER'],
      },
    };
  }

  if (fs.existsSync(audioOut)) {
    clack.log.success(`Audio saved: ${audioOut}`);
    let legacyState = ctx.legacyState;
    if (legacyState) {
      legacyState = {
        ...legacyState,
        stages: { ...legacyState.stages, tts: 'done' },
        updatedAt: new Date().toISOString(),
      };
      writeRunState(ctx.runDir, legacyState);
    }
    return {
      nextState: 'PACKAGE',
      context: {
        ...ctx,
        audioPath: audioOut,
        legacyState,
        currentState: 'PACKAGE',
        stateHistory: [...ctx.stateHistory, 'TTS_RENDER'],
      },
    };
  }

  clack.log.error('Render completed but no output file produced.');
  return {
    nextState: 'PACKAGE',
    context: {
      ...ctx,
      currentState: 'PACKAGE',
      stateHistory: [...ctx.stateHistory, 'TTS_RENDER'],
    },
  };
}
