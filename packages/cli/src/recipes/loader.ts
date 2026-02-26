import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { parse, stringify } from 'yaml';

import type { Recipe } from './types.js';

const BUILTIN_DIR = path.join(import.meta.dirname, 'builtin');
const USER_DIR = path.join(os.homedir(), '.abq-media', 'recipes');

async function pathExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

function mergeRecipes(base: Recipe, override: Partial<Recipe>): Recipe {
  const nextStages = base.stages.map((baseStage) => {
    const overrideStage = override.stages?.find((candidate) => candidate.name === baseStage.name);
    return overrideStage ? { ...baseStage, ...overrideStage } : baseStage;
  });

  const additionalStages = (override.stages ?? []).filter(
    (stage) => !nextStages.some((candidate) => candidate.name === stage.name),
  );

  return {
    ...base,
    ...override,
    stages: [...nextStages, ...additionalStages],
  };
}

function assertRecipe(value: unknown, context: string): asserts value is Recipe {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid recipe in ${context}`);
  }
  const recipe = value as Partial<Recipe>;
  if (!recipe.name || !Array.isArray(recipe.stages)) {
    throw new Error(`Recipe missing required fields in ${context}`);
  }
}

export async function parseRecipeFile(filepath: string): Promise<Recipe> {
  const content = await fs.readFile(filepath, 'utf-8');
  const raw = parse(content) as Partial<Recipe>;

  if (raw.base) {
    const base = await loadRecipe(raw.base);
    const merged = mergeRecipes(base, raw);
    assertRecipe(merged, filepath);
    return merged;
  }

  assertRecipe(raw, filepath);
  return raw;
}

export async function loadRecipe(name: string): Promise<Recipe> {
  const userPath = path.join(USER_DIR, `${name}.yaml`);
  if (await pathExists(userPath)) {
    return parseRecipeFile(userPath);
  }

  const builtinPath = path.join(BUILTIN_DIR, `${name}.yaml`);
  if (await pathExists(builtinPath)) {
    return parseRecipeFile(builtinPath);
  }

  throw new Error(`Recipe not found: ${name}`);
}

export async function listBuiltinRecipes(): Promise<Recipe[]> {
  const entries = await fs.readdir(BUILTIN_DIR);
  const yamlFiles = entries.filter((file) => file.endsWith('.yaml'));
  const recipes = await Promise.all(yamlFiles.map((file) => parseRecipeFile(path.join(BUILTIN_DIR, file))));
  return recipes.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listUserRecipes(): Promise<Recipe[]> {
  if (!(await pathExists(USER_DIR))) return [];
  const entries = await fs.readdir(USER_DIR);
  const yamlFiles = entries.filter((file) => file.endsWith('.yaml'));
  const recipes = await Promise.all(yamlFiles.map((file) => parseRecipeFile(path.join(USER_DIR, file))));
  return recipes.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveUserRecipe(recipe: Recipe): Promise<string> {
  await fs.mkdir(USER_DIR, { recursive: true });
  const filepath = path.join(USER_DIR, `${recipe.name}.yaml`);
  await fs.writeFile(filepath, stringify(recipe), 'utf-8');
  return filepath;
}

export function getUserRecipePath(name: string): string {
  return path.join(USER_DIR, `${name}.yaml`);
}
