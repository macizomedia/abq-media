#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function replaceTokens(content, tokens) {
  let out = content;
  for (const [k, v] of Object.entries(tokens)) {
    out = out.replaceAll(`<${k}>`, v);
  }
  return out;
}

function processFiles(dir, tokens) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      processFiles(full, tokens);
      continue;
    }
    if (!/\.(md|json|js|ts|ya?ml|txt)$/i.test(entry)) continue;
    const raw = fs.readFileSync(full, 'utf8');
    fs.writeFileSync(full, replaceTokens(raw, tokens));
  }
}

function parseArg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1] || fallback;
}

const moduleName = parseArg('--name');
if (!moduleName) {
  console.error('Usage: create-abq-module --name <module-name> [--description "..."] [--repo-name "..."]');
  process.exit(1);
}

const description = parseArg('--description', 'Abquanta module');
const repoName = parseArg('--repo-name', moduleName);
const year = String(new Date().getFullYear());

const thisFileDir = path.dirname(new URL(import.meta.url).pathname);
const workspaceRoot = path.resolve(thisFileDir, '..', '..', '..');
const templateRoot = path.resolve(workspaceRoot, '..', '..', 'templates', 'abquanta-module');
const dest = path.resolve(workspaceRoot, 'packages', moduleName);

if (fs.existsSync(dest)) {
  console.error(`Destination already exists: ${dest}`);
  process.exit(1);
}

copyRecursive(templateRoot, dest);
processFiles(dest, {
  'module-name': moduleName,
  'short-description': description,
  'repo-name': repoName,
  year
});

console.log(`Created module at ${dest}`);
