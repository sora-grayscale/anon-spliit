#!/bin/sh

set -eu

APP_NAME=$(node -p -e "require('./package.json').name")
APP_VERSION=$(node -p -e "require('./package.json').version")

echo "Building ${APP_NAME}:${APP_VERSION}..."

# Build with Docker or Podman
if command -v podman > /dev/null 2>&1; then
    echo "Using Podman..."
    podman build \
        -t "${APP_NAME}:${APP_VERSION}" \
        -t "${APP_NAME}:latest" \
        .
else
    echo "Using Docker..."
    docker buildx build \
        -t "${APP_NAME}:${APP_VERSION}" \
        -t "${APP_NAME}:latest" \
        .
    docker image prune -f
fi

echo "Build complete: ${APP_NAME}:${APP_VERSION}"
