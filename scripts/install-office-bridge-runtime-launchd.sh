#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOYMENT_ROOT="${SOURCE_ROOT}/deployment/office-bridge"
RUNTIME_ROOT="${KOTOVELA_OFFICE_BRIDGE_RUNTIME_ROOT:-${HOME}/Library/Application Support/Kotovela/office-bridge-runtime}"
RELEASES_DIR="${RUNTIME_ROOT}/releases"
STATE_ROOT="${RUNTIME_ROOT}/state"
BACKUPS_DIR="${RUNTIME_ROOT}/backups"
CURRENT_LINK="${RUNTIME_ROOT}/current"
LOG_DIR="${KOTOVELA_OFFICE_BRIDGE_LOG_DIR:-${HOME}/Library/Logs/Kotovela/office-bridge}"
CONFIG_DIR="${HOME}/.config/kotovela"
AGENT_DIR="${HOME}/Library/LaunchAgents"
USER_DOMAIN="gui/$(id -u)"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-launchctl}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
ESBUILD_BIN="${ESBUILD_BIN:-${SOURCE_ROOT}/node_modules/.bin/esbuild}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
OFFICE_API_ENV_FILE="${OFFICE_API_ENV_FILE:-${CONFIG_DIR}/office-api.env}"
GATEWAY_ENV_FILE="${OFFICE_READONLY_GATEWAY_ENV_FILE:-${CONFIG_DIR}/office-readonly-gateway.env}"
TUNNEL_ENV_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_ENV_FILE:-${CONFIG_DIR}/cloudflare-readonly-tunnel.env}"
TUNNEL_TOKEN_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN_FILE:-${CONFIG_DIR}/cloudflare-readonly-tunnel.token}"
INPUT_TUNNEL_TOKEN_FILE="${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN_FILE:-}"
INPUT_TUNNEL_NAME="${KOTOVELA_CLOUDFLARE_TUNNEL_NAME:-}"
INPUT_TUNNEL_HOSTNAME="${KOTOVELA_CLOUDFLARE_HOSTNAME:-}"
INPUT_TUNNEL_SERVICE_URL="${KOTOVELA_CLOUDFLARE_SERVICE_URL:-}"
INPUT_TUNNEL_PROTOCOL="${KOTOVELA_CLOUDFLARE_TUNNEL_PROTOCOL:-}"
INPUT_TUNNEL_TOKEN="${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN:-}"
INPUT_REPLACE_TOKEN="${KOTOVELA_CLOUDFLARE_REPLACE_TUNNEL_TOKEN_FILE:-}"
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
RELEASE_ID="${KOTOVELA_OFFICE_BRIDGE_RELEASE_ID:-$(date -u '+%Y%m%dT%H%M%SZ')-${SOURCE_COMMIT[1,12]}}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
STAGING_DIR="${RELEASES_DIR}/.${RELEASE_ID}.staging.$$"
BACKUP_DIR="${BACKUPS_DIR}/$(date -u '+%Y%m%dT%H%M%SZ')"
PREVIOUS_TARGET=""
SWITCHED_CURRENT=0
INSTALLING=0

LABELS=(
  com.kotovela.office-api
  com.kotovela.office-readonly-gateway
  com.kotovela.cloudflare-readonly-tunnel
)

OFFICE_API_KEYS=(
  OFFICE_API_PORT
  OFFICE_API_HOST
  OFFICE_API_TOKEN
  OFFICE_API_CORS_ORIGIN
  MODEL_USAGE_CACHE_MS
  KOTOVELA_PUBLIC_ORIGIN
  KOTOVELA_ACCESS_SECRET
  XIGUO_LINK_SECRET
  XIGUO_API_KEY
  FEISHU_STUDY_ACCOUNT
  FEISHU_STUDY_ASSIGN_CHAT_ID
  FEISHU_STUDY_COLLAB_CHAT_ID
)

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

shell_quote() {
  local value="$1"
  printf "'%s'" "${value//\'/\'\\\'\'}"
}

plist_env_value() {
  local plist_path="$1"
  local key="$2"
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:${key}" "$plist_path" 2>/dev/null || true
}

write_export() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  [[ -n "$value" ]] || return 0
  printf 'export %s=%s\n' "$key" "$(shell_quote "$value")" >> "$file_path"
}

