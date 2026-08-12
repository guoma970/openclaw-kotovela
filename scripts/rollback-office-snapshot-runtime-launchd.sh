#!/bin/zsh

set -euo pipefail

RUNTIME_ROOT="${KOTOVELA_OFFICE_BRIDGE_RUNTIME_ROOT:-${HOME}/Library/Application Support/Kotovela/office-bridge-runtime}"
RELEASES_DIR="${RUNTIME_ROOT}/releases"
SNAPSHOT_CURRENT_LINK="${RUNTIME_ROOT}/snapshot-current"
STATE_SNAPSHOT="${RUNTIME_ROOT}/state/data/office-instances.snapshot.json"
SYNC_SNAPSHOT="${HOME}/06-builder/kotovela/kotovela-workbench-sync/data/office-instances.snapshot.json"
LABEL="com.kotovela.office-snapshot-sync"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
USER_DOMAIN="gui/$(id -u)"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-launchctl}"
TARGET_RELEASE="${1:-}"

if [[ -z "$TARGET_RELEASE" || "$TARGET_RELEASE" == "--list" ]]; then
  echo "Available snapshot releases:"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d \
    -exec test -f '{}/run-office-snapshot-sync.sh' ';' -print 2>/dev/null | sort
  [[ "$TARGET_RELEASE" == "--list" ]] && exit 0
  echo "Usage: $0 <release-id>" >&2
  exit 64
fi

if [[ "$TARGET_RELEASE" == */* || "$TARGET_RELEASE" == .* ]]; then
  echo "Error: release id must be a single directory name." >&2
  exit 64
fi

TARGET_DIR="${RELEASES_DIR}/${TARGET_RELEASE}"
for required_file in manifest.txt export-office-snapshot.mjs run-office-snapshot-sync.sh; do
  if [[ ! -f "${TARGET_DIR}/${required_file}" ]]; then
    echo "Error: snapshot release is incomplete: ${TARGET_DIR}/${required_file}" >&2
    exit 66
  fi
done

if [[ ! -L "$SNAPSHOT_CURRENT_LINK" ]]; then
  echo "Error: snapshot-current is not a symlink: ${SNAPSHOT_CURRENT_LINK}" >&2
  exit 73
fi

PREVIOUS_TARGET="$(readlink "$SNAPSHOT_CURRENT_LINK")"
if [[ "$PREVIOUS_TARGET" == "$TARGET_DIR" ]]; then
  echo "Snapshot runtime is already on release: ${TARGET_RELEASE}"
  exit 0
fi

switch_snapshot_current() {
  local target="$1"
  local next_link="${RUNTIME_ROOT}/.snapshot-current.rollback.$$"
  ln -s "$target" "$next_link"
  mv -f -h "$next_link" "$SNAPSHOT_CURRENT_LINK"
}

run_and_verify() {
  local attempt
  local service_state
  local last_exit

  "$LAUNCHCTL_BIN" kickstart -k "${USER_DOMAIN}/${LABEL}"
  for attempt in {1..60}; do
    service_state="$("$LAUNCHCTL_BIN" print "${USER_DOMAIN}/${LABEL}" 2>/dev/null | awk -F'= ' '/^[[:space:]]*state = /{gsub(/[[:space:]]/,"",$2); print $2; exit}')"
    last_exit="$("$LAUNCHCTL_BIN" print "${USER_DOMAIN}/${LABEL}" 2>/dev/null | awk -F'= ' '/^[[:space:]]*last exit code = /{gsub(/[[:space:]]/,"",$2); print $2; exit}')"
    if [[ "$service_state" == "notrunning" && "$last_exit" == "0" ]]; then
      break
    fi
    if [[ "$service_state" == "notrunning" && -n "$last_exit" && "$last_exit" != "0" ]]; then
      return 1
    fi
    sleep 1
  done

  [[ "$service_state" == "notrunning" && "$last_exit" == "0" ]]
  [[ -f "$STATE_SNAPSHOT" && -f "$SYNC_SNAPSHOT" ]]
  cmp -s "$STATE_SNAPSHOT" "$SYNC_SNAPSHOT"
}

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "Error: snapshot LaunchAgent plist is missing: ${PLIST_PATH}" >&2
  exit 66
fi

switch_snapshot_current "$TARGET_DIR"
if ! run_and_verify; then
  echo "Error: snapshot release failed; restoring the previous snapshot release." >&2
  switch_snapshot_current "$PREVIOUS_TARGET"
  run_and_verify || echo "Error: previous snapshot release also failed; inspect launchd immediately." >&2
  exit 1
fi

echo "Rolled back Kotovela snapshot runtime:"
echo "  ${SNAPSHOT_CURRENT_LINK} -> ${TARGET_DIR}"
