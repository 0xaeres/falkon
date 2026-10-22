# S45 spot-check (D97): 4 hidden questions, 25% of the dataset

One per repository, covering all three kinds. For each, open the sources and confirm the claim. Gold is what `tests/eval/datasets/o3-history.json` scores against; the mining record for every question is in `questions.json` next to this file.

## hist-a-08 (kind a, why it changed) - openmrs-core

Question: Why does openmrs-core's `ChainingInterceptor` now override the Hibernate 7 persist and remove callbacks itself instead of only the deprecated save and delete ones? What did database event consumers miss before, and which change and ticket made it?

Gold:
- change `openmrs-core` commit `0e0255b872f08dabafe9414d623820272cd475be`, PR #6637
- ticket `TRUNK-6827`

Sources:
- https://github.com/openmrs/openmrs-core/pull/6637
- https://github.com/openmrs/openmrs-core/commit/0e0255b872f08dabafe9414d623820272cd475be
- https://openmrs.atlassian.net/browse/TRUNK-6827

Claim to verify: TRUNK-6827 reports that on Hibernate 7 core's EventInterceptor published no SaveDbEvent for created entities and no DeleteDbEvent for removed ones, because `ChainingInterceptor` overrode only `onSave`/`onDelete`; PR #6637 (squash-merged as `0e0255b8`, 2026-10-13) makes `ChainingInterceptor` override and forward `onPersist`/`onRemove`, and no other commit at the pin names TRUNK-6827.

## hist-a-13 (kind a, why it changed) - openmrs-esm-patient-chart

Question: Why did the form-entry app's `FeWrapperComponent` change the way it lazily imports Angular's locale data? What had the Angular form engine been falling back to for dates and numbers, and which change and ticket fixed it?

Gold:
- change `openmrs-esm-patient-chart` commit `c7d6eb8dcec4dc4ce60a285798920842d88820d2`, PR #3657
- ticket `O3-5976`

Sources:
- https://github.com/openmrs/openmrs-esm-patient-chart/pull/3657
- https://openmrs.atlassian.net/browse/O3-5976

Claim to verify: O3-5976 explains that `FeWrapperComponent` imported locale data through a webpack context restricted to `.mjs` while `@angular/common/locales/` ships only `.js`, so `registerLocaleData()` never ran and the engine fell back to Angular's built-in en-US data; PR #3657 (merged 2026-10-05) changes that import, and it is the only commit at the pin that names O3-5976.

## hist-b-09 (kind b, what changed and when) - openmrs-esm-billing-app

Question: Which merged pull requests changed `src/invoice/printable-invoice/printable-invoice.component.tsx` in openmrs-esm-billing-app between 2026-04-15 and the pinned head, and when was each merged?

Gold (change units):
- `5127b0c031addf584cc49f6252272121d50c5cad`, PR #732, merged 2026-05-18 (O3-5417, bill discounts)
- `3ecce2a55223b21d3c53d4905b346455f94f4fd2`, PR #743, merged 2026-05-26 (O3-5705, net amount for balance due)
- `4aa8e4c993d5fe06147c9561c949a6da36aea47e`, PR #741, merged 2026-06-02 (O3-5421, visit-bills panel)

Sources:
- https://github.com/openmrs/openmrs-esm-billing-app/commits/c770afca8921295dd87d8e7c185a8a4fef231376/src/invoice/printable-invoice/printable-invoice.component.tsx
- https://github.com/openmrs/openmrs-esm-billing-app/pull/732, /pull/743, /pull/741

Claim to verify: on the main line up to the pin `c770afca` (2026-10-15), exactly these three squash-merged PRs touched the file on or after 2026-04-15, and each PR's merge commit is the listed SHA.

## hist-c-07 (kind c, ticket to code) - openmrs-esm-core

Question: O3-6093: `extractVariableNames()` in the expression evaluator misses unbound variables used inside arrow-function bodies (for example `a.map(x => f(b))` yields only `a`). Which change fixed it, and which code in esm-core implements the fix?

Gold:
- change `openmrs-esm-core` commit `cd6cf1fcbdab85d05529d015dfb911dfef885b84`, PR #1943
- ticket `O3-6093`
- span `openmrs-esm-core/packages/framework/esm-expression-evaluator/src/extractor.ts` lines 92-119
- span `openmrs-esm-core/packages/framework/esm-expression-evaluator/src/extractor.ts` lines 151-173

Sources:
- https://github.com/openmrs/openmrs-esm-core/pull/1943
- https://openmrs.atlassian.net/browse/O3-6093
- https://github.com/openmrs/openmrs-esm-core/blob/7a172083f27035a8f20aa71fbc5e208ab07fa97a/packages/framework/esm-expression-evaluator/src/extractor.ts#L92-L173

Claim to verify: O3-6093 reports `extractVariableNames()` returning `["a"]` for `a.map(x => f(b))`; PR #1943 (merged 2026-10-10) fixes it in `extractor.ts`, and at the pin `7a172083` lines 92-119 and 151-173 are lines that PR wrote (git blame attributes them to `cd6cf1fc`) and that implement the arrow-function scope handling.
