// Test support: an OpenAI-compatible chat-completions server that plays a script, so the real Ask agent
// (streamText, tools, UI message stream) runs without a live model. Point `LLM_BASE_URL` at `url`.
import http from "node:http";
import type { AddressInfo } from "node:net";

/** One model response: text, a tool call, or text that starts and waits: for `rest` to end it, or forever (for abort tests); or text and then an error event (a model failure mid-answer). */
export type Turn = { text: string } | { tool: string; args: unknown } | { hang: string; rest?: Promise<string> } | { fail: string };

export async function fakeOpenAi(initial: Turn[] = [], title: string | null = "A title") {
  let turns = initial;
  let chatTitle = title;
  const requests: { messages: { role: string; content?: unknown }[]; stream?: boolean; tools?: unknown[] }[] = [];
  let next = 0;
  const open = new Set<http.ServerResponse>();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const base = { id: "c", object: "chat.completion.chunk", created: 1, model: "m" };
    if (!body.stream) {
      // generateText: the chat name (a null title is a client error, which the SDK does not retry).
      if (chatTitle === null) return void res.writeHead(400).end("no title");
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: chatTitle } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
    requests.push(body);
    const turn = turns[Math.min(next++, turns.length - 1)]!;
    res.writeHead(200, { "content-type": "text/event-stream" });
    open.add(res);
    res.on("close", () => open.delete(res));
    const send = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if ("fail" in turn) {
      send({ role: "assistant", content: turn.fail });
      return void res.end(`data: ${JSON.stringify({ error: { message: "model failed", type: "server_error" } })}\n\n`);
    }
    if ("hang" in turn) {
      send({ role: "assistant", content: turn.hang });
      if (!turn.rest) return;
      send({ content: await turn.rest }, "stop");
    } else if ("text" in turn) {
      send({ role: "assistant", content: turn.text });
      send({}, "stop");
    } else {
      send({ role: "assistant", tool_calls: [{ index: 0, id: `call_${next}`, type: "function", function: { name: turn.tool, arguments: JSON.stringify(turn.args) } }] });
      send({}, "tool_calls");
    }
    res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    /** Starts a new script: the next stream request gets its first turn. */
    play: (t: Turn[]) => {
      turns = t;
      next = 0;
      requests.length = 0;
    },
    setTitle: (t: string | null) => void (chatTitle = t),
    close: () => {
      for (const r of open) r.destroy();
      server.close();
    },
  };
}
