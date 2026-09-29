#!/usr/bin/env bash
# Sandbox entrypoint: boot the pinned dsh profile, then the runtime agent.
#
# The profile is pre-created at image build time; this script only repairs it
# when the image was built without that step (idempotent, never fatal).
set -uo pipefail

DSH_PORT="${DSH_PORT:-3080}"
PROFILE="${WIWANA_DSH_PROFILE:-wiwana-task}"
PROFILE_DIR="${DSH_HOME}/profiles/${PROFILE}"

ensure_profile() {
  if [ -f "${PROFILE_DIR}/package.json" ]; then
    echo "[sandbox] dsh profile ${PROFILE} already prepared"
    return 0
  fi
  echo "[sandbox] initializing dsh profile ${PROFILE}"
  mkdir -p "${PROFILE_DIR}"
  # 1. shipped headless bundle (base + one-shot runner) from the dsh installation
  dsh plugin --profile "${PROFILE}" add @deepseek-ai/dsh-headless || true
  # 2. the Wiwana product bundle (persona + capability skills)
  dsh plugin --profile "${PROFILE}" add /opt/wiwana/dsh-bundle || true
  # 3. hard fallback: declare the layer stack ourselves so an offline or
  #    pnpm-less container still boots the product composition.
  if [ ! -f "${PROFILE_DIR}/package.json" ] || ! grep -q "dsh-base" "${PROFILE_DIR}/package.json" 2>/dev/null; then
    cat > "${PROFILE_DIR}/package.json" <<JSON
{
  "name": "wiwana-profile",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "@wiwana/dsh-bundle"
      ]
    }
  }
}
JSON
  fi
}

ensure_profile

# dsh runs as a one-shot subprocess per task, so no server is started here. The
# web profile stays available for interactive debugging via `docker exec`.
if [ "${DSH_WEB_ENABLED:-false}" = "true" ]; then
  echo "[sandbox] starting dsh web (debug only) on 127.0.0.1:${DSH_PORT}"
  dsh --profile wiwana --host 127.0.0.1 --port "${DSH_PORT}" --no-open > /tmp/dsh.log 2>&1 &
  trap 'kill $! 2>/dev/null || true' EXIT
fi

echo "[sandbox] starting runtime agent"
exec node /opt/wiwana/runtime-agent/dist/main.js
