#!/usr/bin/env python3
"""Build tests/eval/datasets/o3-history.json and the mining record questions.json from the authored specs below.
Kind (b) gold is computed by each row's stated criterion (see B). PR data and Jira
issues come from mine.py's caches (fetched read-only on a miss)."""
import json, os, re, subprocess
from mine import E, HERE, REPOS, ROOT, jira, pr
from mine_b import window

PIN = {n: r["commit"] for n, r in REPOS.items()}
CORE, REST, ESMCORE, CHART, PM, FEL, ADMIN, BILL, DISP, STOCK = ("openmrs-core", "openmrs-module-webservices.rest", "openmrs-esm-core",
    "openmrs-esm-patient-chart", "openmrs-esm-patient-management", "openmrs-esm-form-engine-lib", "openmrs-esm-admin-tools",
    "openmrs-esm-billing-app", "openmrs-esm-dispensing-app", "openmrs-esm-stock-management-app")
ANYKEY = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
RELATION = {"a": "history-why", "b": "history-what-when", "c": "history-ticket-to-code"}

# Kind (a), round 2 rewrite (D100, option i): targets whose full commit message names no Jira key (mined by mine_a2.py into
# a2-candidates.json); the ticket is reachable only through the PR or the Jira issue. Rows are (id, split, [(repo, short sha)],
# ticket, question, source sentence from the Jira description or a PR body).
MBILL, PDOC = "openmrs-module-billing", "openmrs-module-patientdocuments"
A = [
    ("hist-a-01", "dev", [(CORE, "8ec94d21")], "TRUNK-6670", "In openmrs-core's continuous integration, the scan of third-party libraries for known vulnerabilities crashed with a missing command-line argument on every pull request opened from a fork, whatever that pull request changed. Why did it crash only there, how does the workflow now run the scan when the vulnerability database's key is unavailable, and which change and ticket fixed it?",
     "causes the OWASP dependency check to crash on fork PRs because forks cannot access the"),
    ("hist-a-02", "hidden", [(ESMCORE, "e16e2d9e")], "O3-5629", "In the O3 frontend framework, the wrapper around the browser's fetch call reacts to an unauthorized response either by following the redirect target the server sent back or, when there is none, by going to the configured authentication-failure page, yet neither path was protected by tests. Why was coverage added, what exactly do the new tests pin down, and which change and ticket added them?",
     "Discussed as missing test coverage during the OpenMRS Talk GSoC 2026 frontend architecture."),
    ("hist-a-03", "dev", [(BILL, "db22701b")], "O3-5414", "In the O3 billing app, unpaid bills left behind by visits that patients abandoned stayed in the billing records, and staff had no way to clear them. What was added so they can be cleared, for which bills is it offered and from where, what must the user supply, and which change and ticket added it?",
     "so that unpaid bills from incomplete visits don't clutter the billing system"),
    ("hist-a-04", "dev", [(ESMCORE, "04f538d1")], "O3-5873", "In the O3 frontend, every frontend module's remote entry carried its own complete copy of the loader runtime that federated modules need, roughly two thirds of each entry's size, although that runtime is identical for every module. Why was that a problem, what does the app shell now do so the runtime is downloaded once, and which change and ticket made it so?",
     "the runtime itself is identical across remotes and should ship once"),
    ("hist-a-05", "hidden", [(CHART, "6e8da1b1")], "O3-5652", "In the patient chart's procedures app, the form for recording a past procedure had no scoped concept set in the shared terminology to draw its status choices from. Once a dedicated status concept was published there, what default did the app change, and which change and ticket did it?",
     "since there is no scoped concept set or concept class for either in OCL"),
    ("hist-a-06", "dev", [(ESMCORE, "9f0c6aa8")], "O3-4671", "Implementers asked for the release of O3 a site is running to be visible on the sign-in page. In the O3 frontend, how is that value now supplied when a distribution is assembled, where is it shown by default, what does it read when nobody set it, and which change and ticket added it?",
     "Add the version of O3 running on the login screen."),
    ("hist-a-07", "dev", [(DISP, "120d22e9")], "O3-5734", "In the dispensing app, a pharmacist who started filling a prescription, searched for a patient, began a drug order and then tried to record a new allergy saw the allergy form crash. Why did it crash outside the patient chart, what is launched instead, and which change and ticket fixed it?",
     "Try to record a new allergy"),
    ("hist-a-08", "hidden", [(ADMIN, "fbda0303")], "O3-5965", "In the admin tools' reports app, a few full-width rules aimed at the design system's date picker and dropdown classes never had any visible effect. Why could they never match the rendered markup, what was done about them, and which change and ticket handled it?",
     "cannot match Carbon's markup, and have never had any effect."),
    ("hist-a-09", "dev", [(PM, "e4aacbd5")], "O3-5832", "In O3 patient management, looking up patients was slowed because, for every request that carries no explicit caching-strategy header, the offline service worker reopened its local browser database and rescanned every registered dynamic route. Why was the lookup exposed to that cost, what do its requests now do, and which change and ticket are behind it?",
     "this bypasses an expensive per-request Dexie lookup that was unnecessarily slowing things down."),
    ("hist-a-10", "hidden", [(STOCK, "3c071999")], "O3-4518", "In the stock management app, on a system with more user accounts than the REST module returns by default in one response, an administrator could not find, and so could not give location-scoped stock permissions to, any user left off that first response. Why, and which change and ticket fixed it?",
     "then whatever users are not returned when the user endpoint is queried are unable to be found, and unable to have permissions granted."),
    ("hist-a-11", "dev", [(CHART, "d47d346c")], "RESTWS-1038", "In the patient chart's lab results viewer, one platelet result could show a count of two, because overlapping root concept sets (bloodwork containing haematology, for example) deliver the same observation through several tree branches, while two genuinely separate results with the same value and time collapsed into one row. How was the de-duplication reworked, what server-side change does the ticket propose so clients can tell copies apart, and which change and ticket are these?",
     "which cannot tell those two cases apart."),
    ("hist-a-12", "dev", [(CHART, "d4857fbf")], "O3-4585", "In the patient chart, body mass index values in the biometrics listing were never flagged as low or high the way abnormal vital signs are, because the value was only calculated in the browser. What does the form now store so the server can judge it against reference ranges, how do older encounters still show a value, and which change and ticket are behind it?",
     "Persists BMI as its own observation on the vitals and biometrics encounter so the backend can apply the concept reference ranges"),
    ("hist-a-13", "hidden", [(BILL, "6e4cdcd9"), (MBILL, "c47f6d87")], "O3-5112", "In O3 billing, the list of bills could only be narrowed by payment state, such as pending or paid, and not by when the bills were created. Which changes, one in the billing frontend and one in the billing backend module, made that possible, what does the frontend do when the chosen end comes before the chosen start, and which ticket asked for it?",
     "Currently, the billing list can only be filtered by status, such as pending or paid, without the option to filter records by specific date ranges."),
    ("hist-a-14", "dev", [(CHART, "64d3c990"), (CHART, "b147fb59")], "O3-5741", "In the patient chart, a diagnosis entered through the visit note did not show up under the patient's conditions until the page was reloaded. What did the community decide the conditions list should show instead, what else had to be fixed so those diagnoses still appear with the right visit, and which changes and ticket implement this?",
     "so that encounter-diagnoses (diagnoses added from the visit note form) do not appear in the conditions table"),
    ("hist-a-15", "hidden", [(PDOC, "9fc46c2c")], "O3-5667", "In the patient documents module, only superusers could produce the printable visit summary, even though the code checks a dedicated permission before generating it, because no role could ever be granted that permission. Why, and which change and ticket fixed it?",
     "That made it un-grantable and left visit summary PDF generation effectively superuser-only."),
    ("hist-a-16", "dev", [(CHART, "5ba5b70a")], "O3-5781", "In the patient chart repository, the dependency vulnerability report flagged high-severity findings in three pinned versions of the glob pattern matching library used by the build tooling. Which versions were moved to which patched releases, how was the lockfile made to pick them up, and which change and ticket did this?",
     "Patches 9 High-severity OWASP-flagged CVEs in **minimatch** by bumping each affected version branch to its latest patched release within the same major version."),
]

