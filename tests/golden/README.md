# Golden search baseline

`queries.json` is the request set. `expected.json` is a live normalized capture,
recorded by the coordinator with `GOLDEN_RECORD=1 sh scripts/ops-smoke.sh`.
No expected result file is fabricated from mocks. See
[the S0 baseline](../../.scratch/falkon-mvp/baseline.md) for recording and review steps.

The smoke script always compares two captures for stability, and compares with
`expected.json` whenever it exists. Only explicit record mode writes that file.
A missing baseline produces a warning. Existing baseline drift fails even in
record mode; retain and review the old file before removing it to re-record.

Run `pnpm test` after recording. Its baseline assertion requires non-empty
successful results for `archived:only`, `fork:only` and `visibility:private`.
It skips with a clear message when `expected.json` is absent. Worker, archive
and ledger have fixture Git metadata for fork, archived and private respectively;
empty results must be investigated before accepting a baseline.

Normalization preserves Zoekt's ranked file, match and chunk order and MCP text.
Only timings and unordered branch/range ordering are normalized. GET search
supports `limit`, but ignores `page`. Search pagination is a named non-goal except
where a route supports it; commit, branch and repository paging remain covered by
the MCP contracts. The `page: 1` on limit-one covers only the recorder option shape.
