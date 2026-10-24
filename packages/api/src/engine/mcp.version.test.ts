import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The MCP server version literal in mcp.ts must track this package's version (D80).
test("the MCP server version literal equals packages/api/package.json version", () => {
  const { version } = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const src = fs.readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
  const literal = /name: MCP_SERVER_NAME, version: "([^"]+)"/.exec(src)?.[1];
  assert.equal(literal, version);
});