seed_file_once() {
  local source_path="$1"
  local target_path="$2"
  [[ -f "$source_path" ]] || return 0
  [[ ! -e "$target_path" ]] || return 0
  mkdir -p "$(dirname "$target_path")"
  cp "$source_path" "$target_path"
}

write_service_plist() {
  local label="$1"
  local runner="$2"
  local log_name="$3"
  local target_path="$4"

  cat > "$target_path" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$label")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$(xml_escape "${CURRENT_LINK}/${runner}")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$CURRENT_LINK")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "${LOG_DIR}/${log_name}.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "${LOG_DIR}/${log_name}.error.log")</string>
</dict>
</plist>
EOF_PLIST
  plutil -lint "$target_path" >/dev/null
  chmod 600 "$target_path"
}

start_agent() {
  local label="$1"
  local plist_path="${AGENT_DIR}/${label}.plist"
  "$LAUNCHCTL_BIN" bootout "$USER_DOMAIN" "$plist_path" 2>/dev/null || true
  "$LAUNCHCTL_BIN" bootout "${USER_DOMAIN}/${label}" 2>/dev/null || true
  "$LAUNCHCTL_BIN" bootstrap "$USER_DOMAIN" "$plist_path"
  "$LAUNCHCTL_BIN" enable "${USER_DOMAIN}/${label}" >/dev/null 2>&1 || true
  "$LAUNCHCTL_BIN" kickstart -k "${USER_DOMAIN}/${label}"
}

wait_agent_running() {
  local label="$1"
  local attempt
  for attempt in {1..45}; do
    if "$LAUNCHCTL_BIN" print "${USER_DOMAIN}/${label}" 2>/dev/null | rg -q 'state = running'; then
      return 0
    fi
    sleep 1
  done
  echo "Error: launchd service did not reach running state within 45 seconds: ${label}" >&2
  return 1
}

verify_runtime() {
  local api_url="http://${OFFICE_API_HOST:-127.0.0.1}:${OFFICE_API_PORT:-8787}/api/office-instances"
  local gateway_url="http://${OFFICE_READONLY_GATEWAY_HOST:-127.0.0.1}:${OFFICE_READONLY_GATEWAY_PORT:-8791}"
  local response_file
  local status

  for label in "${LABELS[@]}"; do
    wait_agent_running "$label"
  done

  response_file="$(mktemp /tmp/kotovela-office-api-verify.XXXXXX)"
  status="$(curl --retry 5 --retry-all-errors --connect-timeout 3 --max-time 15 -sS -o "$response_file" -w '%{http_code}' -H "Authorization: Bearer ${OFFICE_API_TOKEN}" "$api_url")"
  unlink "$response_file"
  [[ "$status" == "200" ]]

  response_file="$(mktemp /tmp/kotovela-office-gateway-verify.XXXXXX)"
  status="$(curl --retry 5 --retry-all-errors --connect-timeout 3 --max-time 15 -sS -o "$response_file" -w '%{http_code}' "${gateway_url}/healthz")"
  unlink "$response_file"
  [[ "$status" == "200" ]]

  response_file="$(mktemp /tmp/kotovela-office-gateway-auth-verify.XXXXXX)"
  status="$(curl --retry 5 --retry-all-errors --connect-timeout 3 --max-time 15 -sS -o "$response_file" -w '%{http_code}' -H "Authorization: Bearer ${OFFICE_READONLY_GATEWAY_TOKEN}" "${gateway_url}/api/office-instances")"
  unlink "$response_file"
  [[ "$status" == "200" ]]
}

