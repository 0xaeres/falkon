const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const registrations = ['tests/contract/registration.json', 'tests/contract/registration-model.json'];
for (const file of registrations) {
  const before = git('show', `HEAD:${file}`);
  const after = fs.readFileSync(file, 'utf8');
  const oldEntries = JSON.parse(before);
  const newEntries = JSON.parse(after);
  assert.equal(newEntries.length, oldEntries.length + 1);
  assert.equal(JSON.stringify(newEntries.slice(0, oldEntries.length)), JSON.stringify(oldEntries));
  // Compare the raw serialized bytes through the last original entry.
  const originalBytes = before.slice(0, before.lastIndexOf('\n]'));
  assert.equal(after.slice(0, originalBytes.length), originalBytes);
  assert.equal(newEntries.at(-1).name, 'research_codebase');
  console.log(`${file}: ${oldEntries.length} original entries byte-identical; research_codebase appended`);
}
for (const file of git('ls-tree', '-r', '--name-only', 'HEAD', 'tests/contract').trim().split('\n')) {
  if (registrations.includes(file)) continue;
  assert.deepEqual(fs.readFileSync(file), execFileSync('git', ['show', `HEAD:${file}`]));
}
assert.equal(git('diff', '--numstat', '--', 'tests/contract').trim().split('\n').every(line => line.split('\t')[1] === '0'), true);
for (const file of ['packages/web/src/lib/ask/agent.ts', 'packages/web/src/lib/ask/prompt.ts', 'packages/web/src/lib/ask/chat.ts']) {
  assert.deepEqual(fs.readFileSync(file), execFileSync('git', ['show', `HEAD:${file}`]));
}
console.log('All other pinned contract files and server Ask sources byte-identical to HEAD.');
