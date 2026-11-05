#!/usr/bin/env bash
# Start a disposable test machine and enroll it into a locally running backend.
#
#   dev/test-machine/up.sh <ENROLLMENT_TOKEN> [name] [backend_url]
#
# Create the token in the UI (press "/" → "new"). The backend must listen on the
# host; the container reaches it via host.docker.internal.
# Remove with: docker rm -f <name>
set -euo pipefail
# Git Bash on Windows would rewrite /sys/... and /run into Windows paths.
export MSYS_NO_PATHCONV=1

TOKEN="${1:?usage: up.sh <ENROLLMENT_TOKEN> [name] [backend_url]}"
NAME="${2:-configuratix-test-1}"
BACKEND="${3:-http://host.docker.internal:${BACKEND_PORT:-8081}}"
DIR="$(cd "$(dirname "$0")" && pwd)"

(cd "$DIR" && docker build -q -t configuratix-test-machine . >/dev/null)

docker rm -f "$NAME" >/dev/null 2>&1 || true
# systemd needs a writable cgroup tree; --privileged also lets ufw/nftables work.
docker run -d --name "$NAME" --hostname "$NAME" \
  --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --tmpfs /run --tmpfs /run/lock \
  --add-host host.docker.internal:host-gateway \
  configuratix-test-machine >/dev/null

# Wait for systemd to come up
for _ in $(seq 1 30); do
  state="$(docker exec "$NAME" systemctl is-system-running 2>/dev/null || true)"
  case "$state" in running|degraded) break ;; esac
  sleep 1
done

echo "Installing agent into $NAME from $BACKEND ..."
docker exec "$NAME" bash -c "curl -fsSL '$BACKEND/install.sh' | bash -s -- '$TOKEN'"
docker exec "$NAME" systemctl --no-pager --lines=5 status configuratix-agent || true
