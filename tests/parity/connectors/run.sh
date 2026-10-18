#!/usr/bin/env bash
# Connector differential: v6's compile*Config (inside the v6 image) vs the clone's connectors
# (inside the clone image), both against mock.mjs on a private network. No internet access.
#   ./tests/parity/connectors/run.sh            (rebuild the clone image first if connectors changed)
set -euo pipefail
cd "$(dirname "$0")"
V6_IMAGE=${V6_IMAGE:-docker.sourcebot.dev/sourcebot-dev/sourcebot:v6.0.1}
CLONE_IMAGE=${CLONE_IMAGE:-sourcebot-clone-app}
NET=sbc-connector-parity
mkdir -p out
echo "{}" > out/empty-config.json
docker network create --internal "$NET" >/dev/null 2>&1 || true
docker rm -f sbc-mockhost >/dev/null 2>&1 || true
docker run -d --name sbc-mockhost --network "$NET" --network-alias mockhost -v "$PWD:/m:ro" node:24-alpine node /m/mock.mjs >/dev/null
trap 'docker logs sbc-mockhost 2>&1 | grep UNMATCHED | sort | uniq -c | head -20; docker rm -f sbc-mockhost >/dev/null; docker network rm "$NET" >/dev/null' EXIT
sleep 1
ENVS=(-e MOCK_TOKEN=mock-token -e SKIP_ENV_VALIDATION=1 -e DATABASE_URL=postgresql://x:y@localhost/z -e REDIS_URL=redis://localhost
      -e SOURCEBOT_ENCRYPTION_KEY=parity-encryption-key-32-bytes!! -e AUTH_SECRET=x -e SOURCEBOT_LOG_LEVEL=error -e CONFIG_PATH=/out/empty-config.json)
docker run --rm --network "$NET" "${ENVS[@]}" -v "$PWD:/m:ro" -v "$PWD/out:/out" --entrypoint node "$V6_IMAGE" /m/v6-compile.mjs
# tests/ is not in the image; mount tests/parity where its package.json (ESM) and relative import of packages/backend resolve.
docker run --rm --network "$NET" "${ENVS[@]}" -v "$PWD:/m:ro" -v "$(dirname "$PWD"):/app/tests/parity:ro" -v "$PWD/out:/out" -w /app "$CLONE_IMAGE" packages/backend/node_modules/.bin/tsx tests/parity/connectors/clone-compile.ts
node diff.mjs
