/**
 * @module commands/setup
 * `abq-media setup` — configure API keys, defaults, and organization metadata.
 */

import fs from 'node:fs';
import path from 'node:path';

import { clack } from '../ui/prompts.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { getCredentialsPath, getGlobalDir, getProjectsDir, resolvePathFromCwd } from '../utils/paths.js';

interface SetupConfig {
  version: number;
  api: {
    llm: {
      provider: 'openrouter' | 'openai' | 'anthropic';
      apiKey: string;
      model?: string;
    };
    tts: {
      provider: 'elevenlabs';
      apiKey: string;
    };
  };
  defaults: {
    language: string;
    recipe: string;
    outputDir: string;
    voice: string;
    humanizer: string;
  };
  organization: {
    name: string;
    handles: {
      youtube?: string;
      instagram?: string;
      twitter?: string;
    };
  };
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function mask(v?: string): string {
  if (!v) return 'not configured';
  if (v.length <= 8) return 'configured';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function createDefaultConfig(): SetupConfig {
  return {
    version: 1,
    api: {
      llm: {
        provider: 'openrouter',
        apiKey: '',
        model: 'anthropic/claude-sonnet-4-20250514',
      },
      tts: {
        provider: 'elevenlabs',
        apiKey: '',
      },
    },
    defaults: {
      language: 'es',
      recipe: 'default',
      outputDir: getProjectsDir(),
      voice: 'Antoni',
      humanizer: 'abquanta',
    },
    organization: {
      name: '',
      handles: {},
    },
  };
}

function loadConfig(): SetupConfig {
  const current = readJson<SetupConfig>(getCredentialsPath());
  const legacyPath = path.join(getGlobalDir(), 'config.json');
  const legacy = readJson<SetupConfig>(legacyPath);
  if (!current && legacy) {
    clack.log.warn(`Legacy config found at ${legacyPath}.`);
    clack.log.warn('Please re-run setup to migrate into credentials.json.');
    return legacy;
  }
  return current ?? createDefaultConfig();
}

function saveConfig(config: SetupConfig): void {
  ensureDir(getGlobalDir());
  ensureDir(path.dirname(resolvePathFromCwd(config.defaults.outputDir)));
  writeJson(getCredentialsPath(), config);
}

function showConfig(config: SetupConfig): void {
  const resolvedOutput = resolvePathFromCwd(config.defaults.outputDir);
  clack.intro('Configuration');
  clack.log.info(`LLM: ${config.api.llm.provider} (${mask(config.api.llm.apiKey)})`);
  clack.log.info(`TTS: elevenlabs (${mask(config.api.tts.apiKey)})`);
  clack.log.info(`Language: ${config.defaults.language}`);
  clack.log.info(`Recipe: ${config.defaults.recipe}`);
  clack.log.info(`Output: ${config.defaults.outputDir} (resolved: ${resolvedOutput})`);
  clack.log.info(`Voice: ${config.defaults.voice}`);
  clack.log.info(`Humanizer: ${config.defaults.humanizer}`);
  clack.log.info(`Org: ${config.organization.name || 'not set'}`);
  clack.log.info(`Config file: ${getCredentialsPath()}`);
  clack.outro('Done');
}

async function configureApi(config: SetupConfig): Promise<SetupConfig> {
  const providerValue = await clack.select({
    message: 'LLM provider',
    options: [
      { value: 'openrouter', label: 'OpenRouter' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
    ],
    initialValue: config.api.llm.provider,
  }) as symbol | string;
  if (clack.isCancel(providerValue)) throw new Error('Cancelled by user');
  const provider = providerValue as SetupConfig['api']['llm']['provider'];

  const llmApiKeyValue = await clack.password({
    message: `${provider} API key`,
    validate: (v) => v.length > 8 ? undefined : 'Invalid key format',
  }) as symbol | string;
  if (clack.isCancel(llmApiKeyValue)) throw new Error('Cancelled by user');
  const llmApiKey = llmApiKeyValue as string;

  const ttsApiKeyValue = await clack.password({
    message: 'ElevenLabs API key',
    validate: (v) => v.length > 8 ? undefined : 'Invalid key format',
  }) as symbol | string;
  if (clack.isCancel(ttsApiKeyValue)) throw new Error('Cancelled by user');
  const ttsApiKey = ttsApiKeyValue as string;

  return {
    ...config,
    api: {
      llm: {
        ...config.api.llm,
        provider,
        apiKey: llmApiKey,
      },
      tts: {
        provider: 'elevenlabs',
        apiKey: ttsApiKey,
      },
    },
  };
}

async function configureDefaults(config: SetupConfig): Promise<SetupConfig> {
  const languageValue = await clack.text({
    message: 'Default language code',
    defaultValue: config.defaults.language,
    validate: (v) => v.trim() ? undefined : 'Language is required',
  }) as symbol | string;
  if (clack.isCancel(languageValue)) throw new Error('Cancelled by user');
  const language = languageValue as string;

  const recipeValue = await clack.text({
    message: 'Default recipe',
    defaultValue: config.defaults.recipe,
    validate: (v) => v.trim() ? undefined : 'Recipe is required',
  }) as symbol | string;
  if (clack.isCancel(recipeValue)) throw new Error('Cancelled by user');
  const recipe = recipeValue as string;

  const outputDirValue = await clack.text({
    message: 'Default output directory',
    defaultValue: config.defaults.outputDir,
    validate: (v) => v.trim() ? undefined : 'Output directory is required',
  }) as symbol | string;
  if (clack.isCancel(outputDirValue)) throw new Error('Cancelled by user');
  const outputDir = outputDirValue as string;

  const voiceValue = await clack.text({
    message: 'Default voice',
    defaultValue: config.defaults.voice,
    validate: (v) => v.trim() ? undefined : 'Voice is required',
  }) as symbol | string;
  if (clack.isCancel(voiceValue)) throw new Error('Cancelled by user');
  const voice = voiceValue as string;

  const humanizerValue = await clack.text({
    message: 'Default humanizer',
    defaultValue: config.defaults.humanizer,
    validate: (v) => v.trim() ? undefined : 'Humanizer is required',
  }) as symbol | string;
  if (clack.isCancel(humanizerValue)) throw new Error('Cancelled by user');
  const humanizer = humanizerValue as string;

  return {
    ...config,
    defaults: {
      language,
      recipe,
      outputDir,
      voice,
      humanizer,
    },
  };
}

async function configureOrganization(config: SetupConfig): Promise<SetupConfig> {
  const nameValue = await clack.text({
    message: 'Organization name',
    defaultValue: config.organization.name,
  }) as symbol | string;
  if (clack.isCancel(nameValue)) throw new Error('Cancelled by user');
  const name = nameValue as string;

  const youtubeValue = await clack.text({
    message: 'YouTube handle (optional)',
    defaultValue: config.organization.handles.youtube ?? '',
  }) as symbol | string;
  if (clack.isCancel(youtubeValue)) throw new Error('Cancelled by user');
  const youtube = youtubeValue as string;

  const instagramValue = await clack.text({
    message: 'Instagram handle (optional)',
    defaultValue: config.organization.handles.instagram ?? '',
  }) as symbol | string;
  if (clack.isCancel(instagramValue)) throw new Error('Cancelled by user');
  const instagram = instagramValue as string;

  const twitterValue = await clack.text({
    message: 'Twitter/X handle (optional)',
    defaultValue: config.organization.handles.twitter ?? '',
  }) as symbol | string;
  if (clack.isCancel(twitterValue)) throw new Error('Cancelled by user');
  const twitter = twitterValue as string;

  return {
    ...config,
    organization: {
      name,
      handles: {
        youtube: youtube || undefined,
        instagram: instagram || undefined,
        twitter: twitter || undefined,
      },
    },
  };
}

async function runFullSetup(): Promise<void> {
  let config = createDefaultConfig();
  clack.intro('Welcome to abq-media setup');
  config = await configureApi(config);
  config = await configureDefaults(config);
  config = await configureOrganization(config);
  ensureDir(resolvePathFromCwd(config.defaults.outputDir));
  saveConfig(config);
  clack.outro('Setup complete. Run: abq-media transform <source> --into <format>');
}

export async function cmdSetup(): Promise<void> {
  const configPath = getCredentialsPath();
  const show = hasFlag('--show');
  const reset = hasFlag('--reset');
  const api = hasFlag('--api');
  const defaults = hasFlag('--defaults');
  const org = hasFlag('--org');

  if (!fs.existsSync(configPath) || reset) {
    if (reset && fs.existsSync(configPath)) {
      const confirm = await clack.confirm({ message: 'Reset existing configuration?', initialValue: false });
      if (clack.isCancel(confirm) || !confirm) {
        clack.cancel('Aborted.');
        return;
      }
    }
    await runFullSetup();
    return;
  }

  let config = loadConfig();

  if (show) {
    showConfig(config);
    return;
  }

  if (api) {
    config = await configureApi(config);
    saveConfig(config);
    clack.outro('API settings updated.');
    return;
  }

  if (defaults) {
    config = await configureDefaults(config);
    ensureDir(resolvePathFromCwd(config.defaults.outputDir));
    saveConfig(config);
    clack.outro('Default settings updated.');
    return;
  }

  if (org) {
    config = await configureOrganization(config);
    saveConfig(config);
    clack.outro('Organization settings updated.');
    return;
  }

  const actionValue = await clack.select({
    message: 'What would you like to configure?',
    options: [
      { value: 'api', label: 'API keys' },
      { value: 'defaults', label: 'Default settings' },
      { value: 'org', label: 'Organization info' },
      { value: 'show', label: 'View current config' },
      { value: 'reset', label: 'Reset everything' },
    ],
  }) as symbol | string;
  if (clack.isCancel(actionValue)) {
    clack.cancel('Aborted.');
    return;
  }
  const action = actionValue as string;

  if (action === 'show') {
    showConfig(config);
    return;
  }

  if (action === 'reset') {
    await runFullSetup();
    return;
  }

  if (action === 'api') config = await configureApi(config);
  if (action === 'defaults') config = await configureDefaults(config);
  if (action === 'org') config = await configureOrganization(config);

  ensureDir(resolvePathFromCwd(config.defaults.outputDir));
  saveConfig(config);
  clack.outro('Configuration updated.');
}
