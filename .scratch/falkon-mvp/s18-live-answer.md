`greet` is defined in one repo, `fixtures.test/atlas`, and its only caller is in the same file.

**Definition**

`greet(name: string): string` is at @file:{fixtures.test/atlas::src/greet.ts:1-3}. It returns `hello world ${name}`.

**Callers**

The only call is a module-level initializer, `export const message = greet("Needle");`, at @file:{fixtures.test/atlas::src/greet.ts:4}. `find_symbol_references` returned the same two hits (definition and that call), and no other file in `atlas` references it.

**Other repos**

`fixtures.test/archive`, `fixtures.test/ledger` and `fixtures.test/worker` have no `greet` definition or references. Symbol lookup and regex grep both came back empty for each.

**Uncertainty**

Search was limited to the four repos in scope. Dynamic calls, such as `greet` passed as a value or invoked through reflection, would not show up in these symbol searches, but none appeared in the grep results.
