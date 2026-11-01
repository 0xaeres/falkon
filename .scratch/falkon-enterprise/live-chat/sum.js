const fs = require('node:fs');
const [dir, id] = process.argv.slice(2);
const ev = fs.readFileSync(`${dir}/${id}.sse`, 'utf8').split('\n').filter(x => x.startsWith('data: ')).map(x => { try { return JSON.parse(x.slice(6)); } catch { return null; } }).filter(Boolean);
const calls = ev.filter(e => e.type === 'tool-input-available').map(e => `${e.toolName}(${JSON.stringify(e.input).slice(0, 110)})`);
const steps = ev.filter(e => e.type === 'start-step').length;
const text = ev.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
const ans = ev.find(e => e.type === 'data-answer')?.data;
console.log(`## ${id} steps=${steps} toolcalls=${calls.length}`);
const byName = {}; for (const c of calls) { const n = c.split('(')[0]; byName[n] = (byName[n] || 0) + 1; }
console.log('tools:', JSON.stringify(byName));
if (process.argv[4] === 'calls') console.log(calls.join('\n'));
if (ans) console.log('kind=', ans.kind, 'evidence=', ans.evidence?.length, 'gaps=', JSON.stringify(ans.gaps).slice(0, 200), 'partial=', JSON.stringify(ans.partialReasons).slice(0, 200), 'abstention=', ans.abstention ?? '');
console.log('answer chars:', text.length, 'words:', text.split(/\s+/).length);
if (process.argv[4] === 'text') console.log(text);
