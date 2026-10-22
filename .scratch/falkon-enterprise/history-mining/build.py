#!/usr/bin/env python3
"""Build tests/eval/datasets/o3-history.json and the mining record questions.json from the authored specs below.
Kind (b) gold is computed: every first-parent commit touching `path` from `since` to the pin. PR data and Jira
issues come from mine.py's caches (fetched read-only on a miss)."""
import json, os, re, subprocess
from mine import E, HERE, REPOS, ROOT, jira, pr

PIN = {n: r["commit"] for n, r in REPOS.items()}
CORE, REST, ESMCORE, CHART, PM, FEL, ADMIN, BILL, DISP, STOCK = ("openmrs-core", "openmrs-module-webservices.rest", "openmrs-esm-core",
    "openmrs-esm-patient-chart", "openmrs-esm-patient-management", "openmrs-esm-form-engine-lib", "openmrs-esm-admin-tools",
    "openmrs-esm-billing-app", "openmrs-esm-dispensing-app", "openmrs-esm-stock-management-app")
RELATION = {"a": "history-why", "b": "history-what-when", "c": "history-ticket-to-code"}

# (id, split, repo, short sha, question, source sentence from the Jira description or PR body)
A = [
    ("hist-a-01", "dev", CORE, "2d32d209", "openmrs-core's web.xml now maps a servlet filter that strips a final `/` from request paths before they reach Spring. Why was that needed (what did REST and FHIR clients get back for such URLs in the 3.0 line), and which change and ticket introduced it?",
     "On core 3.0, a URL with a trailing slash no longer reaches the handler for the same URL without it."),
    ("hist-a-02", "hidden", CORE, "085d24ca", "openmrs-core now registers a filter that collapses runs of `/` in the request URI, so that `/openmrs//ws/rest/v1/session` is handled like `/openmrs/ws/rest/v1/session`. What error did such requests hit before, and which change and ticket added the filter?",
     "a request whose path has a double slash after the context path fails with 500"),
    ("hist-a-03", "dev", CORE, "83411b2f", "Why does openmrs-core create its JobRunr background job server with `startBackgroundJobServer = false` and start it later from a separate lifecycle class? Which change made that so, and which ticket describes the startup failures it fixes?",
     "The JobRunr background job server is started while its Spring application context is still being created, so jobs can run before the context, or OpenMRS, is ready."),
    ("hist-a-04", "dev", CORE, "b64e0729", "Why did openmrs-core stop relying on a per-thread counter to decide whether `Context.closeSession()` should unbind and close the current Hibernate session? Errors such as \"Pre-bound JDBC Connection found!\" were one symptom. Which change made the switch, and which ticket explains it?",
     "decides whether to close the thread's Hibernate session using a per-thread counter, not by checking who bound the session."),
    ("hist-a-05", "hidden", CORE, "b147e0dc", "Why is the `childLocations` association of openmrs-core's `Location` mapped without orphan removal, so that moving a child location under another parent no longer deletes it? Which change set it that way, and which ticket asked for it?",
     "so any code that removes an entry from childLocations (e.g. re-parenting a location) now silently issues a DELETE of that location row on flush."),
    ("hist-a-06", "dev", CORE, "6e77bfd0", "openmrs-core's `HandlerUtil` keeps its handler lookups in a `ConcurrentHashMap` instead of a weak-keyed map. What was going wrong with the old lookup store on save, void, retire and validation calls, and which change and ticket made the switch?",
     "HandlerUtil caches handler lookups in a WeakHashMap whose keys are referenced by nothing but the map itself, so any GC cycle can evict the entire cache."),
    ("hist-a-07", "dev", CORE, "e2056c9a", "Why does openmrs-core's `LoggingAdvice.invoke()` now return straight to the wrapped service method when neither DEBUG nor TRACE output would be logged for it? Which change added that, and which ticket motivated it?",
     "verify that any messages it generates will be logged before generating them"),
    ("hist-a-08", "hidden", CORE, "0e0255b8", "Why does openmrs-core's `ChainingInterceptor` now override the Hibernate 7 persist and remove callbacks itself instead of only the deprecated save and delete ones? What did database event consumers miss before, and which change and ticket made it?",
     "core's EventInterceptor never publishes a SaveDbEvent when a new entity is created, and never publishes a DeleteDbEvent when an entity is removed."),
    ("hist-a-09", "dev", REST, "ce758bc0", "Why does the REST module's `AuthorizationFilter` no longer answer 401 \"Session timed out\" on `/ws/rest/v1/session` when the request carries a cookie for an expired HTTP session? Which change and ticket made that exception?",
     "As a result, a client holding an old cookie gets a 401 from the session endpoint."),
    ("hist-a-10", "hidden", REST, "66d284b5", "Why does the REST module's `BaseRestController` now map Spring Security's access-denied exception to 401/403 in the way it already treated the older OpenMRS authentication exception? What were clients getting instead, and which change and ticket fixed it?",
     "so these requests now return 500 instead of 401 or 403."),
    ("hist-a-11", "dev", ESMCORE, "57315b89", "Why does the global unhandled-rejection handler in esm-error-handling turn the rejection reason into text before it dispatches a toast? What happened when the reason was an `Error` object, and which change and ticket fixed it?",
     "React cannot render an object as a child, so the toast fails to render"),
    ("hist-a-12", "dev", CHART, "50773fe3", "Why were the age comparisons in the vitals app's `getMuacColorCode` changed so that all colour cases in an age bracket share one bound? Which patients ended up with no colour at all before, and which change and ticket fixed it?",
     "This means a patient exactly 5 years old with a healthy MUAC value (e.g. 13cm) gets no color code at all."),
    ("hist-a-13", "hidden", CHART, "c7d6eb8d", "Why did the form-entry app's `FeWrapperComponent` change the way it lazily imports Angular's locale data? What had the Angular form engine been falling back to for dates and numbers, and which change and ticket fixed it?",
     "registerLocaleData() has therefore never run."),
    ("hist-a-14", "dev", PM, "b4b76423", "Why does the patient registration app's form manager now keep identifier values it has already generated across save attempts? What went wrong when a partly completed save was tried again, and which change and ticket addressed it?",
     "Retrying a partially completed save can consume multiple generated identifier values."),
    ("hist-a-15", "hidden", FEL, "129c1f7f", "Why were the contents of the React form engine's `hfa_girls_5_above.json` z-score table replaced? What was wrong with the old table for girls aged 5 and over, and which change and ticket fixed it?",
     "The two files are byte-identical, and every row's median matches WHO's published boys' values rather than the girls'."),
    ("hist-a-16", "dev", BILL, "3ecce2a5", "Why does the billing app's printable invoice now base the outstanding amount it shows on the bill's net amount? What did a fully paid bill with a discount show before, and which change and ticket fixed it?",
     "On a fully paid bill with a discount applied, the Amount balance in the header and the Balance below Total tendered should both read zero, not the discount amount."),
]

