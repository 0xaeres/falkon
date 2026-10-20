import assert from "node:assert/strict";
import test from "node:test";
import { connectionRequestSchema } from "@sbc/contracts";
import {
  connectReady,
  connectRequest,
} from "../src/features/setup/connect-method";

const base = { provider: "github" as const, host: "https://github.com" };
const empty = { token: "", appId: "", privateKey: "", installationId: "" };

test("connect step is ready only when the chosen method has its fields", () => {
  assert.equal(connectReady("token", empty), false);
  assert.equal(connectReady("token", { ...empty, token: "t" }), true);
  // An App key and id alone are not enough: an installation must be picked.
  const app = { ...empty, appId: "1", privateKey: "pem" };
  assert.equal(connectReady("app", app), false);
  assert.equal(connectReady("app", { ...app, installationId: "9" }), true);
  assert.equal(connectReady("app", { ...empty, token: "t" }), false);
});

test("connect requests carry only the chosen method's fields and satisfy the contract", () => {
  const token = connectRequest("token", {
    ...base,
    ...empty,
    token: "t",
    appId: "1",
    privateKey: "pem",
  });
  assert.deepEqual(token, { ...base, method: "token", token: "t" });
  const app = connectRequest("app", {
    ...base,
    ...empty,
    token: "t",
    appId: "1",
    privateKey: "pem",
    installationId: "9",
  });
  assert.deepEqual(app, {
    ...base,
    method: "app",
    appId: "1",
    privateKey: "pem",
    installationId: "9",
  });
  assert.ok(connectionRequestSchema.safeParse(app).success);
});
