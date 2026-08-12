#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Snapshot sync is installed as part of the detached office-bridge runtime."
exec "${SCRIPT_DIR}/install-office-bridge-runtime-launchd.sh"