restore_previous_runtime() {
  set +e
  for label in "${LABELS[@]}"; do
    "$LAUNCHCTL_BIN" bootout "${USER_DOMAIN}/${label}" 2>/dev/null
  done

  if [[ "$SWITCHED_CURRENT" == "1" ]]; then
    if [[ -n "$PREVIOUS_TARGET" ]]; then
      local rollback_link="${RUNTIME_ROOT}/.current.rollback.$$"
      ln -s "$PREVIOUS_TARGET" "$rollback_link"
      mv -f "$rollback_link" "$CURRENT_LINK"
    elif [[ -L "$CURRENT_LINK" ]]; then
      unlink "$CURRENT_LINK"
    fi
  fi

  if [[ "$INSTALLING" == "1" ]]; then
    for label in "${LABELS[@]}"; do
      local saved_plist="${BACKUP_DIR}/${label}.plist"
      local live_plist="${AGENT_DIR}/${label}.plist"
      if [[ -f "$saved_plist" ]]; then
        cp "$saved_plist" "$live_plist"
        "$LAUNCHCTL_BIN" bootstrap "$USER_DOMAIN" "$live_plist" 2>/dev/null
      elif [[ -f "${BACKUP_DIR}/${label}.missing" && -f "$live_plist" ]]; then
        unlink "$live_plist"
      fi
    done
  fi
  set -e
}

fail_with_rollback() {
  local status=$?
  echo "Error: runtime installation failed; restoring the previous launchd/runtime state." >&2
  restore_previous_runtime
  exit "$status"
}

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Error: node is not installed or not executable." >&2
  exit 69
fi

if [[ ! -x "$ESBUILD_BIN" ]]; then
  echo "Error: esbuild is missing: ${ESBUILD_BIN}. Run npm ci in the source tree first." >&2
  exit 69
fi

if [[ -z "$CLOUDFLARED_BIN" || ! -x "$CLOUDFLARED_BIN" ]]; then
  echo "Error: cloudflared is not installed or not executable." >&2
  exit 69
fi

for runner in run-office-api.sh run-office-readonly-gateway.sh run-cloudflare-readonly-tunnel.sh; do
  if [[ ! -f "${DEPLOYMENT_ROOT}/${runner}" ]]; then
    echo "Error: runtime runner is missing: ${DEPLOYMENT_ROOT}/${runner}" >&2
    exit 66
  fi
done

mkdir -p "$RELEASES_DIR" "$STATE_ROOT" "$BACKUPS_DIR" "$LOG_DIR" "$CONFIG_DIR" "$AGENT_DIR" "$BACKUP_DIR"
chmod 700 "$RUNTIME_ROOT" "$RELEASES_DIR" "$STATE_ROOT" "$BACKUPS_DIR" "$CONFIG_DIR" "$BACKUP_DIR"

if [[ -e "$RELEASE_DIR" || -e "$STAGING_DIR" ]]; then
  echo "Error: release path already exists: ${RELEASE_DIR}" >&2
  exit 73
fi

typeset -A OFFICE_API_INPUTS
for key in "${OFFICE_API_KEYS[@]}"; do
  OFFICE_API_INPUTS[$key]="${(P)key:-}"
done

