/**
 * @module commands/recipes
 * `abq-media recipes` command family.
 */

import { spawnSync } from 'node:child_process';

import { clack } from '../ui/prompts.js';
import { getUserRecipePath, listBuiltinRecipes, listUserRecipes, loadRecipe, saveUserRecipe } from '../recipes/loader.js';
import type { Recipe, RecipeStageName } from '../recipes/types.js';

function subcommand(): string {
  return process.argv[3] || 'list';
}

function argAt(index: number): string {
  return process.argv[index] || '';
}

function defaultRecipe(name: string): Recipe {
  return {
    name,
    version: 1,
    description: `Custom recipe: ${name}`,
    stages: [
      { name: 'transcript', enabled: true },
      { name: 'research-prompt', enabled: true },
      { name: 'research', enabled: true },
      { name: 'script', enabled: true },
      { name: 'tts', enabled: true },
    ],
  };
}

async function listRecipes(): Promise<void> {
  const builtin = await listBuiltinRecipes();
  const custom = await listUserRecipes();

  clack.intro('Recipes');
  clack.log.info('Built-in:');
  for (const recipe of builtin) {
    clack.log.message(`  ${recipe.name.padEnd(16)} ${recipe.description ?? ''}`);
  }
  clack.log.info('Custom:');
  if (!custom.length) {
    clack.log.message('  (none)');
  }
  for (const recipe of custom) {
    clack.log.message(`  ${recipe.name.padEnd(16)} ${recipe.description ?? ''}`);
  }
  clack.outro(`${builtin.length} built-in, ${custom.length} custom recipes`);
}

async function createRecipe(): Promise<void> {
  const nameValue = await clack.text({
    message: 'Recipe name',
    validate: (v) => /^[a-z0-9-]+$/.test(v) ? undefined : 'Use lowercase, numbers, hyphens only',
  }) as symbol | string;
  if (clack.isCancel(nameValue)) {
    clack.cancel('Aborted.');
    return;
  }
  const name = nameValue as string;

  const baseValue = await clack.select({
    message: 'Start from',
    options: [
      { value: 'default', label: 'Full pipeline (default)' },
      { value: 'quick', label: 'Quick (no research)' },
      { value: 'scratch', label: 'Blank recipe' },
    ],
  }) as symbol | string;
  if (clack.isCancel(baseValue)) {
    clack.cancel('Aborted.');
    return;
  }
  const base = baseValue as string;

  const enabledValue = await clack.multiselect({
    message: 'Enable stages',
    options: [
      { value: 'transcript', label: 'Transcription', hint: 'required for media inputs' },
      { value: 'research-prompt', label: 'Research prompt' },
      { value: 'research', label: 'Research execution' },
      { value: 'script', label: 'Script generation' },
      { value: 'tts', label: 'Text-to-speech' },
      { value: 'article', label: 'Article generation' },
      { value: 'translate', label: 'Translation' },
      { value: 'video-script', label: 'Video script' },
    ],
    initialValues: ['transcript'],
  }) as symbol | string[];
  if (clack.isCancel(enabledValue)) {
    clack.cancel('Aborted.');
    return;
  }
  const enabled = enabledValue as RecipeStageName[];

  let recipe: Recipe;
  if (base === 'scratch') {
    recipe = {
      name,
      version: 1,
      description: `Custom recipe: ${name}`,
      stages: enabled.map((stage) => ({ name: stage, enabled: true })),
    };
  } else {
    const parent = await loadRecipe(base);
    recipe = {
      ...defaultRecipe(name),
      base,
      stages: parent.stages.map((stage) => ({ ...stage, enabled: enabled.includes(stage.name) })),
    };
  }

  const filepath = await saveUserRecipe(recipe);
  clack.log.success(`Recipe saved: ${filepath}`);
  clack.log.info(`Edit manually: ${filepath}`);
  clack.outro('Done');
}

async function editRecipe(name: string): Promise<void> {
  if (!name) {
    clack.log.error('Usage: abq-media recipes edit <name>');
    process.exitCode = 1;
    return;
  }

  await loadRecipe(name);
  const filepath = getUserRecipePath(name);
  const editor = process.env.EDITOR || 'vi';
  const res = spawnSync(editor, [filepath], { stdio: 'inherit' });
  if (res.status !== 0) {
    clack.log.error(`Editor exited with status ${res.status ?? 'unknown'}`);
    process.exitCode = 1;
    return;
  }
  clack.outro(`Updated recipe: ${filepath}`);
}

export async function cmdRecipes(): Promise<void> {
  const sub = subcommand();

  if (sub === 'list') {
    await listRecipes();
    return;
  }

  if (sub === 'create') {
    await createRecipe();
    return;
  }

  if (sub === 'edit') {
    await editRecipe(argAt(4));
    return;
  }

  clack.log.error(`Unknown recipes subcommand: ${sub}`);
  clack.log.info('Use: abq-media recipes [list|create|edit <name>]');
  process.exitCode = 1;
}
