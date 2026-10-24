import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { memorySignals, redisSignals } from "./signals";

test("changed and request reach their own subscribers only, and unsubscribing stops them", () => {
  const s = memorySignals();
  const seen: string[] = [];
  const offChanged = s.onChanged(() => seen.push("changed"));
  s.onRequest(() => seen.push("request"));
  s.changed();
  s.request();
  offChanged();
  s.changed();
  assert.deepEqual(seen, ["changed", "request"]);
});

test("a throwing subscriber does not reach the publisher", () => {
  const s = memorySignals();
  s.onChanged(() => {
    throw new Error("boom");
  });
  assert.doesNotThrow(() => s.changed());
});

test("redis down: publishing and subscribing never throw or reject", async () => {
  const s = redisSignals("redis://127.0.0.1:1");
  try {
    assert.doesNotThrow(() => s.changed());
    assert.doesNotThrow(() => s.request());
    s.onRequest(() => {});
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    s.close();
  }
});

test("a subscriber created while Redis is down subscribes once Redis comes up", async () => {
  // Fake RESP server on a port that is closed when the subscription is made. ioredis' retry flush (20 retries) is not
  // reproduced here (too slow); this covers the queued SUBSCRIBE being sent on a late connect.
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const s = redisSignals(`redis://127.0.0.1:${port}`);
  const got: string[] = [];
  const server = net.createServer((sock) => {
    sock.on("data", (d) => {
      const text = d.toString();
      if (/INFO/i.test(text)) sock.write("$11\r\nloading:0\r\n\r\n");
      for (const m of text.matchAll(/SUBSCRIBE\r\n\$\d+\r\n([^\r]+)/gi)) {
        got.push(m[1]!);
        sock.write(`*3\r\n$9\r\nsubscribe\r\n$${m[1]!.length}\r\n${m[1]}\r\n:1\r\n`);
      }
    });
  });
  try {
    s.onRequest(() => {});
    await new Promise((r) => setTimeout(r, 150));
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got, ["falkon:request"]);
  } finally {
    s.close();
    server.close();
  }
});