if [[ -f "$OFFICE_API_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$OFFICE_API_ENV_FILE"
else
  EXISTING_API_PLIST="${AGENT_DIR}/com.kotovela.office-api.plist"
  if [[ -f "$EXISTING_API_PLIST" ]]; then
    for key in "${OFFICE_API_KEYS[@]}"; do
      value="$(plist_env_value "$EXISTING_API_PLIST" "$key")"
      [[ -n "$value" ]] && export "${key}=${value}"
    done
  fi
fi

for key in "${OFFICE_API_KEYS[@]}"; do
  [[ -n "${OFFICE_API_INPUTS[$key]}" ]] && export "${key}=${OFFICE_API_INPUTS[$key]}"
done

if [[ -z "${OFFICE_API_TOKEN:-}" ]]; then
  echo "Error: OFFICE_API_TOKEN is required; no value was found in the protected env file or existing plist." >&2
  exit 64
fi

TMP_OFFICE_API_ENV="$(mktemp "${CONFIG_DIR}/office-api.env.tmp.XXXXXX")"
for key in "${OFFICE_API_KEYS[@]}"; do
  write_export "$TMP_OFFICE_API_ENV" "$key" "${(P)key:-}"
done
write_export "$TMP_OFFICE_API_ENV" PROJECT_ROOT "$STATE_ROOT"
write_export "$TMP_OFFICE_API_ENV" AUDIT_LOG_FILE "${STATE_ROOT}/server/data/audit-log.json"
write_export "$TMP_OFFICE_API_ENV" CONTENT_LEARNING_FILE "${STATE_ROOT}/data/content-learning.json"
write_export "$TMP_OFFICE_API_ENV" MODE_STATE_FILE "${STATE_ROOT}/server/data/system-mode.internal.json"
write_export "$TMP_OFFICE_API_ENV" OFFICE_INSTANCES_SNAPSHOT_PATH "${STATE_ROOT}/data/office-instances.snapshot.json"
write_export "$TMP_OFFICE_API_ENV" GUOMA_BOARD_WORKSPACE_ROOT "${KOTOVELA_WORKSPACE_ROOT:-$HOME}"
write_export "$TMP_OFFICE_API_ENV" NODE_BIN "$NODE_BIN"
chmod 600 "$TMP_OFFICE_API_ENV"
mv "$TMP_OFFICE_API_ENV" "$OFFICE_API_ENV_FILE"
chmod 600 "$OFFICE_API_ENV_FILE"

typeset -A GATEWAY_INPUTS
GATEWAY_KEYS=(
  OFFICE_READONLY_GATEWAY_PORT
  OFFICE_READONLY_GATEWAY_HOST
  OFFICE_READONLY_GATEWAY_TOKEN
  OFFICE_READONLY_GATEWAY_UPSTREAM_ORIGIN
  OFFICE_READONLY_GATEWAY_UPSTREAM_TOKEN
  OFFICE_READONLY_GATEWAY_CORS_ORIGIN
  OFFICE_READONLY_GATEWAY_TIMEOUT_MS
)
for key in "${GATEWAY_KEYS[@]}"; do
  GATEWAY_INPUTS[$key]="${(P)key:-}"
done
if [[ -f "$GATEWAY_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$GATEWAY_ENV_FILE"
fi
for key in "${GATEWAY_KEYS[@]}"; do
  [[ -n "${GATEWAY_INPUTS[$key]}" ]] && export "${key}=${GATEWAY_INPUTS[$key]}"
done
if [[ -z "${OFFICE_READONLY_GATEWAY_TOKEN:-}" || -z "${OFFICE_READONLY_GATEWAY_UPSTREAM_TOKEN:-}" ]]; then
  echo "Error: both gateway public and upstream tokens are required." >&2
  exit 64
fi

TMP_GATEWAY_ENV="$(mktemp "${CONFIG_DIR}/office-readonly-gateway.env.tmp.XXXXXX")"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_PORT "${OFFICE_READONLY_GATEWAY_PORT:-8791}"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_HOST "${OFFICE_READONLY_GATEWAY_HOST:-127.0.0.1}"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_TOKEN "$OFFICE_READONLY_GATEWAY_TOKEN"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_UPSTREAM_ORIGIN "${OFFICE_READONLY_GATEWAY_UPSTREAM_ORIGIN:-http://127.0.0.1:8787}"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_UPSTREAM_TOKEN "$OFFICE_READONLY_GATEWAY_UPSTREAM_TOKEN"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_CORS_ORIGIN "${OFFICE_READONLY_GATEWAY_CORS_ORIGIN:-https://kotovelahub.vercel.app}"
write_export "$TMP_GATEWAY_ENV" OFFICE_READONLY_GATEWAY_TIMEOUT_MS "${OFFICE_READONLY_GATEWAY_TIMEOUT_MS:-12000}"
write_export "$TMP_GATEWAY_ENV" NODE_BIN "$NODE_BIN"
chmod 600 "$TMP_GATEWAY_ENV"
mv "$TMP_GATEWAY_ENV" "$GATEWAY_ENV_FILE"
chmod 600 "$GATEWAY_ENV_FILE"

if [[ -f "$TUNNEL_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$TUNNEL_ENV_FILE"
fi
TUNNEL_TOKEN_FILE="${INPUT_TUNNEL_TOKEN_FILE:-${KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN_FILE:-${CONFIG_DIR}/cloudflare-readonly-tunnel.token}}"
[[ -n "$INPUT_TUNNEL_NAME" ]] && KOTOVELA_CLOUDFLARE_TUNNEL_NAME="$INPUT_TUNNEL_NAME"
[[ -n "$INPUT_TUNNEL_HOSTNAME" ]] && KOTOVELA_CLOUDFLARE_HOSTNAME="$INPUT_TUNNEL_HOSTNAME"
[[ -n "$INPUT_TUNNEL_SERVICE_URL" ]] && KOTOVELA_CLOUDFLARE_SERVICE_URL="$INPUT_TUNNEL_SERVICE_URL"
[[ -n "$INPUT_TUNNEL_PROTOCOL" ]] && KOTOVELA_CLOUDFLARE_TUNNEL_PROTOCOL="$INPUT_TUNNEL_PROTOCOL"
[[ -n "$INPUT_REPLACE_TOKEN" ]] && KOTOVELA_CLOUDFLARE_REPLACE_TUNNEL_TOKEN_FILE="$INPUT_REPLACE_TOKEN"
if [[ -n "$INPUT_TUNNEL_TOKEN" ]]; then
  if [[ ! -f "$TUNNEL_TOKEN_FILE" || "${KOTOVELA_CLOUDFLARE_REPLACE_TUNNEL_TOKEN_FILE:-0}" == "1" ]]; then
    TMP_TOKEN_FILE="$(mktemp "${CONFIG_DIR}/cloudflare-readonly-tunnel.token.tmp.XXXXXX")"
    print -r -- "$INPUT_TUNNEL_TOKEN" > "$TMP_TOKEN_FILE"
    chmod 600 "$TMP_TOKEN_FILE"
    mv "$TMP_TOKEN_FILE" "$TUNNEL_TOKEN_FILE"
  fi
  unset KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN INPUT_TUNNEL_TOKEN
fi
if [[ ! -f "$TUNNEL_TOKEN_FILE" ]]; then
  echo "Error: Cloudflare Tunnel token file is missing: ${TUNNEL_TOKEN_FILE}" >&2
  exit 77
fi
chmod 600 "$TUNNEL_TOKEN_FILE"

TMP_TUNNEL_ENV="$(mktemp "${CONFIG_DIR}/cloudflare-readonly-tunnel.env.tmp.XXXXXX")"
write_export "$TMP_TUNNEL_ENV" KOTOVELA_CLOUDFLARE_TUNNEL_NAME "${KOTOVELA_CLOUDFLARE_TUNNEL_NAME:-kotovela-office-readonly}"
write_export "$TMP_TUNNEL_ENV" KOTOVELA_CLOUDFLARE_HOSTNAME "${KOTOVELA_CLOUDFLARE_HOSTNAME:-}"
write_export "$TMP_TUNNEL_ENV" KOTOVELA_CLOUDFLARE_SERVICE_URL "${KOTOVELA_CLOUDFLARE_SERVICE_URL:-http://127.0.0.1:8791}"
write_export "$TMP_TUNNEL_ENV" KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN_FILE "$TUNNEL_TOKEN_FILE"
write_export "$TMP_TUNNEL_ENV" KOTOVELA_CLOUDFLARE_TUNNEL_PROTOCOL "${KOTOVELA_CLOUDFLARE_TUNNEL_PROTOCOL:-http2}"
write_export "$TMP_TUNNEL_ENV" CLOUDFLARED_BIN "$CLOUDFLARED_BIN"
chmod 600 "$TMP_TUNNEL_ENV"
mv "$TMP_TUNNEL_ENV" "$TUNNEL_ENV_FILE"
chmod 600 "$TUNNEL_ENV_FILE"

seed_file_once "${SOURCE_ROOT}/server/data/audit-log.json" "${STATE_ROOT}/server/data/audit-log.json"
seed_file_once "${SOURCE_ROOT}/server/data/system-mode.internal.json" "${STATE_ROOT}/server/data/system-mode.internal.json"
seed_file_once "${SOURCE_ROOT}/data/content-learning.json" "${STATE_ROOT}/data/content-learning.json"
seed_file_once "${SOURCE_ROOT}/data/office-instances.snapshot.json" "${STATE_ROOT}/data/office-instances.snapshot.json"
if [[ -d "${SOURCE_ROOT}/data/openclaw-runner" && ! -e "${STATE_ROOT}/data/openclaw-runner" ]]; then
  mkdir -p "${STATE_ROOT}/data"
  cp -R "${SOURCE_ROOT}/data/openclaw-runner" "${STATE_ROOT}/data/openclaw-runner"
fi

mkdir -p "$STAGING_DIR"
"$ESBUILD_BIN" "${SOURCE_ROOT}/scripts/office-api-server.ts" \
  --bundle --platform=node --format=esm --target=node22 --legal-comments=none \
  --outfile="${STAGING_DIR}/office-api-server.mjs"
"$ESBUILD_BIN" "${SOURCE_ROOT}/scripts/office-readonly-gateway.ts" \
  --bundle --platform=node --format=esm --target=node22 --legal-comments=none \
  --outfile="${STAGING_DIR}/office-readonly-gateway.mjs"

cp "${DEPLOYMENT_ROOT}/run-office-api.sh" "${STAGING_DIR}/run-office-api.sh"
cp "${DEPLOYMENT_ROOT}/run-office-readonly-gateway.sh" "${STAGING_DIR}/run-office-readonly-gateway.sh"
cp "${DEPLOYMENT_ROOT}/run-cloudflare-readonly-tunnel.sh" "${STAGING_DIR}/run-cloudflare-readonly-tunnel.sh"
chmod 755 "${STAGING_DIR}"/*.sh
chmod 644 "${STAGING_DIR}"/*.mjs

"$NODE_BIN" --check "${STAGING_DIR}/office-api-server.mjs"
"$NODE_BIN" --check "${STAGING_DIR}/office-readonly-gateway.mjs"
if rg -F "$SOURCE_ROOT" "$STAGING_DIR" >/dev/null 2>&1; then
  echo "Error: the runtime bundle still contains the development worktree path." >&2
  exit 65
fi

cat > "${STAGING_DIR}/manifest.txt" <<EOF_MANIFEST
release_id=${RELEASE_ID}
source_commit=${SOURCE_COMMIT}
created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
office_api_sha256=$(shasum -a 256 "${STAGING_DIR}/office-api-server.mjs" | awk '{print $1}')
readonly_gateway_sha256=$(shasum -a 256 "${STAGING_DIR}/office-readonly-gateway.mjs" | awk '{print $1}')
EOF_MANIFEST
chmod 644 "${STAGING_DIR}/manifest.txt"
mv "$STAGING_DIR" "$RELEASE_DIR"

for label in "${LABELS[@]}"; do
  live_plist="${AGENT_DIR}/${label}.plist"
  if [[ -f "$live_plist" ]]; then
    cp "$live_plist" "${BACKUP_DIR}/${label}.plist"
    chmod 600 "${BACKUP_DIR}/${label}.plist"
  else
    touch "${BACKUP_DIR}/${label}.missing"
  fi
done

if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_TARGET="$(readlink "$CURRENT_LINK")"
elif [[ -e "$CURRENT_LINK" ]]; then
  echo "Error: current runtime path exists but is not a symlink: ${CURRENT_LINK}" >&2
  exit 73
fi
[[ -n "$PREVIOUS_TARGET" ]] && print -r -- "$PREVIOUS_TARGET" > "${BACKUP_DIR}/previous-current-target.txt"

INSTALLING=1
trap fail_with_rollback ERR

NEXT_LINK="${RUNTIME_ROOT}/.current.next.$$"
ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -f "$NEXT_LINK" "$CURRENT_LINK"
SWITCHED_CURRENT=1

write_service_plist com.kotovela.office-api run-office-api.sh office-api "${AGENT_DIR}/com.kotovela.office-api.plist"
write_service_plist com.kotovela.office-readonly-gateway run-office-readonly-gateway.sh office-readonly-gateway "${AGENT_DIR}/com.kotovela.office-readonly-gateway.plist"
write_service_plist com.kotovela.cloudflare-readonly-tunnel run-cloudflare-readonly-tunnel.sh cloudflare-readonly-tunnel "${AGENT_DIR}/com.kotovela.cloudflare-readonly-tunnel.plist"

start_agent com.kotovela.office-api
start_agent com.kotovela.office-readonly-gateway
start_agent com.kotovela.cloudflare-readonly-tunnel
verify_runtime
trap - ERR
INSTALLING=0

echo "Installed Kotovela office bridge runtime release: ${RELEASE_ID}"
echo "Runtime: ${CURRENT_LINK} -> ${RELEASE_DIR}"
echo "State: ${STATE_ROOT}"
echo "Logs: ${LOG_DIR}"
echo "Rollback backup: ${BACKUP_DIR}"
