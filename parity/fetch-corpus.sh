#!/usr/bin/env bash
# Materialize the parity corpus under parity/.corpus/<host>/<path>, pinned by parity/corpus.lock.
# First run pins each repo's current HEAD into the lock; later runs check out exactly those commits.
# Also (re)builds the synthetic edge-case repo at example.test/fixtures/edge.
set -euo pipefail
cd "$(dirname "$0")"
OUT=.corpus
LOCK=corpus.lock
mkdir -p "$OUT"
touch "$LOCK"

for url in $(node -e 'for (const r of require("./corpus.json").repos) console.log(r.url)'); do
  rel=$(echo "$url" | sed -E 's#^https?://##; s#\.git$##')
  dir="$OUT/$rel"
  pinned=$(awk -v u="$url" '$1==u {print $2}' "$LOCK")
  if [ ! -d "$dir/.git" ]; then
    git clone --quiet --no-single-branch "$url" "$dir"
  fi
  if [ -n "$pinned" ]; then
    git -C "$dir" fetch --quiet origin "$pinned" 2>/dev/null || true
    git -C "$dir" checkout --quiet --detach "$pinned"
  else
    pinned=$(git -C "$dir" rev-parse HEAD)
    echo "$url $pinned" >> "$LOCK"
  fi
  # Both engines index the default branch: keep it pointing at the pinned commit.
  def=$(git -C "$dir" symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##')
  git -C "$dir" checkout --quiet -B "$def" "$pinned"
  echo "pinned $rel @ $pinned ($def)"
done

./make-edge-repo.sh "$OUT/example.test/fixtures/edge"
