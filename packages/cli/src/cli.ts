#!/usr/bin/env node

/**
 * @abquanta/abq-media-cli
 *
 * Entry point — parses argv and dispatches to command handlers.
 *
 * All four commands are now implemented in TypeScript modules.
 * The monolith (cli.monolith.js) is no longer invoked at runtime.
 */

import { cmdInit } from './commands/init.js';
import { cmdRun } from './commands/run.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdReset } from './commands/reset.js';

function printHelp(): void {
  console.log(`
  Usage: abq-media <command> [options]

  Commands:
    init       Initialize a new project
    run        Run the content pipeline (state machine)
    doctor     Check environment readiness
    reset      Remove project data or credentials

  Run Options:
    --resume <checkpoint.json>   Resume from a checkpoint
    --from <STATE>               Start from a specific state (debug)
    --project <name>             Project name (default: "default")
    --lang <code>                Language code (default: "es")
    --debugger                   Use sample artifacts, no checkpoints

  Options:
    --help     Show this help message
    --version  Show version
`);
}

const command = process.argv[2];

switch (command) {
  case 'init':
    await cmdInit();
    break;
  case 'run':
    await cmdRun();
    break;
  case 'doctor':
    await cmdDoctor();
    break;
  case 'reset':
    await cmdReset();
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
