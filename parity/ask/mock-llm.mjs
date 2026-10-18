// Scripted OpenAI-compatible LLM for the Ask differential. Both instances point at it under their
// own path prefix (/v6/..., /clone/...), get the same scripted turns, and every request body is
// recorded to parity/ask/out/<prefix>.jsonl so prompts, tool schemas and tool results can be diffed.
//
// Script per conversation (decided by how many tool results the request already carries):
//   0 results -> call grep, 1 -> call read_file, 2+ -> final answer with @file: references.
// A request without tools is the chat-title prompt.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT ?? 9100);
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

const REPO = process.env.ASK_REPO ?? "github.com/openmrs/openmrs-core";
const FILE = "api/src/main/java/org/openmrs/api/impl/PatientServiceImpl.java";
const script = [
  { tool: "grep", args: { pattern: "class PatientServiceImpl", repo: REPO } },
  { tool: "read_file", args: { repo: REPO, path: FILE, offset: 1, limit: 40 } },
];
const ANSWER =
  "Looking at the implementation.\n<!--answer-->\n`PatientServiceImpl` implements the patient API @file:{" +
  REPO +
  "::" +
  FILE +
  ":1-40}. It is declared in @file:{" +
  REPO +
  "::" +
  FILE +
  "} and referenced from @file:{" +
  REPO +
  "::does/not/exist.java:3}.";

function reply(body) {
  if (!body.tools?.length) return { text: "Patient Service Implementation" };
  const results = (body.messages ?? []).filter((m) => m.role === "tool").length;
  const step = script[results];
  return step ? { toolCall: { id: `call_${results}`, name: step.tool, args: JSON.stringify(step.args) } } : { text: ANSWER };
}

const chunk = (res, o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

http
  .createServer(async (req, res) => {
    const prefix = req.url.split("/")[1];
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.endsWith("/chat/completions")) {
      fs.appendFileSync(path.join(out, `${prefix}.jsonl`), JSON.stringify(body) + "\n");
      const r = reply(body);
      const base = { id: "mock", object: "chat.completion.chunk", created: 0, model: body.model };
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        const message = r.toolCall
          ? { role: "assistant", content: null, tool_calls: [{ id: r.toolCall.id, type: "function", function: { name: r.toolCall.name, arguments: r.toolCall.args } }] }
          : { role: "assistant", content: r.text };
        return res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: r.toolCall ? "tool_calls" : "stop" }], usage }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (r.toolCall) {
        chunk(res, { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: r.toolCall.id, type: "function", function: { name: r.toolCall.name, arguments: "" } }] } }] });
        chunk(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: r.toolCall.args } }] } }] });
        chunk(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        chunk(res, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: r.text } }] });
        chunk(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      chunk(res, { ...base, choices: [], usage });
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.error(`mock llm on :${PORT}`));
