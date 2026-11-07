#!/bin/sh
# Isolated, disposable compose project. Does not load operator environment files.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
step=prerequisites
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }
for command in docker node git curl pnpm; do
    command -v "$command" >/dev/null 2>&1 || fail "prerequisites: missing $command"
done
docker compose version >/dev/null 2>&1 || fail 'prerequisites: docker compose unavailable'
pnpm -C "$root" --filter @falkon/shared exec tsx -e "import '../../tests/golden/run.ts'; import '../../tests/golden/diff.ts'" >/dev/null 2>&1 ||
    fail 'prerequisites: golden runner cannot start; run pnpm install in the worktree and retry'
pass "$step"
temp=$(mktemp -d)
project="falkon-eval-smoke-$$"
api_port=${SMOKE_API_PORT:-3301}
api_base="http://127.0.0.1:$api_port"
admin_port=${SMOKE_ADMIN_PORT:-3302}
admin_base="http://127.0.0.1:$admin_port"
timeout=${SMOKE_TIMEOUT:-300}
# A random admin token for this disposable stack only. It reaches the compose file and the golden runner through the environment and curl through a mode-600 header file, never through argv.
admin_token=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")
compose() { docker compose -p "$project" -f "$temp/compose.json" "$@"; }
cleanup() {
    code=$?
    trap - EXIT HUP INT TERM
    if [ "$code" -ne 0 ]; then
        printf 'FAIL %s\n' "$step" >&2
        if [ -f "$temp/compose.json" ]; then compose logs --tail=200 >&2 || :; fi
    fi
    if [ -f "$temp/compose.json" ]; then
        if compose down -v --remove-orphans >/dev/null 2>&1; then pass teardown;
        else
            printf 'FAIL teardown\n' >&2
            compose logs --tail=200 >&2 || :
            code=1
        fi
    fi
    rm -rf "$temp"
    exit "$code"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
step=fixtures
(umask 077; printf 'authorization: Bearer %s\n' "$admin_token" > "$temp/admin.header")
sh "$root/tests/fixtures/build.sh" "$temp" >/dev/null
ADMIN_TOKEN="$admin_token" node - "$root" "$temp" "$api_port" "$admin_port" docker/Dockerfile <<'JS'
const fs = require('node:fs');
const [root, temp, apiPort, adminPort, dockerfile] = process.argv.slice(2);
const env = { DATABASE_URL: 'postgresql://falkon:falkon@postgres:5432/falkon', REDIS_URL: 'redis://redis:6379', DATA_DIR: '/data', CONFIG_PATH: '/fixtures/config.json', ZOEKT_URL: 'http://zoekt:6070', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };
const app = { image: 'falkon-smoke-app', pull_policy: 'never', environment: env, volumes: ['data:/data', `${temp}:/fixtures:ro`] };
const compose = { services: {
  postgres: { image: 'postgres:17-alpine', environment: { POSTGRES_USER: 'falkon', POSTGRES_PASSWORD: 'falkon', POSTGRES_DB: 'falkon' }, volumes: ['pgdata:/var/lib/postgresql/data'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -U falkon'], interval: '3s', retries: 30 } },
  redis: { image: 'redis:7-alpine', healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '3s', retries: 30 } },
  backend: { ...app, build: { context: root, dockerfile }, command: ['sh', '-c', 'pnpm --filter @falkon/db push && pnpm --filter @falkon/backend start'], depends_on: { postgres: { condition: 'service_healthy' }, redis: { condition: 'service_healthy' } } },
  zoekt: { ...app, command: ['zoekt-webserver', '-index', '/data/index', '-rpc', '-listen', ':6070'], depends_on: ['backend'] },
  api: { ...app, environment: { ...env, API_HOST: '0.0.0.0', API_ADMIN_HOST: '0.0.0.0', AUTH_MODE: 'none', ADMIN_TOKEN: process.env.ADMIN_TOKEN }, command: ['node', 'packages/api/dist/main.js'], ports: [`127.0.0.1:${apiPort}:3001`, `127.0.0.1:${adminPort}:3002`], depends_on: ['backend', 'zoekt'] }
}, volumes: { pgdata: {}, data: {} } };
fs.writeFileSync(`${temp}/compose.json`, JSON.stringify(compose));
JS
pass "$step"
step=cold-start
compose up -d --build >/dev/null
pass "$step"
step=seed
# Products come only from /setup, so the fixtures Product is written straight to Postgres from the backend container (it has the repo and DATABASE_URL).
# Retried until the backend's `db push` has created the schema; the backend re-resolves the Product's repositories after each sync.
deadline=$(( $(date +%s) + timeout ))
until compose exec -T backend pnpm --filter @falkon/backend exec tsx ../../scripts/seed-product.ts fixtures Fixtures 'fixtures.test/*' >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "seed: the fixtures Product was not written within ${timeout}s"
    sleep 2
done
pass "$step"

# The fixtures Product (seeded above) searched through the api's Product-scoped route on the admin listener.
search_path=/ui/products/fixtures/search
search() {
    curl --silent --show-error --fail --max-time 10 --get --header "@$temp/admin.header" --data-urlencode "q=$1" --data-urlencode 'limit=1000' "$admin_base$search_path" -o "$temp/search.json" 2>/dev/null
}
wait_for() {
    query=$1
    expected=$2
    repo=$3
    deadline=$(( $(date +%s) + timeout ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if search "$query" && node - "$temp/search.json" "$expected" "$repo" <<'JS'
const fs = require('node:fs');
const [file, expected, repo] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(result.files) || typeof result.isSearchExhaustive !== 'boolean') process.exit(1);
const found = result.files.some(f => f.repo === repo);
process.exit(expected === 'present' ? (found ? 0 : 1) : (!found && result.isSearchExhaustive && result.files.length === 0 ? 0 : 1));
JS
        then return 0; fi
        sleep 2
    done
    return 1
}
step=indexing
for name in atlas ledger worker archive; do
    wait_for "repo:^fixtures.test/$name$ fixture_marker" present "fixtures.test/$name"
    pass "searchable-$name"
done
pass "$step"
step=api
# The Nest service answers /mcp/<product>: wait until the fixtures Product resolves, and prove an unknown one is a 404.
mcp_post() {
    curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' --request POST \
        --header 'content-type: application/json' --header 'accept: application/json, text/event-stream' \
        --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
        "$api_base/mcp/$1" 2>/dev/null || :
}
deadline=$(( $(date +%s) + timeout ))
until [ "$(mcp_post fixtures)" = 200 ]; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "api: /mcp/fixtures did not answer within ${timeout}s"
    sleep 2
done
[ "$(mcp_post no-such-product)" = 404 ] || fail 'api: unknown Product is not 404'
pass "$step"
step=admin-auth
# The admin routes do not exist on the product port, the admin port refuses a missing or wrong token, and /products is gone even with the token.
status() { curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "$@" 2>/dev/null || :; }
auth="@$temp/admin.header"
[ "$(status "$api_base/connections")" = 404 ] || fail 'admin-auth: admin routes answer on the product port'
[ "$(status "$admin_base/connections")" = 401 ] || fail 'admin-auth: a tokenless admin call is not 401'
[ "$(status --header 'authorization: Bearer wrong-token' "$admin_base/connections")" = 401 ] || fail 'admin-auth: a wrong-token admin call is not 401'
[ "$(status --header "$auth" "$admin_base/connections")" = 200 ] || fail 'admin-auth: an admin call with the token failed'
[ "$(status --header "$auth" "$admin_base/products")" = 404 ] || fail 'admin-auth: /products still answers with the token'
pass "$step"
step=oversized-file
wait_for 'oversized_only_marker' absent fixtures.test/atlas
pass "$step"
step=golden-stability
# Search and MCP both go through the api service: search on the admin listener (admin token), MCP on /mcp/fixtures.
export MCP_PATH="$api_base/mcp/fixtures" SEARCH_PATH="$search_path" API_KEY="$admin_token" BASE_URL="$admin_base"
pnpm -C "$root" golden:record "$temp/golden-before.json" >/dev/null
pnpm -C "$root" golden:record "$temp/golden-after.json" >/dev/null
pnpm -C "$root" golden:diff "$temp/golden-before.json" "$temp/golden-after.json" >/dev/null
step=golden-baseline
baseline="$root/tests/golden/expected.json"
if [ -f "$baseline" ]; then
    pnpm -C "$root" golden:diff "$baseline" "$temp/golden-before.json" || fail 'golden-baseline: capture differs from tests/golden/expected.json'
    pass "$step"
else
    printf 'WARN no baseline exists at tests/golden/expected.json; stability alone does not establish a regression baseline\n' >&2
fi
# Optional durable output for a later slice's before/after comparison.
if [ -n "${GOLDEN_OUTPUT:-}" ]; then cp "$temp/golden-before.json" "$GOLDEN_OUTPUT"; fi
pass golden-stability
step=resync
printf '\nresync_only_marker\n' >> "$temp/repos/atlas/README.md"
git -C "$temp/repos/atlas" add README.md
GIT_AUTHOR_DATE='2026-01-03T00:00:00Z' GIT_COMMITTER_DATE='2026-01-03T00:00:00Z' \
    git -C "$temp/repos/atlas" -c user.name=Fixture -c user.email=fixture@example.test -c commit.gpgsign=false commit -qm 'Smoke resync'
wait_for 'repo:^fixtures.test/atlas$ resync_only_marker' present fixtures.test/atlas
pass "$step"
step=delete-repo
# Deletion relies on the backend reloading this disposable config via its watcher.
# Rewrite the same inode so the watcher sees the edit; wait_for bounds the reload/index wait.
node - "$temp/config.json" <<'JS'
const fs = require('node:fs');
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
delete config.connections.archive;
fs.writeFileSync(file, JSON.stringify(config, null, 2));
JS
wait_for 'repo:^fixtures.test/archive$ fixture_marker' absent fixtures.test/archive ||
    fail "delete-repo: config reload/index deletion did not complete within ${timeout}s"
# Keep asserting survivors so a global index outage cannot count as successful deletion.
for name in atlas ledger worker; do
    wait_for "repo:^fixtures.test/$name$ fixture_marker" present "fixtures.test/$name"
done
pass "$step"
step=memory
compose ps -q > "$temp/container-ids"
[ -s "$temp/container-ids" ]
# Include the whole clone stack: backend, api, zoekt, postgres and redis.
# Docker container IDs are whitespace-free; pass each as a separate argument.
# shellcheck disable=SC2046
docker stats --no-stream --format '{{json .}}' $(cat "$temp/container-ids") > "$temp/memory.jsonl"
node - "$temp/memory.jsonl" "$temp/container-ids" <<'JS'
const fs = require('node:fs');
const [file, ids] = process.argv.slice(2);
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const expected = fs.readFileSync(ids, 'utf8').trim().split(/\s+/).length;
if (rows.length !== expected || expected !== 5) throw new Error('FAIL memory: expected measurements for all five clone services');
const units = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
let total = 0;
for (const row of rows) {
    const match = /^([\d.]+)\s*([A-Za-z]+)\s*\//.exec(row.MemUsage);
    if (!match || !units[match[2]]) throw new Error(`FAIL memory: unrecognized usage ${row.MemUsage}`);
    total += Number(match[1]) * units[match[2]];
    console.log(`${row.Name} ${row.MemUsage}`);
}
const megabytes = total / 1e6;
if (!Number.isFinite(megabytes)) throw new Error('FAIL memory: non-finite total');
// Reported, not enforced (D76): a figure over the reference ceiling does not fail the step.
console.log(`INFO memory: whole clone stack ${megabytes.toFixed(2)} MB (reference ceiling 654 MB)`);
JS
if [ "${GOLDEN_RECORD:-0}" = 1 ]; then
    cp "$temp/golden-before.json" "$baseline"
    pass 'golden-record: tests/golden/expected.json'
fi
