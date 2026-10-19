# Domain docs

This is a single-context repository. Two files hold the domain:

- [`CONTEXT.md`](../../CONTEXT.md): the glossary. Read it before domain work and use its terms, as written, in code, tests, issues, and briefs. When a term you need is missing or a definition no longer fits, change the glossary in the same change, one or two sentences per term, no implementation detail.
- [`docs/adr/0001-falkon-architecture.md`](../adr/0001-falkon-architecture.md): the single architecture record. Read the sections a change touches before changing behaviour. When a change departs from it, amend the record in place (date the amendment in the section it changes) or stop and raise the conflict; never add a second ADR file.

A missing term or decision does not block work: record it when it becomes real.
