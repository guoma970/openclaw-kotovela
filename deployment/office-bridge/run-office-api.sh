#!/bin/zsh

set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${OFFICE_API_ENV_FILE:-${HOME}/.config/kotovela/office-api.env}"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: office API environment file is missing: ${ENV_FILE}" >&2
  exit 78
fi

if [[ "$(stat -f '%Lp' "$ENV_FILE")" != "600" ]]; then
  echo "Error: office API environment file must have mode 600: ${ENV_FILE}" >&2
  exit 77
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

export OFFICE_API_PORT="${OFFICE_API_PORT:-8787}"
export OFFICE_API_HOST="${OFFICE_API_HOST:-127.0.0.1}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

exec "$NODE_BIN" "$RUNTIME_DIR/office-api-server.mjs"
