#!/bin/sh
# Build into a disposable destination; source trees never contain .git directories.
set -eu
src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
dest=${1:?Usage: sh tests/fixtures/build.sh DESTINATION}
mkdir -p "$dest/repos"
dest=$(CDPATH='' cd -- "$dest" && pwd)
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='Fixture' GIT_AUTHOR_EMAIL='fixture@example.test'
export GIT_COMMITTER_NAME='Fixture' GIT_COMMITTER_EMAIL='fixture@example.test'
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z'
for name in atlas ledger worker archive; do
    repo="$dest/repos/$name"
    if [ -e "$repo" ]; then
        printf 'Destination exists: %s\n' "$repo" >&2
        exit 1
    fi
    mkdir -p "$repo"
    cp -R "$src/repos/$name/." "$repo/"
    git -C "$repo" init -q --object-format=sha1 -b main
    git -C "$repo" config core.autocrlf false
    git -C "$repo" config core.fileMode false
    git -C "$repo" config remote.origin.url "https://fixtures.test/$name.git"
    git -C "$repo" config zoekt.public 1
    if [ "$name" = ledger ]; then git -C "$repo" config zoekt.public 0; fi
    git -C "$repo" config zoekt.fork 0
    git -C "$repo" config zoekt.archived 0
    if [ "$name" = worker ]; then git -C "$repo" config zoekt.fork 1; fi
    if [ "$name" = archive ]; then git -C "$repo" config zoekt.archived 1; fi
    git -C "$repo" add .
    git -C "$repo" -c commit.gpgsign=false commit -qm 'Initial fixture'
    git -C "$repo" tag v1
    git -C "$repo" checkout -qb feature
    printf 'feature_only_marker %s\n' "$name" > "$repo/feature.txt"
    git -C "$repo" add feature.txt
    GIT_AUTHOR_DATE='2026-01-02T00:00:00Z' GIT_COMMITTER_DATE='2026-01-02T00:00:00Z' \
        git -C "$repo" -c commit.gpgsign=false commit -qm 'Feature fixture'
    git -C "$repo" checkout -q main
    git -C "$repo" rev-parse HEAD feature v1
done
cp "$src/config.json" "$dest/config.json"
