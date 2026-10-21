export type AuthMode = "none" | "apiKey";
export type Snippets = { claude: string; codex: string; vscode: string };

/** The Product's MCP endpoint: `base` (FALKON_MCP_URL, trailing slashes tolerated) + `/mcp/<product>`. */
export const mcpUrl = (base: string | undefined, product: string) =>
  `${(base || "http://127.0.0.1:3001").replace(/\/+$/, "")}/mcp/${product}`;

/** The three client setups for one Product. In apiKey mode the key is an env var or prompt, never a literal. */
export function connectSnippets(
  product: string,
  url: string,
  mode: AuthMode,
): Snippets {
  const name = `falkon-${product}`;
  const key = mode === "apiKey";
  const server = {
    type: "http",
    url,
    ...(key
      ? { headers: { Authorization: "Bearer ${input:falkon-api-key}" } }
      : {}),
  };
  return {
    claude: `claude mcp add --transport http ${name} ${url}${key ? ' -H "Authorization: Bearer $FALKON_API_KEY"' : ""}`,
    codex: `codex mcp add ${name} --url ${url}${key ? " --bearer-token-env-var FALKON_API_KEY" : ""}`,
    vscode: JSON.stringify(
      {
        servers: { [name]: server },
        ...(key
          ? {
              inputs: [
                {
                  type: "promptString",
                  id: "falkon-api-key",
                  description: "Falkon API key",
                  password: true,
                },
              ],
            }
          : {}),
      },
      null,
      2,
    ),
  };
}