# Kind (b), round 1 rewrite (D100): gold is computed by a stated criterion over the window that starts the day after
# the pin's committer date minus six months (mine_b.window). Rows are (id, split, repo, criterion, anchor, name[, decl args]):
# - "pickaxe": first-parent commits since then whose diff adds or removes a line containing `name` under directory `anchor`;
# - "decl": first-parent commits since then that changed lines startLine..endLine of file `anchor` (`git log -L`), the
#   function `name` at the pin; `where` says where it lives without naming the file.
B = [
    ("hist-b-01", "dev", CORE, "pickaxe", "api/src/main/java/org/openmrs", "hasPrivilege"),
    ("hist-b-02", "hidden", CORE, "pickaxe", "api/src/main/java/org/openmrs/api", "ThreadLocal"),
    ("hist-b-03", "dev", CORE, "pickaxe", "api/src/main/java/org/openmrs/api/db/hibernate", "CriteriaBuilder"),
    ("hist-b-04", "hidden", CORE, "pickaxe", "web/src/main/java", "doFilterInternal"),
    ("hist-b-05", "dev", ESMCORE, "pickaxe", "packages/framework", "getExtensionConfig"),
    ("hist-b-06", "hidden", ESMCORE, "pickaxe", "packages/tooling/openmrs", "configUrls"),
    ("hist-b-07", "dev", CHART, "decl", "packages/esm-patient-medications-app/src/add-drug-order/drug-order-form.component.tsx", "handleFormSubmission",
     305, 360, "the medications app's drug order form"),
    ("hist-b-08", "dev", FEL, "pickaxe", "src", "voidedValue"),
    ("hist-b-09", "hidden", BILL, "pickaxe", "src", "lineItems"),
    ("hist-b-10", "dev", PM, "pickaxe", "packages/esm-patient-registration-app/src", "SavePatientTransactionManager"),
    ("hist-b-11", "hidden", PM, "pickaxe", "packages/esm-service-queues-app", "encounterProviders"),
    ("hist-b-12", "dev", STOCK, "pickaxe", "src", "restBaseUrl"),
]

