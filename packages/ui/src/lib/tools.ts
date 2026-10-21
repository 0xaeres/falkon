// Tool names the Connect page lists (packages/shared/src/toolText.json plus research_codebase; tests/connect.test.mts keeps them in step).
export const TOOLS = [
  "grep",
  "glob",
  "find_symbol_definitions",
  "find_symbol_references",
  "read_file",
  "list_tree",
  "list_repos",
  "list_branches",
  "list_commits",
  "get_diff",
  "research_codebase",
] as const;
