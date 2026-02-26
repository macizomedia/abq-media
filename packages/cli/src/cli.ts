#!/usr/bin/env node

/**
 * @abquanta/abq-media-cli
 * Entry point for redesigned command surface.
 */

import { cmdSetup } from './commands/setup.js';
import { cmdTransform } from './commands/transform.js';
import { cmdRecipes } from './commands/recipes.js';
import { cmdProjects } from './commands/projects.js';
import { cmdPrompts } from './commands/prompts.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdHello } from './commands/hello.js';
import { cmdRun } from './commands/run.js';
import { cmdInit } from './commands/init.js';
import { cmdReset } from './commands/reset.js';

function printHelp(): void {
  console.log(`
  Usage: abq-media <command> [subcommand] [options]

  Commands:
    init       Configure global credentials and project profile
    setup      Configure API keys and defaults
    run        Guided interactive flow (state machine)
    reset      Reset local project data or credentials
    transform  Transform content into artifacts
    recipes    List/create/edit recipes
    projects   List/open/export/continue projects
    prompts    List/show/edit/reset AI prompts
    doctor     Check environment readiness
    hello      Print a greeting

  Global options:
    --help     Show this help message
    --version  Show version

  Transform options:
    <source>                  URL, file path, or text
    --into <format>           transcript | research | podcast | article | …
    --using <recipe>          Recipe name (default: auto-selected)
    --lang <code>             BCP-47 language code (default: es)
    --name <project-name>     Override project directory name
    --output <dir>            Override output root directory
    --dry-run                 Plan only, skip execution

  yt-dlp options (YouTube sources):
    --simulate                Probe only — no downloads (metadata report)
    --ytdlp-verbose           Increase yt-dlp verbosity (verbose)
    --ytdlp-debug             Maximum yt-dlp verbosity (debug + traffic)
    --ytdlp-quiet             Suppress yt-dlp output
    --ytdlp-format <sel>      yt-dlp format selector (e.g. "bestaudio")
    --ytdlp-audio-format <f>  Post-process audio format (mp3|wav|opus|aac|flac)
    --ytdlp-sub-format <f>    Subtitle format (vtt|srt|ass|best)
    --ytdlp-sub-langs <list>  Subtitle languages, comma-separated (e.g. "en,es")
    --cookies <path>          Netscape cookie file for yt-dlp
    --cookies-from-browser <b> Extract cookies from browser (chrome|firefox|safari|edge|brave)
    --proxy <url>             HTTP/SOCKS proxy for yt-dlp
    --rate-limit <rate>       Download rate limit (e.g. "50K", "4.2M")
    --force-ipv4              Force IPv4 connections
    --geo-bypass              Bypass geographic restrictions

  Environment variables (yt-dlp):
    YTDLP_VERBOSITY           quiet | normal | verbose | debug
    YTDLP_SIMULATE=1          Enable simulate mode
    YTDLP_COOKIES             Path to cookies file
    YTDLP_COOKIES_FROM_BROWSER Browser name (chrome, firefox, safari, …)
    YTDLP_PROXY               Proxy URL
    YTDLP_RATE_LIMIT          Rate limit string
    YTDLP_AUDIO_FORMAT        Audio format override
    YTDLP_SUBTITLE_FORMAT     Subtitle format override

  Examples:
    abq-media setup
    abq-media transform "https://youtube.com/watch?v=xyz" --into podcast
    abq-media transform "https://youtube.com/watch?v=xyz" --simulate
    abq-media transform "https://youtube.com/watch?v=xyz" --into transcript --ytdlp-verbose
    abq-media transform "https://youtube.com/watch?v=xyz" --into podcast --cookies ~/cookies.txt    abq-media transform \"https://youtube.com/watch?v=xyz\" --into podcast --cookies-from-browser chrome    abq-media recipes list
    abq-media projects open my-project-2026-02-23
    abq-media prompts edit research
    abq-media hello --name "World"
`);
}

const command = process.argv[2];

switch (command) {
  case 'setup':
    await cmdSetup();
    break;
  case 'init':
    await cmdInit();
    break;
  case 'run':
    await cmdRun();
    break;
  case 'reset':
    await cmdReset();
    break;
  case 'transform':
    await cmdTransform();
    break;
  case 'recipes':
    await cmdRecipes();
    break;
  case 'projects':
    await cmdProjects();
    break;
  case 'prompts':
    await cmdPrompts();
    break;
  case 'doctor':
    await cmdDoctor();
    break;
  case 'hello':
    await cmdHello();
    break;
  case '--help':
  case '-h':
    printHelp();
    break;
  case '--version':
  case '-v':
    console.log('0.1.0');
    break;
  default:
    printHelp();
    break;
}
