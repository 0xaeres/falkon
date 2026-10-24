#!/usr/bin/env bash
# Real-token proof of the live pull request sync (D120). Syncs two small public repositories into a throwaway Postgres
# container and prints counts, request use and PASS or FAIL. Run it yourself; no agent should ever see the token:
#   read -rs GITHUB_TOKEN && export GITHUB_TOKEN
#   scripts/sync-smoke.sh [owner/name owner/name ...]
# The token stays in this process's environment: it is never printed, written to a file, or put on a command line.
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }

if [ -z "${GITHUB_TOKEN:-}" ]; then
    [ -t 0 ] || fail 'no token: export GITHUB_TOKEN (read -rs GITHUB_TOKEN && export GITHUB_TOKEN) and run again'
    read -rs -p 'GitHub token (hidden): ' GITHUB_TOKEN
    printf '\n'
    [ -n "$GITHUB_TOKEN" ] || fail 'no token: the prompt was empty'
fi
# A shell variable from here on: only the final command gets it in its environment.
export -n GITHUB_TOKEN

repos=("$@")
[ "${#repos[@]}" -gt 0 ] || repos=(openmrs/openmrs-module-dataentrystatistics openmrs/openmrs-contrib-keycloak-smart-auth)
for r in "${repos[@]}"; do
    [[ $r =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "bad repository '$r': use owner/name"
done
for command in docker git pnpm; do
    command -v "$command" >/dev/null 2>&1 || fail "prerequisites: missing $command"
done

# One throwaway stack at a time: a fixed name, so a second run (or a leftover) stops here. Not the falkon project.
name=falkon-eval-sync-pg
docker ps -a --format '{{.Names}}' | grep -qx "$name" && fail "$name already exists: another run is active, or remove it with: docker rm -f $name"
temp=$(mktemp -d)
created=
cleanup() {
    code=$?
    trap - EXIT HUP INT TERM
    [ -z "$created" ] || docker rm -f "$name" >/dev/null 2>&1 || :
    rm -rf "$temp"
    exit "$code"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
docker run -d --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=falkon_sync -p 127.0.0.1::5432 postgres:17-alpine >/dev/null ||
    fail 'could not start the throwaway Postgres container'
created=1
port=$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')
[ -n "$port" ] || fail 'the throwaway Postgres has no host port'
for _ in $(seq 1 60); do
    docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d falkon_sync >/dev/null 2>&1 && break
    sleep 1
done
docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d falkon_sync >/dev/null 2>&1 || fail 'the throwaway Postgres did not become ready'
export DATABASE_URL="postgresql://postgres@127.0.0.1:$port/falkon_sync"
# Only the sync itself gets the token.
pnpm -C "$root" --filter @falkon/db push >/dev/null 2>&1 || fail 'could not create the schema in the throwaway Postgres (run pnpm install && pnpm db:generate)'
for r in "${repos[@]}"; do
    GIT_TERMINAL_PROMPT=0 git clone --quiet --bare "https://github.com/$r.git" "$temp/${r/\//__}.git" ||
        fail "could not clone $r (public, no token)"
done
GITHUB_TOKEN="$GITHUB_TOKEN" pnpm -C "$root" --filter @falkon/backend exec tsx src/syncSmoke.ts "$temp" "${repos[@]}"
