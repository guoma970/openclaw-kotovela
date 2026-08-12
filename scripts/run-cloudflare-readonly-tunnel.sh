#!/bin/zsh

set -euo pipefail

ENV_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_ENV_FILE:-${HOME}/.config/kotovela/cloudflare-readonly-tunnel.env}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

TUNNEL_NAME="${KOTOVELA_CLOUDFLARE_TUNNEL_NAME:-kotovela-office-readonly}"
SERVICE_URL="${KOTOVELA_CLOUDFLARE_SERVICE_URL:-http://127.0.0.1:8791}"
TOKEN_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN_FILE:-${HOME}/.config/kotovela/cloudflare-readonly-tunnel.token}"
LEGACY_INLINE_TOKEN="${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN:-}"
TUNNEL_PROTOCOL="${KOTOVELA_CLOUDFLARE_TUNNEL_PROTOCOL:-http2}"

if ! command -v "$CLOUDFLARED_BIN" >/dev/null 2>&1; then
  echo "Error: cloudflared is not installed or not on PATH." >&2
  exit 69
fi

if [[ -n "$LEGACY_INLINE_TOKEN" ]]; then
  echo "Error: inline Cloudflare Tunnel tokens are no longer accepted by the runner." >&2
  echo "Run ./scripts/install-cloudflare-readonly-tunnel-launchd.sh once to migrate the token to ${TOKEN_FILE}." >&2
  exit 78
fi

if [[ -f "$TOKEN_FILE" ]]; then
  TOKEN_FILE_MODE="$(stat -f '%Lp' "$TOKEN_FILE")"
  if [[ "$TOKEN_FILE_MODE" != "600" ]]; then
    echo "Error: tunnel token file must have mode 600: ${TOKEN_FILE}" >&2
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
fi

exec "$CLOUDFLARED_BIN" tunnel \
  --protocol "$TUNNEL_PROTOCOL" \
  --edge-ip-version 4 \
  --no-autoupdate \
  --url "$SERVICE_URL" \
  run "$TUNNEL_NAME"
