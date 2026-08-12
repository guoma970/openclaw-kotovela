#!/bin/zsh

set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${OFFICE_READONLY_GATEWAY_ENV_FILE:-${HOME}/.config/kotovela/office-readonly-gateway.env}"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: read-only gateway environment file is missing: ${ENV_FILE}" >&2
  exit 78
fi

if [[ "$(stat -f '%Lp' "$ENV_FILE")" != "600" ]]; then
  echo "Error: read-only gateway environment file must have mode 600: ${ENV_FILE}" >&2
  exit 77
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

export OFFICE_READONLY_GATEWAY_PORT="${OFFICE_READONLY_GATEWAY_PORT:-8791}"
export OFFICE_READONLY_GATEWAY_HOST="${OFFICE_READONLY_GATEWAY_HOST:-127.0.0.1}"
export OFFICE_READONLY_GATEWAY_UPSTREAM_ORIGIN="${OFFICE_READONLY_GATEWAY_UPSTREAM_ORIGIN:-http://127.0.0.1:8787}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

exec "$NODE_BIN" "$RUNTIME_DIR/office-readonly-gateway.mjs"
