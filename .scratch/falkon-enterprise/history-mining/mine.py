#!/usr/bin/env python3
"""Resolve candidates.txt (repo, short sha) into mined (commit, PR, ticket) triples.
Read-only: git in the checkouts, `gh pr view`, anonymous Jira REST. Responses are cached
(trimmed) under cache/. Output: candidates.json."""
import json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../.."))
E = os.environ.get("EVAL_O3_DIR", "/Users/aeres/Desktop/projects/falkon/.local/eval")
REPOS = {r["name"]: r for r in json.load(open(os.path.join(ROOT, "tests/eval/datasets/o3.json")))["repositories"]}
KEY = re.compile(r"\b(TRUNK|RESTWS|O3)-\d+\b")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", os.path.join(E, REPOS[repo]["checkout"]), *args], text=True)


def adf_text(n):
    if isinstance(n, dict):
        t = n.get("text", "")
        kids = "".join(adf_text(c) for c in n.get("content", []))
        sep = "\n" if n.get("type") in ("paragraph", "heading", "listItem", "codeBlock") else ""
        return t + kids + sep
    return ""


def jira(key):
    path = os.path.join(HERE, "cache/jira", key + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    time.sleep(0.5)
    try:
        raw = json.load(urllib.request.urlopen(f"https://openmrs.atlassian.net/rest/api/3/issue/{key}?fields=summary,description,status,created,resolutiondate", timeout=30))
        f = raw["fields"]
        out = {"key": raw["key"], "url": f"https://openmrs.atlassian.net/browse/{raw['key']}", "summary": f["summary"],
               "status": f["status"]["name"], "created": f["created"], "resolved": f.get("resolutiondate"),
               "description": adf_text(f["description"]).strip()[:4000] if f.get("description") else ""}
    except Exception as e:  # noqa: BLE001
        out = {"key": key, "error": str(e)}
    json.dump(out, open(path, "w"), indent=1)
    return out


def pr(repo, num):
    path = os.path.join(HERE, "cache/pr", f"{repo}#{num}.json")
    if os.path.exists(path):
        return json.load(open(path))
    raw = json.loads(subprocess.check_output(["gh", "pr", "view", str(num), "-R", f"openmrs/{repo}", "--json", "number,title,body,url,mergedAt,mergeCommit,files"], text=True))
    out = {"number": raw["number"], "url": raw["url"], "title": raw["title"], "mergedAt": raw["mergedAt"],
           "mergeCommit": (raw.get("mergeCommit") or {}).get("oid"), "body": (raw["body"] or "")[:4000],
           "files": [f["path"] for f in raw["files"]][:60]}
    json.dump(out, open(path, "w"), indent=1)
    return out


def main():
    cands = []
    for line in open(os.path.join(HERE, "candidates.txt")):
        if not line.strip():
            continue
        repo, short = line.split()
        sha, date, subject = git(repo, "log", "-1", "--format=%H%x09%cI%x09%s", short).strip().split("\t")
        m = re.search(r"\(#(\d+)\)\s*$", subject)
        num = int(m.group(1)) if m else None
        keys = sorted(set(k.group(0) for k in KEY.finditer(subject)))
        p = pr(repo, num) if num else None
        same = {k: git(repo, "log", "--format=%H", "-E", f"--grep={k}([^0-9]|$)",REPOS[repo]["commit"]).split() for k in keys}
        cands.append({"repo": repo, "commit": sha, "date": date, "subject": subject, "pr": num, "prUrl": p and p["url"],
                      "prMergeCommit": p and p["mergeCommit"], "tickets": [jira(k) for k in keys],
                      "sameTicketCommits": same, "files": git(repo, "show", "--format=", "--name-only", sha).split()})
        print(repo, sha[:8], num, keys, {k: len(v) for k, v in same.items()}, file=sys.stderr)
    json.dump(cands, open(os.path.join(HERE, "candidates.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