# (id, split, repo, short sha, question, source sentence, spans [(path inside the repository, start, end)])
C = [
    ("hist-c-01", "dev", CORE, "21ea98bd", "TRUNK-6796: merging patients can fail with a NullPointerException in `PersonMergeLogData.computeHashValue()` when the prior date of death is null, because the wrong field is null-checked. Which change fixed it, and which lines of openmrs-core carry the fix?",
     "which can cause a NullPointerException when priorDateOfDeath is null.", [("api/src/main/java/org/openmrs/person/PersonMergeLogData.java", 445, 445)]),
    ("hist-c-02", "hidden", CORE, "c21a7cbf", "TRUNK-6683 reports that `ConceptService.getDrugs(...)`, when given both a concept and the option to search drug concept names, still runs an extra full-text query over the ConceptName index whose results are redundant. Which change stopped that, and where in openmrs-core is the fix?",
     "whose results are redundant because the concept is already known and matched directly.", [("api/src/main/java/org/openmrs/api/db/hibernate/HibernateConceptDAO.java", 1582, 1583)]),
    ("hist-c-03", "dev", CORE, "e7052745", "TRUNK-6646: in the scripted (auto) installation, environment variables such as the create-database username and password are silently dropped, so setup falls back to root with no password and fails with \"Access denied\". Which change fixed this, and which lines of openmrs-core implement it?",
     "Those env vars are silently dropped and the corresponding fields fall back to their defaults", [("web/src/main/java/org/openmrs/web/filter/initialization/InitializationFilter.java", 197, 201), ("web/src/main/java/org/openmrs/web/filter/initialization/InitializationFilter.java", 358, 359)]),
    ("hist-c-04", "hidden", CORE, "949b8a17", "TRUNK-6643: when the installation wizard is given a `jdbc:mariadb` URL and has to create the database user, the installation fails because only the MySQL case was handled. Which change fixed it, and which lines of openmrs-core implement the fix?",
     "if the JDBC URL uses jdbc:mariadb instead of jdbc:mysql and a database user need to be created, the setup will fail.",
     [("api/src/main/java/org/openmrs/util/DatabaseUpdater.java", 486, 486), ("web/src/main/java/org/openmrs/web/filter/initialization/InitializationFilter.java", 1437, 1437),
      ("web/src/main/java/org/openmrs/web/filter/initialization/InitializationFilter.java", 1492, 1501), ("web/src/main/java/org/openmrs/web/filter/initialization/InitializationFilter.java", 1518, 1518)]),
    ("hist-c-05", "dev", REST, "070fa8bc", "RESTWS-1037: a user who may get visits but not encounters receives HTTP 500 (\"No serializer found for class java.lang.Object\") from `GET /ws/rest/v1/visit/{uuid}` when the visit has encounters. Which change fixed this, and which lines of the REST module implement the fix?",
     "User has Get Visits but not Get Encounters.",
     [("omod-common/src/main/java/org/openmrs/module/webservices/rest/web/ConversionUtil.java", 366, 372), ("omod-common/src/main/java/org/openmrs/module/webservices/rest/web/ConversionUtil.java", 400, 417),
      ("omod-common/src/main/java/org/openmrs/module/webservices/rest/web/resource/impl/DelegatingResourceDescription.java", 248, 254),
      ("omod-common/src/main/java/org/openmrs/module/webservices/rest/web/resource/impl/BasePageableResult.java", 55, 59)]),
    ("hist-c-06", "dev", ESMCORE, "4cc27d38", "O3-6028: the login screen's location picker always loads 50 locations per request, whatever an implementation configures. Which change made the configured value take effect, and which line of esm-core passes it to the picker?",
     "The picker always fetches 50 locations per request regardless of what an implementation configures",
     [("packages/apps/esm-login-app/src/location-picker/location-picker-view.component.tsx", 181, 181)]),
    ("hist-c-07", "hidden", ESMCORE, "cd6cf1fc", "O3-6093: `extractVariableNames()` in the expression evaluator misses unbound variables used inside arrow-function bodies (for example `a.map(x => f(b))` yields only `a`). Which change fixed it, and which code in esm-core implements the fix?",
     "Inside an arrow-function body, the names it returns are wrong",
     [("packages/framework/esm-expression-evaluator/src/extractor.ts", 92, 119), ("packages/framework/esm-expression-evaluator/src/extractor.ts", 151, 173)]),
    ("hist-c-08", "dev", CHART, "0e06523b", "O3-6100: double-clicking \"Save and close\" on the vitals and biometrics form while the first request is still pending records the same measurements twice. Which change fixed it, and which line of the patient chart does the fix change?",
     "Double-clicking Save and close can save the same vitals twice while the first request is still pending.",
     [("packages/esm-patient-vitals-app/src/vitals-biometrics-form/exported-vitals-biometrics-form.workspace.tsx", 225, 225)]),
    ("hist-c-09", "hidden", CHART, "1c19126f", "O3-6097: in the drug order form, the switch between structured and free-text dosing reads \"On\" when it is off and \"Off\" when it is on. Which change fixed it, and which lines implement the fix?",
     "label reads \"On\"", [("packages/esm-patient-medications-app/src/add-drug-order/drug-order-form.component.tsx", 981, 982)]),
    ("hist-c-10", "dev", PM, "1f409817", "O3-5958: when the login location is not queue-tagged but has a queue-tagged ancestor, the queue location field of the new queue entry form stays blank, even though the Service Queues dashboard picked that ancestor. Which change fixed it, and which lines in patient management implement the fix?",
     "leaving the field blank",
     [("packages/esm-service-queues-app/src/create-queue-entry/queue-fields/queue-fields.component.tsx", 68, 68), ("packages/esm-service-queues-app/src/create-queue-entry/queue-fields/queue-fields.component.tsx", 81, 81)]),
    ("hist-c-11", "hidden", FEL, "6a5b489b", "O3-6048: in the React form engine, the weight-for-height z-score expression throws \"height.toFixed is not a function\" when the height value arrives as a string, so the z-score field stays empty. Which change fixed it, and which lines of the form engine implement the fix?",
     "so it throws height.toFixed is not a function when the height is a string.",
     [("src/utils/common-expression-helpers.ts", 489, 495), ("src/utils/common-expression-helpers.ts", 509, 513)]),
    ("hist-c-12", "dev", ADMIN, "f462a28b", "O3-5993: running a report with a required parameter left blank shows the placeholder text instead of naming the parameter that is missing. Which change fixed the message, and which line of the admin tools implements it?",
     "The placeholder is printed literally, so the user is never told which parameter is missing.",
     [("packages/esm-reports-app/src/components/reports-data-overview.component.tsx", 84, 84)]),
]


