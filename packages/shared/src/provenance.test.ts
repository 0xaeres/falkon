import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROWS, discussionLinks, likePattern, mergePrNumber, parseTicketKeys, searchBounds, squashPrNumber, ticketKeys } from "./provenance";
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

const cm = (body: string, authorLogin: string | null = "rev") => ({ body, authorLogin });
const ticketsOf = (links: ReturnType<typeof discussionLinks>) => links.filter((l) => l.toKind === "ticket").map((l) => [l.toRef, l.source]);
const PR = { number: 5, title: "Fix the thing", body: "No key here.", headRef: "fix-thing" };

test("comment keys: a key only in a comment (hist-a-11 shape) is a ticket with its own source", () => {
  const links = discussionLinks({ ...PR, comments: [cm("Looks good, tracked in https://issues.openmrs.org/browse/RESTWS-1038"), cm("also restws-77 follow-up")] }, "github.com/acme/app", KEYS);
  assert.deepEqual(ticketsOf(links), [["RESTWS-1038", "comment-ticket-pattern"], ["RESTWS-77", "comment-ticket-pattern"]]);
});

test("comment keys: title/body keys come first and win; same key in body and comment is listed once", () => {
  const links = discussionLinks({ ...PR, title: "TRUNK-1: fix", body: "RESTWS-5", comments: [cm("RESTWS-5 again, and O3-9"), cm("TRUNK-1")] }, "github.com/acme/app", KEYS);
  assert.deepEqual(ticketsOf(links), [["TRUNK-1", "ticket-pattern"], ["RESTWS-5", "ticket-pattern"], ["O3-9", "comment-ticket-pattern"]]);
});

test("comment keys: unconfigured projects, empty or blank comments, bot authors and quoted lines give none", () => {
  const links = discussionLinks({ ...PR, comments: [cm("ZZZ-1 is unrelated"), cm(""), cm("   "), cm("TRUNK-2 from CI", "jira[bot]"), cm("> TRUNK-3 quoted\n> O3-4 too\nno key in my reply"), cm("no key at all")] }, "github.com/acme/app", KEYS);
  assert.deepEqual(ticketsOf(links), []);
  assert.deepEqual(ticketsOf(discussionLinks({ ...PR, comments: [cm("> TRUNK-3 quoted\nbut mine is O3-4", null)] }, "github.com/acme/app", KEYS)), [["O3-4", "comment-ticket-pattern"]], "a null author is not a bot");
});

test("comment keys: the scan is bounded to the first MAX_ROWS comments", () => {
  const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => cm(i === MAX_ROWS + 1 ? "TRUNK-9" : `comment ${i}`));
  assert.deepEqual(ticketsOf(discussionLinks({ ...PR, comments: many }, "github.com/acme/app", KEYS)), []);
  assert.deepEqual(ticketsOf(discussionLinks({ ...PR, comments: [...many.slice(0, MAX_ROWS - 1), cm("TRUNK-8")] }, "github.com/acme/app", KEYS)), [["TRUNK-8", "comment-ticket-pattern"]]);
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

test("commit subject pull request numbers: squash `(#N)` at the end, `Merge pull request #N from` at the start", () => {
  assert.equal(squashPrNumber("fix scan (#12)"), 12);
  assert.equal(squashPrNumber("fix scan (#12)  "), 12);
  assert.equal(squashPrNumber("fix (#12) scan"), undefined);
  assert.equal(mergePrNumber("Merge pull request #7 from acme/x"), 7);
  assert.equal(mergePrNumber("see Merge pull request #7 from acme/x"), undefined);
  assert.equal(mergePrNumber("fix scan (#12)"), undefined);
});
