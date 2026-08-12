#!/bin/zsh

set -euo pipefail

RUNTIME_RUNNER="${KOTOVELA_SNAPSHOT_RUNTIME_RUNNER:-${HOME}/Library/Application Support/Kotovela/office-bridge-runtime/current/run-office-snapshot-sync.sh}"

if [[ ! -x "$RUNTIME_RUNNER" ]]; then
  echo "Error: detached snapshot sync runner is missing or not executable: ${RUNTIME_RUNNER}" >&2
  exit 66
fi

echo "Snapshot runtime writes are delegated to the detached office-bridge runtime."
exec "$RUNTIME_RUNNER"
