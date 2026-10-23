import { test } from "node:test";
import assert from "node:assert/strict";
import { discussionLinks, likePattern, parseTicketKeys, searchBounds, ticketKeys } from "./provenance";
import { fakeProvenanceStore } from "./provenance.fake";
import { CONTRACT_REPOS, provenanceStoreContract } from "./provenance.contract";

const KEYS = ["TRUNK", "RESTWS", "O3"];

test("ticket keys: configured projects in any case, Jira browse links, no generic pattern", () => {
  assert.deepEqual(ticketKeys("TRUNK-6670: fix scan; see also RESTWS-12 and O3-4419", KEYS), ["TRUNK-6670", "RESTWS-12", "O3-4419"]);
  assert.deepEqual(ticketKeys("o3-123-fix-login", KEYS), ["O3-123"], "branch names are lower case");
  assert.deepEqual(ticketKeys("ABC-1, JIRA-22, XTRUNK-5, TRUNK-5x? TRUNK-", KEYS), [], "unconfigured projects and embedded keys are not tickets");
  assert.deepEqual(ticketKeys("https://openmrs.atlassian.net/browse/LIME-77 and https://issues.openmrs.org/browse/TRUNK-1", KEYS), ["TRUNK-1", "LIME-77"]);
  assert.deepEqual(ticketKeys("TRUNK-1 TRUNK-1", KEYS), ["TRUNK-1"]);
  assert.deepEqual(ticketKeys("TRUNK-1", []), [], "no keys configured, no keys found");
  assert.deepEqual(parseTicketKeys(" TRUNK, restws ,O3,,bad key,(x)"), ["TRUNK", "RESTWS", "O3"]);
  assert.deepEqual(parseTicketKeys(undefined), []);
});

test("pull request text links: tickets from title, body and branch; #N and owner/repo#N body references", () => {
  const links = discussionLinks({ number: 10, title: "(feat) O3-1: thing", body: "Needs TRUNK-2 and RESTWS-3.\nFollows #9, not #10; see openmrs/other#4 and acme/app#7.\n&#123; page#5", headRef: "o3-1-thing" }, "github.com/acme/app", KEYS);
  assert.deepEqual(links.map((l) => [l.toKind, l.toRepo, l.toRef, l.source]), [
    ["ticket", null, "O3-1", "ticket-pattern"],
    ["ticket", null, "TRUNK-2", "ticket-pattern"],
    ["ticket", null, "RESTWS-3", "ticket-pattern"],
    ["pr", "github.com/openmrs/other", "4", "body-ref"],
    ["pr", null, "7", "body-ref"],
    ["pr", null, "9", "body-ref"],
  ]);
  assert.ok(links.every((l) => l.fromKind === "pr" && l.fromRef === "10" && l.verified));
  assert.deepEqual(discussionLinks({ number: 1, title: "", body: "", headRef: null }, "github.com/acme/app", KEYS), [], "empty body");
});

test("search bounds: at most 8 words of 100 characters, 1 to 20 hits, offset 0 to 1000; LIKE metacharacters escaped", () => {
  assert.deepEqual(searchBounds({ words: [" a ", "", ..."bcdefghijk".split("")], limit: 500, offset: -3 }), { words: ["a", "b", "c", "d", "e", "f", "g", "h"], limit: 20, offset: 0 });
  assert.deepEqual(searchBounds({ words: ["x".repeat(150)], limit: 0, offset: 5000 }), { words: ["x".repeat(100)], limit: 1, offset: 1000 });
  assert.deepEqual(searchBounds({ words: ["a"], limit: NaN, offset: Infinity }), { words: ["a"], limit: 20, offset: 0 }, "NaN and Infinity never reach SQL");
  assert.equal(likePattern("50%_a\\b"), "%50\\%\\_a\\\\b%");
});

provenanceStoreContract("fake store", async () => {
  const ids = Object.fromEntries(CONTRACT_REPOS.map((r, i) => [r, i + 1]));
  return { store: fakeProvenanceStore(ids), id: (r) => ids[r]! };
});
