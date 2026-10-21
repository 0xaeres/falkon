import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as chat } from "../../app/api/chat/route";
import { POST as knowledge } from "../../app/api/knowledge/route";

const authEnv = { ACCESS_FILE: process.env.ACCESS_FILE, FALKON_API_KEY: process.env.FALKON_API_KEY };
before(() => {
  delete process.env.ACCESS_FILE;
  delete process.env.FALKON_API_KEY;
});
after(() => {
  for (const [key, value] of Object.entries(authEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const request = (body: unknown) => new NextRequest("http://localhost/api/test", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

test("Ask chat pins the Zod 4 invalid-request status, errorCode and message", async () => {
  const response = await chat(request({ id: "chat", messages: "invalid" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    statusCode: 400,
    errorCode: "INVALID_REQUEST_BODY",
    message: `Schema validation failed with: [
  {
    "expected": "array",
    "code": "invalid_type",
    "path": [
      "messages"
    ],
    "message": "Invalid input: expected array, received string"
  }
]`,
  });
});

test("knowledge administration pins its existing Zod 4 invalid-request body", async () => {
  const response = await knowledge(request({ repo: 42, action: "scan" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: `[
  {
    "expected": "string",
    "code": "invalid_type",
    "path": [
      "repo"
    ],
    "message": "Invalid input: expected string, received number"
  }
]`,
  });
});

test("the old enterprise-prefixed routes are gone and the moved routes exist", async () => {
  const { existsSync } = await import("node:fs");
  const api = new URL("../../app/api/", import.meta.url);
  assert.equal(existsSync(new URL("ee", api)), false);
  for (const route of ["chat/route.ts", "chats/route.ts", "chat/blocking/route.ts", "mcp/route.ts"]) assert.ok(existsSync(new URL(route, api)), route);
});
