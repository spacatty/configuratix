# Configuratix control plane (Go API).
# Build context: repository root (the backend compiles agent binaries from ../agent at startup).
#
# The runtime image keeps the Go toolchain on purpose: on boot the backend cross-compiles the
# agent for linux/amd64 + linux/arm64 into ./agent-binaries (a volume), exactly as before Docker.

FROM golang:1.25-alpine AS build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server

FROM golang:1.25-alpine AS runtime
RUN apk add --no-cache ca-certificates tzdata wget
ENV CGO_ENABLED=0 GOFLAGS=-buildvcs=false GOTOOLCHAIN=local

# Agent sources + pre-fetched modules so the startup cross-compile needs no network.
WORKDIR /app/agent
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN rm -rf bin agent agent.exe

WORKDIR /app/backend
COPY --from=build /out/server ./server
COPY backend/migrations ./migrations
# Target agent version shipped with this image; agent-binaries/ itself is a volume, so the
# version.json inside it may be stale after an upgrade - the entrypoint exports this instead.
COPY backend/agent-binaries/version.json /app/agent-version.json
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p agent-binaries data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/setup/status >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["./server"]