def git(repo, *args):
    return subprocess.check_output(["git", "-C", os.path.join(E, REPOS[repo]["checkout"]), *args], text=True)


norm = lambda s: re.sub(r"\s+", " ", s.replace("’", "'").replace("\\\"", "\"")).strip()


def change(repo, short):
    sha, date, subject = git(repo, "log", "-1", "--format=%H%x09%cI%x09%s", short).strip().split("\t")
    num = int(re.search(r"\(#(\d+)\)\s*$", subject).group(1))
    p = pr(repo, num)
    assert p["mergeCommit"] == sha, (repo, sha, p["mergeCommit"])
    key = re.search(r"\b(TRUNK|RESTWS|O3)-\d+\b", subject)
    return {"repo": repo, "commit": sha, "pr": num, "prUrl": p["url"], "mergedAt": p["mergedAt"], "commitDate": date, "subject": subject,
            "ticket": key and key.group(0)}


def main():
    questions, record = [], []
    # Kind (a), round 2 (D100, option i): no commit message names a key; the ticket is reachable only through the PR
    # (title, body or branch) or a Jira issue that names the PR's URL. A row may list more than one change for its ticket.
    for qid, split, targets, ticket, text, source in A:
        chs = [change(repo, short) for repo, short in targets]
        t = jira(ticket)
        bodies = [pr(c["repo"], c["pr"])["body"] for c in chs]
        where = "jira" if norm(source) in norm(t.get("description", "")) else "pr" if any(norm(source) in norm(b) for b in bodies) else None
        assert where, (qid, "source sentence not found")
        changes = []
        for c in chs:
            assert not ANYKEY.search(git(c["repo"], "log", "-1", "--format=%B", c["commit"])), (qid, c["commit"], "commit message names a key")
            p = pr(c["repo"], c["pr"])
            branch = next(x["branch"] for x in json.load(open(os.path.join(HERE, "cache/prlist", c["repo"] + ".json"))) if x["number"] == c["pr"])
            key_in = [w for w, v in (("pr title", p["title"]), ("pr body", p["body"]), ("pr branch", branch)) if re.search(rf"\b{ticket}\b", v, re.I)]
            if not key_in:
                assert ticket in json.load(open(os.path.join(HERE, "cache/jiralink", f"{c['repo']}#{c['pr']}.json"))), (qid, "ticket not linked to the PR")
                key_in = ["jira issue text names the PR URL"]
            changes.append({k: c[k] for k in ("repo", "commit", "subject", "pr", "prUrl", "mergedAt", "commitDate")} | {"commitMessageHasKey": False, "keyIn": key_in})
        required = [{"repo": c["repo"], "commit": c["commit"], "pr": c["pr"]} for c in chs] + [{"ticket": ticket}]
        questions.append({"id": qid, "question": text, "vocab": "natural", "split": split, "author": "history-probe", "relation": RELATION["a"], "required": required})
        record.append({"id": qid, "kind": "a", "split": split, "repo": chs[0]["repo"], "ticket": ticket, "ticketUrl": t["url"], "sourceFrom": where, "source": source, "changes": changes})
    for row in C:
        qid, split, repo, short, text, source = row[:6]
        ch = change(repo, short)
        t = jira(ch["ticket"])
        where = "jira" if norm(source) in norm(t.get("description", "")) else "pr" if norm(source) in norm(pr(repo, ch["pr"])["body"]) else None
        assert where, (qid, "source sentence not found")
        required = [{"repo": repo, "commit": ch["commit"], "pr": ch["pr"]}, {"ticket": ch["ticket"]}]
        required += [{"path": f"{repo}/{p}", "startLine": s, "endLine": e} for p, s, e in row[6]]
        questions.append({"id": qid, "question": text, "vocab": "natural", "split": split, "author": "history-probe", "relation": RELATION["c"], "required": required})
        record.append({"id": qid, "kind": "c", "split": split, "repo": repo, "commit": ch["commit"], "subject": ch["subject"], "pr": ch["pr"], "prUrl": ch["prUrl"],
                       "ticket": ch["ticket"], "ticketUrl": t["url"], "mergedAt": ch["mergedAt"], "commitDate": ch["commitDate"], "sourceFrom": where, "source": source})
    for qid, split, repo, criterion, anchor, name, *decl in B:
        since, pin = window(repo), PIN[repo]
        if criterion == "pickaxe":
            shas = git(repo, "log", "--first-parent", "--format=%h", f"--since={since}", f"-G{name}", pin, "--", anchor).split()
            listed = git(repo, "log", "--first-parent", "--format=%h", f"--since={since}", pin, "--", anchor).split()
            text = (f"In {repo}, which merged pull requests since {since} added or removed a line containing `{name}` in any file under `{anchor}`, "
                    "and when was each merged? Count only commits on the main line up to the pinned head.")
        else:
            s0, e0, where = decl
            shas = [l.split()[1] for l in git(repo, "log", "--first-parent", f"--since={since}", f"-L{s0},{e0}:{anchor}", "-s", "--format=@@C %h", pin).split("\n") if l.startswith("@@C")]
            listed = git(repo, "log", "--first-parent", "--format=%h", f"--since={since}", pin, "--", anchor).split()
            text = (f"In {repo}, which merged pull requests since {since} changed the body of `{name}`, the submit handler of {where}, as that function stands at the pinned head, "
                    "and when was each merged? Count only commits on the main line, and only those whose diff touches that function, not other parts of its file.")
        changes = [change(repo, s) for s in shas]
        assert len(changes) >= 4 and len(listed) >= len(changes) + 2, (qid, len(changes), len(listed))
        questions.append({"id": qid, "question": text, "vocab": "code", "split": split, "author": "history-probe", "relation": RELATION["b"],
                          "required": [{"repo": repo, "commit": c["commit"], "pr": c["pr"]} for c in changes]})
        rec = {"id": qid, "kind": "b", "split": split, "repo": repo, "criterion": criterion, "since": since, "anchorCommits": len(listed)}
        rec.update({"dir": anchor, "token": name} if criterion == "pickaxe" else {"path": anchor, "decl": name, "startLine": decl[0], "endLine": decl[1]})
        rec["changes"] = [{k: c[k] for k in ("commit", "subject", "pr", "prUrl", "mergedAt", "commitDate", "ticket")} for c in changes]
        record.append(rec)
    questions.sort(key=lambda q: q["id"])
    record.sort(key=lambda r: r["id"])
    impact = json.load(open(os.path.join(ROOT, "tests/eval/datasets/o3-impact.json")))
    used = sorted({g["repo"] for q in questions for g in q["required"] if "repo" in g}, key=list(PIN).index)
    dataset = {"id": "o3-history", "repo": impact["repo"],
               "corpus": {"include": ["**/*"], "exclude": [], "product": {"id": "openmrs", "reference": "products/openmrs.json", "commits": {n: PIN[n] for n in used}}},
               "questions": questions}
    open(os.path.join(ROOT, "tests/eval/datasets/o3-history.json"), "w").write(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n")
    open(os.path.join(HERE, "questions.json"), "w").write(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    print(len(questions), "questions")


main()
