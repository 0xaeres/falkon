/**
 * The pull request GraphQL query and its snapshot shape, shared by the live GitHub source (githubDiscussions.ts) and the S47
 * snapshot fetcher (tests/eval/discussions.ts), so both store the same shape (D124). Pure: no client, no dependency.
 */

const AUTHOR = "author{login}"; // logins only, never name, email or avatar (D121)
export const SELECT: Record<string, string> = {
  comments: `databaseId ${AUTHOR} body createdAt updatedAt`,
  reviews: `databaseId ${AUTHOR} state body submittedAt`,
  reviewThreads: `comments(first:30){pageInfo{hasNextPage} nodes{databaseId ${AUTHOR} body path line originalLine createdAt updatedAt}}`,
  files: "path additions deletions",
};
/** Page caps: a connection with pages left after its cap is flagged `truncated`. */
export const SIZE: Record<string, number> = { comments: 100, reviews: 100, reviewThreads: 30, files: 100 };
/** Pull requests per aliased detail query. */
export const BATCH = 10;
export const conn = (f: string, after = "") => `${f}(first:${SIZE[f]}${after}){pageInfo{hasNextPage endCursor} nodes{${SELECT[f]}}}`;
export const FRAGMENT = `fragment F on PullRequest{number title body state merged mergedAt createdAt updatedAt closedAt ${AUTHOR} headRefName baseRefName mergeCommit{oid} url labels(first:50){nodes{name}} ${Object.keys(SELECT).map((f) => conn(f)).join(" ")}}`;

/** One aliased query for several pull requests of `$owner/$name` (aliases `p<number>`), with the given rate-limit selection. */
export const detailQuery = (nums: number[], rate: string) =>
  `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${nums.map((n) => `p${n}:pullRequest(number:${n}){...F}`).join(" ")}} ${rate}} ${FRAGMENT}`;

/** Emails and token-like strings in third-party text become placeholders; only logins are stored. */
export const scrub = (s: string | null | undefined): string => (s ?? "")
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email removed]")
  .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "[token removed]");

/** A connection's nodes as read, and whether pages were left unread. */
export type Pages = Record<string, { nodes: any[]; truncated: boolean }>;

/**
 * One pull request node in the snapshot shape that `mapSnapshotPull` reads: logins only, emails and tokens scrubbed. With a
 * `pin` (ISO time) the text is cut at it, as the S47 snapshot does; without one nothing is cut.
 */
export function shapePull(pr: any, pages: Pages, pin?: string, pinSha?: string) {
  const before = (t: string | null) => !!t && (pin === undefined || t <= pin);
  const upTo = (t: string) => (pin === undefined || t < pin ? t : pin);
  // The pin commit's own pull request counts as merged even when GitHub stamped the merge seconds after the commit date.
  const merged = pr.merged && (before(pr.mergedAt) || pr.mergeCommit?.oid === pinSha), closed = merged || before(pr.closedAt);
  const truncated: Record<string, boolean> = {};
  const get = (f: string) => { if (pages[f]!.truncated) truncated[f === "reviewThreads" ? "reviewComments" : f] = true; return pages[f]!.nodes; };
  const login = (n: any) => n.author?.login ?? null;
  const comments = get("comments").filter((n) => before(n.createdAt)).map((n) => ({ id: n.databaseId, authorLogin: login(n), body: scrub(n.body), createdAt: n.createdAt, updatedAt: upTo(n.updatedAt) }));
  const reviews = get("reviews").filter((n) => before(n.submittedAt)).map((n) => ({ id: n.databaseId, authorLogin: login(n), state: n.state, body: scrub(n.body), submittedAt: n.submittedAt }));
  const threads = get("reviewThreads");
  if (threads.some((t) => t.comments.pageInfo.hasNextPage)) truncated.reviewComments = true;
  const reviewComments = threads.flatMap((t) => t.comments.nodes).filter((n) => before(n.createdAt)).map((n) => ({ id: n.databaseId, authorLogin: login(n), body: scrub(n.body), path: n.path, line: n.line ?? n.originalLine ?? null, createdAt: n.createdAt, updatedAt: upTo(n.updatedAt) }));
  const files = get("files").map((n) => ({ path: n.path, additions: n.additions, deletions: n.deletions }));
  return {
    number: pr.number, title: scrub(pr.title), body: scrub(pr.body), state: closed ? "closed" : "open", merged,
    mergedAt: merged ? pr.mergedAt : null, createdAt: pr.createdAt, updatedAt: upTo(pr.updatedAt), closedAt: closed ? pr.closedAt : null,
    authorLogin: login(pr), headRef: pr.headRefName, baseRef: pr.baseRefName, mergeCommitSha: merged ? pr.mergeCommit?.oid ?? null : null,
    url: pr.url, labels: pr.labels.nodes.map((l: any) => l.name), comments, reviews, reviewComments, files, truncated,
  };
}

/** The first page of each connection as one detail response holds it; pages left unread mark the part `truncated`. */
export const firstPages = (pr: any): Pages =>
  Object.fromEntries(Object.keys(SELECT).map((f) => [f, { nodes: pr[f].nodes, truncated: pr[f].pageInfo.hasNextPage }]));
