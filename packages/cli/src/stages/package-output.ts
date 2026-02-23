/**
 * @module stages/package-output
 * PACKAGE — Bundle all run artifacts into a zip + split social posts.
 * Offers clipboard copy of key files. Loops back to OUTPUT_SELECT
 * or finishes to COMPLETE.
 *
 * Extracted from monolith exportZipPackage() L771–L862 +
 * export_zip handler L1340–L1370.
 *
 * Input context:
 *   - `projectName`, `runDir`
 *   - artifact paths (optional)
 *
 * Output context:
 *   - `zipPath`, `outputFiles`
 *
 * Next state: OUTPUT_SELECT ("do more") or COMPLETE ("done")
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { CLIContext, StageResult } from '../machine/types.js';
import { clack, unwrapCancel, hasCmd } from '../ui/prompts.js';
import { ensureDir } from '../utils/fs.js';
import { getProjectExportsDir } from '../utils/paths.js';

// ── Helpers (extracted from monolith) ────────────────────────────────────

function copyToClipboard(text: string): boolean {
  if (!hasCmd('pbcopy')) return false;
  try {
    const res = spawnSync('pbcopy', [], { input: text });
    return res.status === 0;
  } catch {
    return false;
  }
}

function splitSocialPosts(content: string): { twitter: string; linkedin: string } {
  const raw = String(content || '');
  const twitterIdx = raw.toLowerCase().indexOf('twitter');
  const linkedinIdx = raw.toLowerCase().indexOf('linkedin');
  const instagramIdx = raw.toLowerCase().indexOf('instagram');
  const twitter = twitterIdx >= 0
    ? raw.slice(twitterIdx, linkedinIdx >= 0 ? linkedinIdx : undefined).trim()
    : '';
  const linkedin = linkedinIdx >= 0
    ? raw.slice(linkedinIdx, instagramIdx >= 0 ? instagramIdx : undefined).trim()
    : '';
  return { twitter: twitter || raw, linkedin: linkedin || raw };
}

interface ZipResult {
  zipPath: string;
  workDir: string;
}

function buildZipPackage(projectName: string, runDir: string): ZipResult | null {
  if (!hasCmd('zip')) {
    clack.log.error('zip is not available on this system.');
    return null;
  }

  const exportDir = getProjectExportsDir(projectName);
  ensureDir(exportDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workDir = path.join(exportDir, `export-${stamp}`);
  ensureDir(workDir);

  const files: string[] = [];

  const copy = (srcName: string, destName?: string) => {
    const src = path.join(runDir, srcName);
    if (!fs.existsSync(src)) return;
    const dest = path.join(workDir, destName ?? srcName);
    fs.copyFileSync(src, dest);
    files.push(dest);
  };

  copy('summary.txt');
  copy('article.md');
  copy('podcast_script.md');
  copy('reel_script.md');
  copy('social_posts.md');
  copy('audio-clean.mp3');
  copy('podcast.mp3');

  // Split social posts into per-platform files
  const socialSrc = path.join(runDir, 'social_posts.md');
  if (fs.existsSync(socialSrc)) {
    const social = fs.readFileSync(socialSrc, 'utf8');
    const { twitter, linkedin } = splitSocialPosts(social);
    const twitterDest = path.join(workDir, 'social-twitter.txt');
    const linkedinDest = path.join(workDir, 'social-linkedin.txt');
    fs.writeFileSync(twitterDest, twitter.trim() + '\n');
    fs.writeFileSync(linkedinDest, linkedin.trim() + '\n');
    files.push(twitterDest, linkedinDest);
  }

  // Metadata
  const metaDest = path.join(workDir, 'metadata.json');
  fs.writeFileSync(
    metaDest,
    JSON.stringify({ project: projectName, runDir, createdAt: new Date().toISOString() }, null, 2),
  );
  files.push(metaDest);

  const zipPath = path.join(exportDir, `${projectName}-${stamp}.zip`);
  const fileArgs = files.map((f) => `"${f}"`).join(' ');
  spawnSync('zip', ['-j', zipPath, ...files], { cwd: exportDir, stdio: 'pipe' });

  return { zipPath, workDir };
}

// ── Stage handler ────────────────────────────────────────────────────────

export async function packageOutput(ctx: CLIContext): Promise<StageResult> {
  const result = buildZipPackage(ctx.projectName, ctx.runDir);

  if (!result) {
    clack.log.error('Export failed.');
  } else {
    clack.log.info(`Zip created: ${result.zipPath}`);

    // Offer clipboard copy for key files
    const offerCopy = async (label: string, filePath: string) => {
      if (!filePath || !fs.existsSync(filePath)) return;
      const ok = await clack.confirm({ message: `Copy ${label} to clipboard?`, initialValue: false });
      if (clack.isCancel(ok) || !ok) return;
      const text = fs.readFileSync(filePath, 'utf8');
      if (!copyToClipboard(text)) {
        clack.log.warn('Clipboard not available.');
      } else {
        clack.log.info(`${label} copied.`);
      }
    };

    await offerCopy('article', path.join(result.workDir, 'article.md'));
    await offerCopy('twitter thread', path.join(result.workDir, 'social-twitter.txt'));
    await offerCopy('linkedin post', path.join(result.workDir, 'social-linkedin.txt'));
    await offerCopy('summary', path.join(result.workDir, 'summary.txt'));
  }

  // Ask: do more or finish?
  const next = await clack.select({
    message: 'Package complete. What next?',
    options: [
      { value: 'more' as const, label: 'Do more with this run' },
      { value: 'done' as const, label: 'Finish' },
    ],
  });
  const picked = unwrapCancel(next, 'PACKAGE');

  const outputFiles = result
    ? [...(ctx.outputFiles ?? []), result.zipPath]
    : ctx.outputFiles ?? [];

  if (picked === 'done') {
    return {
      nextState: 'COMPLETE',
      context: {
        ...ctx,
        zipPath: result?.zipPath,
        outputFiles,
        currentState: 'COMPLETE',
        stateHistory: [...ctx.stateHistory, 'PACKAGE'],
      },
    };
  }

  return {
    nextState: 'OUTPUT_SELECT',
    context: {
      ...ctx,
      zipPath: result?.zipPath,
      outputFiles,
      currentState: 'OUTPUT_SELECT',
      stateHistory: [...ctx.stateHistory, 'PACKAGE'],
    },
  };
}
