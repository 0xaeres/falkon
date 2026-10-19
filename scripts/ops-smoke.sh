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
pnpm -C "$root" --filter @sbc/shared exec tsx -e "import '../../tests/golden/run.ts'; import '../../tests/golden/diff.ts'" >/dev/null 2>&1 ||
    fail 'prerequisites: golden runner cannot start; run pnpm install in the worktree and retry'
pass "$step"
temp=$(mktemp -d)
project="falkon-smoke-$$"
port=${SMOKE_PORT:-3300}
base="http://127.0.0.1:$port"
timeout=${SMOKE_TIMEOUT:-300}
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
sh "$root/tests/fixtures/build.sh" "$temp" >/dev/null
node - "$root" "$temp" "$port" <<'JS'
const fs = require('node:fs');
const [root, temp, port] = process.argv.slice(2);
const env = { DATABASE_URL: 'postgresql://sbc:sbc@postgres:5432/sbc', REDIS_URL: 'redis://redis:6379', DATA_DIR: '/data', CONFIG_PATH: '/fixtures/config.json', ZOEKT_URL: 'http://zoekt:6070', AUTH_URL: `http://127.0.0.1:${port}`, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };
const app = { image: 'falkon-smoke-app', environment: env, volumes: ['data:/data', `${temp}:/fixtures:ro`] };
const compose = { services: {
  postgres: { image: 'postgres:17-alpine', environment: { POSTGRES_USER: 'sbc', POSTGRES_PASSWORD: 'sbc', POSTGRES_DB: 'sbc' }, volumes: ['pgdata:/var/lib/postgresql/data'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -U sbc'], interval: '3s', retries: 30 } },
  redis: { image: 'redis:7-alpine', healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '3s', retries: 30 } },
  backend: { ...app, build: { context: root, dockerfile: 'docker/Dockerfile' }, command: ['sh', '-c', 'pnpm --filter @sbc/db push && pnpm --filter @sbc/backend start'], depends_on: { postgres: { condition: 'service_healthy' }, redis: { condition: 'service_healthy' } } },
  zoekt: { ...app, command: ['zoekt-webserver', '-index', '/data/index', '-rpc', '-listen', ':6070'], depends_on: ['backend'] },
  web: { ...app, command: ['pnpm', '--filter', '@sbc/web', 'start'], ports: [`127.0.0.1:${port}:3000`], depends_on: ['backend', 'zoekt'] }
}, volumes: { pgdata: {}, data: {} } };
fs.writeFileSync(`${temp}/compose.json`, JSON.stringify(compose));
JS
pass "$step"
step=cold-start
compose up -d --build >/dev/null
pass "$step"

search() {
    curl --silent --show-error --fail --max-time 10 --get --data-urlencode "q=$1" --data-urlencode 'limit=1000' "$base/api/search" -o "$temp/search.json" 2>/dev/null
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
step=oversized-file
wait_for 'oversized_only_marker' absent fixtures.test/atlas
pass "$step"
step=golden-stability
BASE_URL="$base" pnpm -C "$root" golden:record "$temp/golden-before.json" >/dev/null
BASE_URL="$base" pnpm -C "$root" golden:record "$temp/golden-after.json" >/dev/null
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
# Include the whole clone stack: backend, web, zoekt, postgres and redis.
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
const passed = Number.isFinite(megabytes) && megabytes <= 654;
console.log(`${passed ? 'PASS' : 'FAIL'} memory: whole clone stack ${megabytes.toFixed(2)} MB; ceiling 654 MB (545 MB +20%)`);
if (!passed) process.exit(1);
JS
if [ "${GOLDEN_RECORD:-0}" = 1 ]; then
    cp "$temp/golden-before.json" "$baseline"
    pass 'golden-record: tests/golden/expected.json'
fi
