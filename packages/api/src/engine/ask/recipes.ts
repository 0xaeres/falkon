/** The git history recipes: appended to the research brief unless MCP_GIT_TOOLS=off, and added to the per-chat prompt on the same rule. */
export const GIT_BRIEF_RECIPES = `The git history tools are on, so for questions about when something changed, who changed it or which release holds it:
- Release holding a commit: call list_refs with kind "tags" and contains set to the commit; it lists every tag whose history holds the commit. Tag dates can be wrong, so do not pick the first release by date. Take the earliest candidates and confirm the order with check_ancestry (commit as ancestor, tag as descendant): the first release answers yes while the tag before it answers no.
- Versions that carry a flaw: find the commit that introduced it (search_diffs on the added lines, or get_range_history on the code) and the commit that fixed it. The affected tags are those list_refs returns for contains set to the introducing commit, minus those it returns for the fixing commit. Confirm the edges with check_ancestry, and say which releases you could not check.
- Absence: an empty or short result is not proof that something never happened. Read coverageGaps and truncated first; a gap, a cut, a PARTIAL summary, a repository you could not see or a clone that lags the code host each leave the question open. Report "not found in what was read", name what was read, and list what was not.`;

/** Added to the per-chat prompt when MCP_HISTORY_TOOLS is on, so the pull request and ticket tools are named only where they exist. */
export const HISTORY_RECIPE = `The pull request and ticket tools are on, so for questions about why a change happened:
- Find the commit (list_commits), open its pull request with get_pull_request, and read the ticket keys it lists.
- When you start from a commit, a pull request or a ticket, call get_provenance to reach the other two.
- An empty ticket list on a pull request is not proof that no ticket exists: keys can sit in comments. Say what you read.
- Pull request numbers, commit SHAs and ticket keys are plain text in the answer; only @file references are checked. State which of them you actually read.`;

/** Words that make a conversation about history: commits, pull requests, tickets, who or when, releases. A plain "why" or "how" is not one. */
const HISTORY_WORDS = /\b(commits?|pull requests?|prs?|tickets?|issues?|blame|histor(?:y|ical)|changed|changelog|diffs?|revisions?|releases?|released|branch(?:es)?|tags?|authors?|authored|contributors?|regressions?|introduced|merged|reverted|git|sha|who (?:wrote|added|removed|changed|introduced|touched|authored)|when (?:was|did|were)|why (?:was|did|were)|last (?:modified|updated|touched))\b/i;
/** A ticket key such as PAY-123 (case-sensitive, so "pay-123" is not one). ponytail: also matches "SHA-256" or "UTF-8", which only costs the tool text. */
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;

/**
 * True when a question is about history. The chat offers the ten pull request and git tools and their two recipes only then (D194),
 * so a code question does not pay for their text on every step. A false positive costs tokens, a false negative hides the tools,
 * so the list errs wide. The caller passes the text of ALL user messages of the conversation, not only the last: a follow-up
 * such as "and who wrote it?" or "what about the second one?" in a history chat keeps the tools.
 */
export const isHistoryQuery = (userText: string) => HISTORY_WORDS.test(userText) || ISSUE_KEY.test(userText);
