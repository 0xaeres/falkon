import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { connectSnippets, mcpUrl } from "../src/lib/connect";
import { TOOLS } from "../src/lib/tools";

test("mcpUrl: default base, trailing slash tolerated, Product slug with dashes kept", () => {
  assert.equal(mcpUrl(undefined, "core"), "http://127.0.0.1:3001/mcp/core");
  assert.equal(mcpUrl("", "core"), "http://127.0.0.1:3001/mcp/core");
  assert.equal(
    mcpUrl("https://falkon.example.com", "my-app-2"),
    "https://falkon.example.com/mcp/my-app-2",
  );
  assert.equal(
    mcpUrl("https://falkon.example.com/", "my-app-2"),
    "https://falkon.example.com/mcp/my-app-2",
  );
  assert.equal(
    mcpUrl("https://falkon.example.com///", "x"),
    "https://falkon.example.com/mcp/x",
  );
});

test("auth none: plain commands and config, no credential anywhere", () => {
  const s = connectSnippets("my-app", "http://h:3001/mcp/my-app", "none");
  assert.equal(
    s.claude,
    "claude mcp add --transport http falkon-my-app http://h:3001/mcp/my-app",
  );
  assert.equal(
    s.codex,
    "codex mcp add falkon-my-app --url http://h:3001/mcp/my-app",
  );
  assert.deepEqual(JSON.parse(s.vscode), {
    servers: {
      "falkon-my-app": { type: "http", url: "http://h:3001/mcp/my-app" },
    },
  });
  for (const text of Object.values(s))
    assert.doesNotMatch(text, /Bearer|API_KEY|headers/);
});

test("auth apiKey: the key is an env reference or prompt, never a literal token", () => {
  const s = connectSnippets("my-app", "http://h:3001/mcp/my-app", "apiKey");
  assert.equal(
    s.claude,
    'claude mcp add --transport http falkon-my-app http://h:3001/mcp/my-app -H "Authorization: Bearer $FALKON_API_KEY"',
  );
  assert.equal(
    s.codex,
    "codex mcp add falkon-my-app --url http://h:3001/mcp/my-app --bearer-token-env-var FALKON_API_KEY",
  );
  const vs = JSON.parse(s.vscode);
  assert.deepEqual(vs.servers["falkon-my-app"].headers, {
    Authorization: "Bearer ${input:falkon-api-key}",
  });
  assert.deepEqual(vs.inputs, [
    {
      type: "promptString",
      id: "falkon-api-key",
      description: "Falkon API key",
      password: true,
    },
  ]);
  assert.deepEqual(vs.servers["falkon-my-app"].type, "http");
});

test("the tool list is the shared tools plus research_codebase", () => {
  const text = JSON.parse(
    readFileSync(
      new URL("../../shared/src/toolText.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.deepEqual(
    [...TOOLS].sort(),
    [...Object.keys(text), "research_codebase"].sort(),
  );
});
