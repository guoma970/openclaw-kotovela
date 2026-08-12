#!/bin/zsh

set -euo pipefail

ENV_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_ENV_FILE:-${HOME}/.config/kotovela/cloudflare-readonly-tunnel.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: Cloudflare Tunnel environment file is missing: ${ENV_FILE}" >&2
  exit 78
fi

if [[ "$(stat -f '%Lp' "$ENV_FILE")" != "600" ]]; then
  echo "Error: Cloudflare Tunnel environment file must have mode 600: ${ENV_FILE}" >&2
  exit 77
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-/opt/homebrew/bin/cloudflared}"
SERVICE_URL="${KOTOVELA_CLOUDFLARE_SERVICE_URL:-http://127.0.0.1:8791}"
TOKEN_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN_FILE:-${HOME}/.config/kotovela/cloudflare-readonly-tunnel.token}"
TUNNEL_PROTOCOL="${KOTOVELA_CLOUDFLARE_TUNNEL_PROTOCOL:-http2}"

if [[ -n "${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "Error: inline Cloudflare Tunnel tokens are not accepted by the runtime." >&2
  exit 78
fi

if [[ ! -x "$CLOUDFLARED_BIN" ]]; then
  echo "Error: cloudflared is not executable: ${CLOUDFLARED_BIN}" >&2
  exit 69
fi

if [[ ! -f "$TOKEN_FILE" || "$(stat -f '%Lp' "$TOKEN_FILE")" != "600" ]]; then
  echo "Error: Cloudflare Tunnel token file is missing or not mode 600: ${TOKEN_FILE}" >&2
  exit 77
fi

exec "$CLOUDFLARED_BIN" tunnel \
  --config /dev/null \
  --protocol "$TUNNEL_PROTOCOL" \
  --edge-ip-version 4 \
  --metrics 127.0.0.1:0 \
  --no-autoupdate \
  run \
  --url "$SERVICE_URL" \
  --token-file "$TOKEN_FILE"
