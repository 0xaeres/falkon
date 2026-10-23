#!/usr/bin/env python3
"""Mine kind (b) candidates for the round 1 rewrite (D100). Two mechanical gold criteria, both recomputed by validate.mjs:
- "pickaxe": in a module directory, the first-parent commits since a date whose diff adds or removes a line containing
  an identifier (`git log --first-parent --since=S -G<identifier> PIN -- DIR`); at least 4 of them, and the directory
  has at least 4 more commits than that, so listing the directory's commits is not the answer.
- "decl": a function at the pin whose line range, followed back with `git log --first-parent -L`, was changed by at
  least 4 PRs, in a file at least 2 more commits touched.
Every gold commit must be a squash-merged PR ("(#N)" subject). Read-only git. Output: b-candidates.json."""
import json, os, re, subprocess, sys
from collections import defaultdict
from datetime import datetime, timedelta
from mine import E, HERE, REPOS

REPOS_B = ["openmrs-core", "openmrs-module-webservices.rest", "openmrs-esm-core", "openmrs-esm-patient-chart", "openmrs-esm-patient-management",
           "openmrs-esm-form-engine-lib", "openmrs-esm-billing-app", "openmrs-esm-dispensing-app", "openmrs-esm-stock-management-app", "openmrs-esm-admin-tools"]
TS = re.compile(r"^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)?\s*(?::[^=]+)?=>)")
JAVA = re.compile(r"^(\s+)(?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)+[\w<>\[\], ?.]+\s+(\w+)\s*\(")
IDENT = re.compile(r"\b[a-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b|\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b")
SKIP = re.compile(r"(test|spec|__mocks__|e2e|translations|mock|\.json$|\.md$|\.lock$|yarn|pom\.xml|\.github|\.scss$)", re.I)
PR = re.compile(r"\(#\d+\)\s*$")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", os.path.join(E, REPOS[repo]["checkout"]), *args], text=True, stderr=subprocess.DEVNULL, errors="replace")


def window(repo):
    date = datetime.fromisoformat(git(repo, "log", "-1", "--format=%cI", REPOS[repo]["commit"]).strip())
    return (date.replace(month=date.month - 6) + timedelta(days=1)).date().isoformat()


def pickaxe(repo, since, pin, found):
    subj, files = {}, defaultdict(set)
    cur = None
    for line in git(repo, "log", "--first-parent", f"--since={since}", "--format=@@C%x09%H%x09%s", "--name-only", pin).split("\n"):
        if line.startswith("@@C"):
            _, cur, s = line.split("\t", 2); subj[cur] = s
        elif line and cur and not SKIP.search(line):
            files[cur].add(line)
    dirs = defaultdict(set)
    for c, fs in files.items():
        for f in fs:
            parts = f.split("/")[:-1]
            for d in range(1, len(parts) + 1):
                dirs["/".join(parts[:d])].add(c)
    for d, commits in sorted(dirs.items()):
        if not 10 <= len(commits) <= 80:
            continue
        hits = defaultdict(set)
        cur = None
        for line in git(repo, "log", "--first-parent", f"--since={since}", "-U0", "--format=@@C%x09%H", pin, "--", d).split("\n"):
            if line.startswith("@@C"):
                cur = line.split("\t")[1]
            elif cur and line[:1] in "+-" and not line.startswith(("+++", "---")):
                for t in IDENT.findall(line):
                    hits[t].add(cur)
        for t, hs in hits.items():
            if 4 <= len(hs) <= 8 and len(commits) >= len(hs) + 4 and all(PR.search(subj.get(h, "")) for h in hs):
                found.append({"repo": repo, "kind": "pickaxe", "since": since, "dir": d, "token": t, "dirCommits": len(commits), "gold": len(hs)})


def decl(repo, since, pin, found):
    counts = defaultdict(int)
    for path in git(repo, "log", "--first-parent", f"--since={since}", "--format=", "--name-only", pin).split():
        counts[path] += 1
    for path, n in counts.items():
        if n < 6 or SKIP.search(path) or not path.endswith((".java", ".ts", ".tsx")):
            continue
        try:
            lines = git(repo, "show", f"{pin}:{path}").split("\n")
        except subprocess.CalledProcessError:
            continue
        ds = []
        for i, line in enumerate(lines):
            m = (JAVA if path.endswith(".java") else TS).match(line)
            if m:
                name = next(g for g in m.groups()[1:] if g)
                end = next((j for j in range(i + 1, len(lines)) if re.match(re.escape(m.group(1)) + r"[}\)]", lines[j])), None)
                if end is not None and end - i >= 3:
                    ds.append((name, i + 1, end + 1))
        names = [x[0] for x in ds]
        for name, s, e in ds:
            if names.count(name) > 1:
                continue
            log = git(repo, "log", "--first-parent", f"--since={since}", f"-L{s},{e}:{path}", "-s", "--format=@@C%x09%H%x09%s", pin)
            hs = [l.split("\t") for l in log.split("\n") if l.startswith("@@C")]
            if len(hs) >= 4 and n >= len(hs) + 2 and all(PR.search(h[2]) for h in hs):
                found.append({"repo": repo, "kind": "decl", "since": since, "path": path, "decl": name, "startLine": s, "endLine": e, "fileCommits": n, "gold": len(hs)})


def main():
    found = []
    for repo in REPOS_B:
        since, pin = window(repo), REPOS[repo]["commit"]
        pickaxe(repo, since, pin, found)
        decl(repo, since, pin, found)
        print(repo, sum(f["repo"] == repo for f in found), file=sys.stderr)
    json.dump(found, open(os.path.join(HERE, "b-candidates.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
