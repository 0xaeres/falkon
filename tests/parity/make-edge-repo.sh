#!/usr/bin/env bash
# Deterministic synthetic repo exercising indexing and matching edge cases:
# branches + tags, unicode, CRLF, tabs, a long line, binary, an oversized file, minified JS,
# a symlink, deep paths, and file names that only match on name.
set -euo pipefail
DIR="$1"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"
export GIT_AUTHOR_NAME=parity GIT_AUTHOR_EMAIL=parity@example.test
export GIT_COMMITTER_NAME=parity GIT_COMMITTER_EMAIL=parity@example.test
export GIT_AUTHOR_DATE="2026-01-01T00:00:00Z" GIT_COMMITTER_DATE="2026-01-01T00:00:00Z"
git init --quiet -b main
git remote add origin https://example.test/fixtures/edge.git

mkdir -p src/deep/nested/path docs bin
cat > src/main.go <<'EOF'
package main

import "fmt"

// ParityNeedle is searched for by the parity corpus.
type ParityNeedle struct {
	Name string
}

func (p *ParityNeedle) Greet() string {
	return fmt.Sprintf("hello %s", p.Name)
}

func main() {
	n := &ParityNeedle{Name: "world"}
	fmt.Println(n.Greet())
}
EOF
cat > src/util.py <<'EOF'
class ParityNeedle:
    """Python twin of the Go type."""

    def greet(self, name: str) -> str:
        return f"hello {name}"


def parity_helper(x):
    # TODO: parity marker
    return x * 2
EOF
printf 'line one\r\nParityNeedle on a CRLF line\r\nline three\r\n' > docs/crlf.txt
printf 'héllo wörld — ünïcode ParityNeedle 日本語 🎉 after-emoji\nκόσμε second line\n' > docs/unicode.md
printf '\tindented\twith\ttabs ParityNeedle\n' > docs/tabs.txt
node -e 'process.stdout.write("x".repeat(5000) + " ParityNeedle " + "y".repeat(5000) + "\n")' > docs/longline.txt
head -c 4096 /dev/zero | tr '\0' '\1' > bin/blob.bin
printf 'ParityNeedle\0binary\n' >> bin/blob.bin
node -e 'process.stdout.write(("ParityNeedle big file line\n").repeat(110000))' > docs/oversized.txt
node -e 'let s="";for(let i=0;i<40000;i++)s+="var a"+i+"=function(b"+i+"){return b"+i+"*"+i+"};";process.stdout.write(s+"ParityNeedle\n")' > src/bundle.min.js
echo "only the name matches" > src/deep/nested/path/parityneedle_name_only.txt
ln -s ../src/main.go docs/link-to-main.go
cat > README.md <<'EOF'
# edge fixture
Case variants: parityneedle PARITYNEEDLE ParityNeedle
Regex bait: foo.bar foo+bar (group) [class] a|b
EOF
git add -A && git commit --quiet -m "initial"
git tag v1.0.0

git checkout --quiet -b feature/branch-only
echo "BranchOnlyNeedle lives only on feature/branch-only" > src/branch_only.txt
git add -A && git commit --quiet -m "branch only"

git checkout --quiet -b release/1.0 main
echo "ReleaseNeedle lives only on release/1.0" > src/release_only.txt
git add -A && git commit --quiet -m "release"
git tag v1.1.0

git checkout --quiet main
echo "MainOnlyNeedle added after tags" > src/main_only.txt
git add -A && git commit --quiet -m "main only"
echo "built edge repo at $DIR @ $(git rev-parse HEAD)"
