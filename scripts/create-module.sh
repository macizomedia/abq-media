#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/create-module.sh pipeline-youtube-research-podcast "YouTube -> research -> podcast pipeline module"

NAME="${1:-}"
DESC="${2:-Abquanta module}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <module-name> [description]"
  exit 1
fi

node ./packages/create-abq-module/src/cli.js --name "$NAME" --description "$DESC" --repo-name "$NAME"
