#!/usr/bin/env python3
"""Mine kind (a) candidates for the round 2 rewrite (D100, option i): squash-merged first-parent commits in the D96 window
whose full message names no Jira key, while the PR (title, body or branch) names one TRUNK, RESTWS or O3 key, or, when
it names none, exactly one Jira issue names the PR URL; the key must resolve on the public Jira and no commit reachable
from any corpus pin may name it. Read-only: git, `gh pr list` (one paginated call per
repository, cached under cache/prlist/), anonymous Jira (cached by mine.jira). Output: a2-candidates.json."""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from mine import HERE, REPOS, jira
from mine_b import git, window

ANYKEY = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
KEY = re.compile(r"\b(TRUNK|RESTWS|O3)-\d+\b", re.I)
NOISE = re.compile(r"translation|transifex|\bbump|release|dependabot|renovate", re.I)
A_REPOS = [n for n in REPOS if n != "openmrs-contrib-o3-docs"]


def prlist(repo, since):
    path = os.path.join(HERE, "cache/prlist", repo + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = json.loads(subprocess.check_output(["gh", "pr", "list", "-R", f"openmrs/{repo}", "--state", "merged", "--search", f"merged:>={since}", "--limit", "1000",
                                              "--json", "number,title,body,headRefName,url,mergedAt,mergeCommit"], text=True))
    out = [{"number": p["number"], "url": p["url"], "title": p["title"], "branch": p["headRefName"], "mergedAt": p["mergedAt"],
            "mergeCommit": (p.get("mergeCommit") or {}).get("oid"), "body": (p["body"] or "")[:4000]} for p in raw]
    json.dump(out, open(path, "w"), indent=1)
    return out


def linked(repo, num):
    """Jira issues whose description, comments or remote links name the PR's URL (anonymous search, cached)."""
    path = os.path.join(HERE, "cache/jiralink", f"{repo}#{num}.json")
    if os.path.exists(path):
        return json.load(open(path))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = f"github.com/openmrs/{repo}/pull/{num}"
    q = urllib.parse.urlencode({"jql": f'text ~ "\\"{repo}/pull/{num}\\""', "fields": "summary,description,comment", "maxResults": 50})
    time.sleep(0.3)
    issues = json.load(urllib.request.urlopen(f"https://openmrs.atlassian.net/rest/api/3/search/jql?{q}", timeout=30))["issues"]
    out = sorted(i["key"] for i in issues if re.search(re.escape(url) + r"(?!\d)", json.dumps(i["fields"])))
    json.dump(out, open(path, "w"))
    return out


def main():
    found, counts = [], {}
    # A key any corpus commit names is recoverable from git, whichever repository it is in.
    named = "\n".join(git(r, "log", "--format=%B", REPOS[r]["commit"]) for r in REPOS)
    for repo in A_REPOS:
        since, pin = window(repo), REPOS[repo]["commit"]
        prs = {p["mergeCommit"]: p for p in prlist(repo, since)}
        n = 0
        for rec in git(repo, "log", "--first-parent", f"--since={since}", "--format=%H%x1f%cI%x1f%s%x1f%B%x1e", pin).split("\x1e"):
            if not rec.strip():
                continue
            sha, date, subject, body = rec.strip().split("\x1f", 3)
            m = re.search(r"\(#(\d+)\)\s*$", subject)
            p = prs.get(sha)
            if not m or not p or p["number"] != int(m.group(1)) or ANYKEY.search(body) or NOISE.search(subject) or re.search(r"\b(TRUNK|RESTWS|O3)[ _]\d+", body, re.I):
                continue
            text = " ".join((p["title"], p["body"], p["branch"]))
            keys = sorted({k.group(0).upper() for k in KEY.finditer(text)})
            if len(keys) > 1:  # several keys in the PR: keep the one in its title or branch, if exactly one is
                keys = [k for k in keys if re.search(rf"\b{k}\b", p["title"] + " " + p["branch"], re.I)]
            if not keys:
                keys = [k for k in linked(repo, p["number"]) if KEY.fullmatch(k)]
            if len(keys) != 1 or re.search(rf"\b{keys[0]}([^0-9]|$)", named, re.I):
                continue
            t = jira(keys[0])
            if t.get("error"):
                continue
            where = [w for w, s in (("title", p["title"]), ("body", p["body"]), ("branch", p["branch"])) if re.search(rf"\b{keys[0]}\b", s, re.I)] or ["jira"]
            found.append({"repo": repo, "commit": sha, "date": date, "subject": subject, "message": body, "pr": p["number"], "prUrl": p["url"],
                          "prTitle": p["title"], "branch": p["branch"], "keyIn": where, "ticket": keys[0], "ticketUrl": t["url"], "summary": t["summary"],
                          "description": t["description"][:1500], "prBody": p["body"][:1500],
                          "files": git(repo, "show", "--format=", "--name-only", sha).split()})
            n += 1
        counts[repo] = n
        print(repo, since, len(prs), n, file=sys.stderr)
    json.dump(found, open(os.path.join(HERE, "a2-candidates.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps(counts), file=sys.stderr)


if __name__ == "__main__":
    main()
