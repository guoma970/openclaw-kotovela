#!/bin/zsh

set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_ROOT="${KOTOVELA_OFFICE_BRIDGE_STATE_ROOT:-${HOME}/Library/Application Support/Kotovela/office-bridge-runtime/state}"
SYNC_REPLICA="${KOTOVELA_SNAPSHOT_SYNC_REPO:-${HOME}/06-builder/kotovela/kotovela-workbench-sync}"
NODE_BIN="${NODE_BIN:-}"
SNAPSHOT_REL="data/office-instances.snapshot.json"
STAGING_SNAPSHOT="${STATE_ROOT}/.office-instances.snapshot.staging.$$"
RUNTIME_SNAPSHOT="${STATE_ROOT}/${SNAPSHOT_REL}"
SYNC_SNAPSHOT="${SYNC_REPLICA}/${SNAPSHOT_REL}"

export PATH="${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Error: node is not installed or not executable." >&2
  exit 69
fi

if [[ ! -f "${RUNTIME_DIR}/export-office-snapshot.mjs" ]]; then
  echo "Error: bundled snapshot exporter is missing." >&2
  exit 66
fi

mkdir -p "$(dirname "$RUNTIME_SNAPSHOT")" "$(dirname "$SYNC_SNAPSHOT")"
OFFICE_SNAPSHOT_OUTPUT_PATH="$STAGING_SNAPSHOT" "$NODE_BIN" "${RUNTIME_DIR}/export-office-snapshot.mjs"

INSTANCE_COUNT="$(/usr/bin/python3 - "$STAGING_SNAPSHOT" <<'PY'
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    payload = json.load(handle)

print(len(payload.get('instances', [])))
PY
)"

if [[ "$INSTANCE_COUNT" -lt 6 ]]; then
  echo "Warning: snapshot export produced ${INSTANCE_COUNT} instances; preserving the existing runtime snapshot." >&2
  unlink "$STAGING_SNAPSHOT"
else
  chmod 600 "$STAGING_SNAPSHOT"
  mv "$STAGING_SNAPSHOT" "$RUNTIME_SNAPSHOT"
  cp "$RUNTIME_SNAPSHOT" "$SYNC_SNAPSHOT"
fi

if [[ "$INSTANCE_COUNT" -lt 6 ]]; then
  echo "Snapshot preserved: ${INSTANCE_COUNT} current instances did not meet the 6-instance promotion gate"
else
  echo "Snapshot refreshed: ${INSTANCE_COUNT} instances"
fi
echo "Runtime snapshot: ${RUNTIME_SNAPSHOT}"
echo "Sync replica: ${SYNC_SNAPSHOT}"
