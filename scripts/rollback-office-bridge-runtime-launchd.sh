#!/bin/zsh

set -euo pipefail

RUNTIME_ROOT="${KOTOVELA_OFFICE_BRIDGE_RUNTIME_ROOT:-${HOME}/Library/Application Support/Kotovela/office-bridge-runtime}"
RELEASES_DIR="${RUNTIME_ROOT}/releases"
CURRENT_LINK="${RUNTIME_ROOT}/current"
AGENT_DIR="${HOME}/Library/LaunchAgents"
USER_DOMAIN="gui/$(id -u)"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-launchctl}"
TARGET_RELEASE="${1:-}"
LABELS=(
  com.kotovela.office-api
  com.kotovela.office-readonly-gateway
  com.kotovela.cloudflare-readonly-tunnel
)

if [[ -z "$TARGET_RELEASE" || "$TARGET_RELEASE" == "--list" ]]; then
  echo "Available releases:"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort
  [[ "$TARGET_RELEASE" == "--list" ]] && exit 0
  echo "Usage: $0 <release-id>" >&2
  exit 64
fi

if [[ "$TARGET_RELEASE" == */* || "$TARGET_RELEASE" == .* ]]; then
  echo "Error: release id must be a single directory name." >&2
  exit 64
fi

TARGET_DIR="${RELEASES_DIR}/${TARGET_RELEASE}"
if [[ ! -d "$TARGET_DIR" || ! -f "${TARGET_DIR}/manifest.txt" ]]; then
  echo "Error: release does not exist or has no manifest: ${TARGET_DIR}" >&2
  exit 66
fi

for required_file in office-api-server.mjs office-readonly-gateway.mjs run-office-api.sh run-office-readonly-gateway.sh run-cloudflare-readonly-tunnel.sh; do
  if [[ ! -f "${TARGET_DIR}/${required_file}" ]]; then
    echo "Error: release is incomplete: ${TARGET_DIR}/${required_file}" >&2
    exit 65
  fi
done

if [[ ! -L "$CURRENT_LINK" ]]; then
  echo "Error: current runtime is not a symlink: ${CURRENT_LINK}" >&2
  exit 73
fi

PREVIOUS_TARGET="$(readlink "$CURRENT_LINK")"
if [[ "$PREVIOUS_TARGET" == "$TARGET_DIR" ]]; then
  echo "Runtime is already on release: ${TARGET_RELEASE}"
  exit 0
fi

switch_current() {
  local target="$1"
  local next_link="${RUNTIME_ROOT}/.current.rollback.$$"
  ln -s "$target" "$next_link"
  mv -f "$next_link" "$CURRENT_LINK"
}

restart_all() {
  local label
  local plist_path
  for label in "${LABELS[@]}"; do
    plist_path="${AGENT_DIR}/${label}.plist"
    "$LAUNCHCTL_BIN" bootout "$USER_DOMAIN" "$plist_path" 2>/dev/null || true
    "$LAUNCHCTL_BIN" bootout "${USER_DOMAIN}/${label}" 2>/dev/null || true
    "$LAUNCHCTL_BIN" bootstrap "$USER_DOMAIN" "$plist_path" || return $?
    "$LAUNCHCTL_BIN" kickstart -k "${USER_DOMAIN}/${label}" || return $?
  done
}

verify_all() {
  local label
  sleep 2
  for label in "${LABELS[@]}"; do
    "$LAUNCHCTL_BIN" print "${USER_DOMAIN}/${label}" | rg -q 'state = running' || return $?
  done
  curl -fsS http://127.0.0.1:8791/healthz >/dev/null || return $?
}

switch_current "$TARGET_DIR"
if ! restart_all || ! verify_all; then
  echo "Error: rollback target failed to start; restoring previous release." >&2
  switch_current "$PREVIOUS_TARGET"
  restart_all && verify_all || echo "Error: previous release also failed to restart; inspect launchd immediately." >&2
  exit 1
fi

echo "Rolled back Kotovela office bridge runtime:"
echo "  ${CURRENT_LINK} -> ${TARGET_DIR}"
