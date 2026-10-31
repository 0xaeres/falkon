import type { Scope } from "@falkon/shared";
import { IMPACT_BRIEF_STEPS, isImpactQuery } from "./impact";
import { fileReferenceToString } from "./prompt";

const fileCitation = fileReferenceToString({ repo: "<repo>", path: "<path>" });
const rangeCitation = fileCitation.replace(/\}$/, ":<start>-<end>}");
const answerFormat = `Write Markdown. Follow every code mention immediately with ${fileCitation} or ${rangeCitation}, using the repository name, file path, and start and end lines from your evidence.`;

/** Guidance for the client's model; no server model is needed. */
export const CLIENT_RESEARCH_INSTRUCTIONS = `Falkon searches and reads code in the repositories your access policy permits. Use list_repos for repository names; glob and list_tree for paths; grep for content; read_file for source; find_symbol_definitions and find_symbol_references for symbol relationships; list_branches, list_commits, and get_diff for history. For open questions, research_codebase returns a scoped research brief for your model to carry out with these tools. ${answerFormat}`;

/** Appended to the research brief when MCP_GIT_TOOLS=on, so the git history tools are named only where they exist. */
export const GIT_BRIEF_RECIPES = `The git history tools are on, so for questions about when something changed, who changed it or which release holds it:
- Release holding a commit: call list_refs with kind "tags" and contains set to the commit; the oldest tag by date is the first release that has it. Check the neighbours with check_ancestry (commit as ancestor, tag as descendant): it should answer yes for that tag and no for the tag before it.
- Versions that carry a flaw: find the commit that introduced it (search_diffs on the added lines, or get_range_history on the code) and the commit that fixed it. The affected tags are those list_refs returns for contains set to the introducing commit, minus those it returns for the fixing commit. Confirm the edges with check_ancestry, and say which releases you could not check.
- Absence: an empty or short result is not proof that something never happened. Read coverageGaps and truncated first; a gap, a cut, a PARTIAL summary, a repository you could not see or a clone that lags the code host each leave the question open. Report "not found in what was read", name what was read, and list what was not.`;

// Bounds keep the brief small however many repositories exist or a caller names.
const MAX_LISTED = 50;
const MAX_NAME = 200;
/** One line per name: control characters become spaces, overlong names are cut. */
const clean = (name: string) => {
  const line = name.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return line.length > MAX_NAME ? `${line.slice(0, MAX_NAME)}...` : line;
};
const bulletList = (names: string[], more: string) =>
  [...names.slice(0, MAX_LISTED).map((name) => `- ${clean(name)}`), ...(names.length > MAX_LISTED ? [`- and ${names.length - MAX_LISTED} more; ${more}`] : [])].join("\n");

/** Build a research brief from a repository inventory and the caller's existing scope. */
export function buildResearchBrief({ query, scope, availableRepos, repos, impactRecipe = false, gitRecipes = false }: {
  query: string;
  scope: Scope;
  availableRepos: readonly string[];
  repos?: readonly string[];
  /** Append the impact-and-change steps when the question is impact-style. Off unless the caller enables it. */
  impactRecipe?: boolean;
  /** Append the git history recipes. Off unless MCP_GIT_TOOLS=on. */
  gitRecipes?: boolean;
}): string {
  const visible = new Set(availableRepos.filter((name) => scope.allows(name)));
  const requested = [...new Set(repos ?? visible)];
  const selected = requested.filter((name) => visible.has(name));
  const unavailable = requested.filter((name) => !visible.has(name));
  return `Question: ${query}

Repositories in scope:
${selected.length ? bulletList(selected, "use list_repos (paged) to see them") : "None. Stop here and report that no repositories are available for this question."}
${unavailable.length ? `\nUnavailable repositories (unknown or outside your access policy):\n${bulletList(unavailable, "not listed")}\n` : ""}
Research steps:
1. Keep research within the repositories above. Use their exact names as repo on tool calls, including grep and glob; omitting repo can search beyond this selection. Use list_repos to confirm names, never to expand this list.
2. Locate likely files with glob or list_tree, then search terms with grep. Refine broad searches and inspect additional result pages when needed.
3. Read matching source with read_file, including surrounding logic. Follow declarations and uses with find_symbol_definitions and find_symbol_references; read those locations too.
4. If the question concerns changes or versions, inspect list_branches and list_commits, compare revisions with get_diff, and read source at the relevant ref.
5. Stop when gathered evidence answers the question or further searches yield no useful evidence. State what you could not find and any remaining uncertainty.
${impactRecipe && isImpactQuery(query) ? `\n${IMPACT_BRIEF_STEPS}\n` : ""}${gitRecipes ? `\n${GIT_BRIEF_RECIPES}\n` : ""}
${answerFormat}`;
}
