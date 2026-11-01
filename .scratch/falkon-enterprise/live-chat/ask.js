// node ask.js <qid> [<outdir>] : one thread, one message; saves raw SSE, parsed summary and stored thread.
const fs = require('node:fs');
const base = 'http://127.0.0.1:3602';
const header = fs.readFileSync('admin.header', 'utf8').trim().split(': ');
const H = { [header[0]]: header[1], 'content-type': 'application/json' };
const qs = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
const out = process.argv[3] || 'runs';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const q = qs.find(x => x.id === process.argv[2]);
  const slug = 'openmrs';
  const t0 = Date.now();
  const th = await (await fetch(`${base}/ui/products/${slug}/threads`, { method: 'POST', headers: H })).json();
  const id = th.id ?? th.thread?.id;
  const res = await fetch(`${base}/ui/products/${slug}/threads/${id}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ text: q.text }) });
  const raw = await res.text();
  fs.writeFileSync(`${out}/${q.id}.sse`, raw);
  const stored = await (await fetch(`${base}/ui/products/${slug}/threads/${id}`, { headers: H })).json();
  fs.writeFileSync(`${out}/${q.id}.thread.json`, JSON.stringify(stored, null, 2));
  console.log(q.id, 'status', res.status, 'sec', ((Date.now() - t0) / 1000).toFixed(1), 'bytes', raw.length);
})();