# (id, split, repo, path inside the repository, since)
B = [
    ("hist-b-01", "dev", CORE, "api/src/main/java/org/openmrs/api/db/hibernate/HibernateConceptDAO.java", "2026-04-13"),
    ("hist-b-02", "hidden", CORE, "api/src/main/java/org/openmrs/Location.java", "2026-04-13"),
    ("hist-b-03", "dev", CORE, "api/src/main/java/org/openmrs/api/context/ServiceContext.java", "2026-04-13"),
    ("hist-b-04", "hidden", CORE, "api/src/main/java/org/openmrs/api/cache/RolePrivilegeCache.java", "2026-04-13"),
    ("hist-b-05", "dev", ESMCORE, "packages/framework/esm-expression-evaluator/src/extractor.ts", "2026-04-10"),
    ("hist-b-06", "hidden", ESMCORE, "packages/apps/esm-login-app/src/login.resource.ts", "2026-04-10"),
    ("hist-b-07", "dev", CHART, "packages/esm-patient-notes-app/src/notes/visit-notes.resource.ts", "2026-04-15"),
    ("hist-b-08", "dev", FEL, "src/utils/common-expression-helpers.ts", "2026-04-15"),
    ("hist-b-09", "hidden", BILL, "src/invoice/printable-invoice/printable-invoice.component.tsx", "2026-04-15"),
    ("hist-b-10", "dev", PM, "packages/esm-patient-registration-app/src/patient-registration/field/address/address-field.component.tsx", "2026-04-15"),
    ("hist-b-11", "hidden", DISP, "src/forms/dispense-form.workspace.tsx", "2026-04-13"),
    ("hist-b-12", "dev", STOCK, "src/stock-reports/stock-reports.resource.ts", "2026-04-13"),
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
    for kind, rows in (("a", A), ("c", C)):
        for row in rows:
            qid, split, repo, short, text, source = row[:6]
            ch = change(repo, short)
            t = jira(ch["ticket"])
            where = "jira" if norm(source) in norm(t.get("description", "")) else "pr" if norm(source) in norm(pr(repo, ch["pr"])["body"]) else None
            assert where, (qid, "source sentence not found")
            required = [{"repo": repo, "commit": ch["commit"], "pr": ch["pr"]}, {"ticket": ch["ticket"]}]
            if kind == "c":
                required += [{"path": f"{repo}/{p}", "startLine": s, "endLine": e} for p, s, e in row[6]]
            questions.append({"id": qid, "question": text, "vocab": "natural", "split": split, "author": "history-probe", "relation": RELATION[kind], "required": required})
            record.append({"id": qid, "kind": kind, "split": split, "repo": repo, "commit": ch["commit"], "subject": ch["subject"], "pr": ch["pr"], "prUrl": ch["prUrl"],
                           "ticket": ch["ticket"], "ticketUrl": t["url"], "mergedAt": ch["mergedAt"], "commitDate": ch["commitDate"], "sourceFrom": where, "source": source})
    for qid, split, repo, path, since in B:
        shas = git(repo, "log", "--first-parent", "--format=%h", f"--since={since}", PIN[repo], "--", path).split()
        changes = [change(repo, s) for s in shas]
        text = f"Which merged pull requests changed `{path}` in {repo} between {since} and the pinned head, and when was each merged?"
        questions.append({"id": qid, "question": text, "vocab": "code", "split": split, "author": "history-probe", "relation": RELATION["b"],
                          "required": [{"repo": repo, "commit": c["commit"], "pr": c["pr"]} for c in changes]})
        record.append({"id": qid, "kind": "b", "split": split, "repo": repo, "path": path, "since": since,
                       "changes": [{k: c[k] for k in ("commit", "subject", "pr", "prUrl", "mergedAt", "commitDate", "ticket")} for c in changes]})
    questions.sort(key=lambda q: q["id"])
    record.sort(key=lambda r: r["id"])
    impact = json.load(open(os.path.join(ROOT, "tests/eval/datasets/o3-impact.json")))
    used = sorted({r["repo"] for r in record}, key=list(PIN).index)
    dataset = {"id": "o3-history", "repo": impact["repo"],
               "corpus": {"include": ["**/*"], "exclude": [], "product": {"id": "openmrs", "reference": "products/openmrs.json", "commits": {n: PIN[n] for n in used}}},
               "questions": questions}
    open(os.path.join(ROOT, "tests/eval/datasets/o3-history.json"), "w").write(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n")
    open(os.path.join(HERE, "questions.json"), "w").write(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    print(len(questions), "questions")


main()
