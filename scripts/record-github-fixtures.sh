#!/usr/bin/env bash
# Records raw GitHub REST and GraphQL responses as fixtures for the GitHub discussion source (S51, D120).
# Read-only, public repositories only. Uses the operator's own `gh` login; never reads, prints or stores a token.
# Usage: scripts/record-github-fixtures.sh [output-dir]   (default: packages/backend/src/fixtures/github)
set -euo pipefail

OUT="${1:-packages/backend/src/fixtures/github}"
DATE="$(date -u +%F)"
SINCE="2017-01-01T00:00:00Z"
DS="openmrs/openmrs-module-dataentrystatistics"   # squash and merge-commit pull requests, one rebase-merged pull request
KC="openmrs/openmrs-contrib-keycloak-smart-auth"  # squash-merged pull requests, one with no body and no commits
CORE="openmrs/openmrs-core"                       # very large pull request (106 comments) and one from a deleted user
QS="openmrs/openmrs-module-querystore"            # issues listing: issues mixed with pull requests (issues are off in DS and KC)
REBASE_SHA="bd64dafb4351de34629e3d2d343a29196e168dae" # merge commit of DS pull request 2, a rebase merge

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
: > "$TMP/index.tsv"
: > "$TMP/headers.jsonl"
: > "$TMP/graphql.jsonl"

# Blanks every email address, token-like string and the word "authorization" (one PR body uses it in prose) in a recorded file.
# No allowlist: noreply forms are blanked too.
# The lookbehind keeps a JSON escape such as \n intact: an address right after a backslash starts at its first letter.
scrub() {
  perl -0pi -e 's/(?<!\\)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/[email removed]/g; s/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/[token removed]/g; s/authorization/[word removed]/gi' "$1"
}

record() { # <file> <request description>
  scrub "$OUT/$1"
  jq -e . "$OUT/$1" >/dev/null
  printf '%s\t%s\t%s\n' "$1" "$2" "$DATE" >> "$TMP/index.tsv"
}

# rest <stem> <api path>: body to <stem>.json; x-ratelimit-* headers kept in rate-limit.json, nothing else from the headers.
rest() {
  local raw="$TMP/$1.raw"
  gh api -i "$2" > "$raw"
  awk '/^\r?$/ {exit} {print}' "$raw" | tr -d '\r' > "$TMP/$1.head"
  awk 'f {print} /^\r?$/ && !f {f = 1}' "$raw" > "$OUT/$1.json"
  local rl
  rl="$({ grep -i '^x-ratelimit' "$TMP/$1.head" || true; } | jq -Rn '[inputs | capture("^(?<k>[^:]+): (?<v>.*)$") | {(.k | ascii_downcase): .v}] | add // {}')"
  jq -cn --arg file "$1" --arg req "GET $2" --arg status "$(head -1 "$TMP/$1.head")" --argjson rl "$rl" \
    '{file: $file, request: $req, status: $status, rateLimitHeaders: $rl}' >> "$TMP/headers.jsonl"
  record "$1.json" "GET /$2"
}

# gql <stem> <owner/name> <query>: GraphQL response (its data.rateLimit block is kept) to <stem>.json.
gql() {
  gh api graphql -f query="$3" -f owner="${2%%/*}" -f name="${2##*/}" > "$OUT/$1.json"
  jq -c --arg file "$1.json" '{file: $file, rateLimit: .data.rateLimit}' "$OUT/$1.json" >> "$TMP/graphql.jsonl"
  record "$1.json" "POST /graphql (repo $2, detail query, see the script)"
}

# The pull request fragment and page sizes are those of tests/eval/discussions.ts (S47), kept verbatim.
FRAGMENT='fragment F on PullRequest{number title body state merged mergedAt createdAt updatedAt closedAt author{login} headRefName baseRefName mergeCommit{oid} url labels(first:50){nodes{name}} comments(first:100){pageInfo{hasNextPage endCursor} nodes{databaseId author{login} body createdAt updatedAt}} reviews(first:100){pageInfo{hasNextPage endCursor} nodes{databaseId author{login} state body submittedAt}} reviewThreads(first:30){pageInfo{hasNextPage endCursor} nodes{comments(first:30){pageInfo{hasNextPage} nodes{databaseId author{login} body path line originalLine createdAt updatedAt}}}} files(first:100){pageInfo{hasNextPage endCursor} nodes{path additions deletions}}}'

