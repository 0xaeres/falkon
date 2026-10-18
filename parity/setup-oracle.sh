#!/usr/bin/env bash
# Copies v6's compiled query parser (+ @lezer runtime and grammar fixtures) out of the image into
# parity/.oracle, for the offline grammar differential (parity/grammar/diff.mjs).
set -euo pipefail
cd "$(dirname "$0")"
IMG=${V6_IMAGE:-docker.sourcebot.dev/sourcebot-dev/sourcebot:v6.0.1}
rm -rf .oracle && mkdir -p .oracle
docker run --rm --network none --entrypoint sh "$IMG" -c \
  'cd /app && tar -c node_modules/@lezer packages/queryLanguage/dist packages/queryLanguage/test' | tar -x -C .oracle
echo "oracle ready in parity/.oracle"
