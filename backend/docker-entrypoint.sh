#!/bin/sh
set -e

# The listen port inside the container is fixed; host mapping is done by compose.
export BACKEND_PORT=8080

# Agent target version comes from the image, not from the (persisted, possibly older)
# agent-binaries/version.json, so an image upgrade triggers a fresh agent build.
if [ -z "${AGENT_VERSION:-}" ] && [ -f /app/agent-version.json ]; then
  AGENT_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /app/agent-version.json | head -n1)"
  export AGENT_VERSION
fi

exec "$@"