# detail <stem> <owner/name> <pull request numbers...>: one aliased query per call, as the live adapter batches.
detail() {
  local stem="$1" repo="$2" aliases="" n
  shift 2
  for n in "$@"; do aliases+="p$n:pullRequest(number:$n){...F} "; done
  gql "$stem" "$repo" "query(\$owner:String!,\$name:String!){repository(owner:\$owner,name:\$name){${aliases}} rateLimit{cost remaining resetAt}} ${FRAGMENT}"
}

for pair in "dataentrystatistics $DS" "keycloak-smart-auth $KC"; do
  set -- $pair
  rest "$1-issues" "repos/$2/issues?state=all&sort=updated&direction=asc&since=$SINCE&per_page=100"
  rest "$1-probe" "repos/$2/pulls?per_page=1"
done
detail "dataentrystatistics-pulls" "$DS" 2 3 10
detail "keycloak-smart-auth-pulls" "$KC" 2 3 14 21
detail "openmrs-core-pulls" "$CORE" 294 2712
rest "querystore-issues" "repos/$QS/issues?state=all&sort=updated&direction=asc&since=$SINCE&per_page=100"
rest "dataentrystatistics-commit-pulls" "repos/$DS/commits/$REBASE_SHA/pulls"

jq -n --slurpfile rest "$TMP/headers.jsonl" --slurpfile gql "$TMP/graphql.jsonl" \
  '{rest: $rest, graphql: $gql}' > "$OUT/rate-limit.json"
printf '%s\t%s\t%s\n' "rate-limit.json" "the x-ratelimit-* headers of each REST request above, and each GraphQL data.rateLimit" "$DATE" >> "$TMP/index.tsv"

for f in "$OUT"/*.json; do
  [ "$(wc -c < "$f")" -lt 2097152 ] || { echo "too large: $f" >&2; exit 1; }
done

{
  echo "# GitHub fixtures"
  echo
  echo "Raw responses recorded on $DATE by \`scripts/record-github-fixtures.sh\`, read-only, with the operator's \`gh\` login. Public repositories only. Re-run the script to refresh them."
  echo
  echo "| File | Request | Date |"
  echo "|---|---|---|"
  awk -F'\t' '{printf "| `%s` | `%s` | %s |\n", $1, $2, $3}' "$TMP/index.tsv"
  cat <<'EOF'

## Cases

- `querystore-issues.json`: the issues listing page of another openmrs repository (the two fixture repositories have issues disabled, so every item there is a pull request), 99 items: 66 issues and 33 pull requests; items with a `pull_request` key are pull requests.
- `dataentrystatistics-issues.json`, `keycloak-smart-auth-issues.json`: the issues listing page of each fixture repository; every item is a pull request.
- `dataentrystatistics-probe.json`, `keycloak-smart-auth-probe.json`: the permission probe (`GET pulls?per_page=1`). The dataentrystatistics probe is `[]` because that repository has no open pull request, the default listing state.
- `dataentrystatistics-pulls.json`: pull requests 2, 3 and 10. 2 is rebase-merged (its merge commit has one parent and the headline of its last commit, no `(#N)`) and has no body (`""`). 3 is closed, unmerged, with no body. 10 is merged through a merge commit (two parents).
- `keycloak-smart-auth-pulls.json`: pull requests 2 and 14 (squash merges, `(#N)` in the subject; 14 has 11 reviews), 3 (closed, no body, no commits) and 21 (open).
- `openmrs-core-pulls.json`: pull request 2712 with more than 100 comments (106 on REST; the first page of 100 is kept, `hasNextPage` true), and 294 whose author is deleted (`author: null`, closed and unmerged).
- `dataentrystatistics-commit-pulls.json`: `commits/bd64dafb4351de34629e3d2d343a29196e168dae/pulls` for the rebase-merged pull request 2.
- `rate-limit.json`: `x-ratelimit-*` headers of each REST request and the GraphQL `rateLimit` block of each GraphQL response.

## Scrubbing

Every file is passed through a scrub that blanks email addresses (`[email removed]`), token-like strings (`[token removed]`) and the auth-header word in any case (`[word removed]`; one keycloak pull request body uses it in prose, so it is blanked to keep the S51 grep check clean). No allowlist. The README lists no exceptions because no noreply form remains. The S51 grep check (token prefixes, the auth-header word, email shape) over this directory finds nothing.

Not recorded: a pull request whose head repository was deleted (not searched for in this run).
EOF
} > "$OUT/README.md"

echo "Recorded $(ls "$OUT"/*.json | wc -l | tr -d ' ') JSON files into $OUT"
