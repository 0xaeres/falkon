# Fix branch selector and input focus

Issue: https://github.com/0xaeres/nexus-v2/issues/26
Status: complete

The repository branch picker wraps a native select in a bordered label. The global focus-visible outline draws a second blue rectangle around the inner select, and the platform arrow sits against the right boundary. Native select menus cannot reliably open beside the control.

Use the installed Radix dropdown menu for branch selection, with a right-side preference, collision handling, a checked selected option, keyboard navigation, and focus return. Keep repository selection and disabled behavior intact. Replace blue field halos with a neutral border focus state for regular inputs, repository search, and the chat composer. Keep error borders and visible keyboard focus.

Acceptance: menu opens beside the branch field when space permits, chevron has stable padding, selection updates without toggling the repository, disabled rows cannot open, keyboard selection/Escape work, narrow viewports do not overflow, typecheck/lint/build pass.

Evidence: Browser reproduction at /setup, repository step: focused payments-api native select has rgb(59, 130, 246) solid 2px outline inside the bordered wrapper. Existing issues #24 and #25 are complete; no open issue covers this fix. No external blocker.

## Verification

TypeScript, ESLint, production build, whitespace validation, and the scoped layout detector pass. Browser checks at 1440px and 390px verify right-side desktop placement with an 8px gap, viewport-safe mobile placement below the field, checked selection, no repository deselection from portal events, disabled triggers, and keyboard focus return on Escape. Search focus has a neutral border, no shadow, and no inner outline.

Runnable browser regression: import `.scratch/ui/branch-selector-check.mjs` in cua_repl and call `checkBranchSelector(tab)` on the repository setup step with payments-api selected and fraud-rules unselected. Passed against the live app. QA screenshots are in `.impeccable/review/branch-dropdown-desktop.jpg` and `branch-dropdown-mobile.jpg`.

## Follow-up

The organization select retains a cramped native arrow. Replace all remaining native selects with one shared Radix selection control and a padded Lucide chevron. Apply a translucent dark background, backdrop blur, and a subtle light boundary to the shared menu surface, covering organization, branch, Product, account, status navigation, and scenario dropdowns. Keep an opaque fallback when backdrop filtering is unsupported.

Follow-up verification: organization chevron inset is 13px; computed shared glass background is rgba(24, 24, 27, 0.78) with blur(20px) saturate(1.4). Organization selection and branch regression checks pass. Scenario and Product menus expose their existing options. Mobile status selection updates the detail panel without page overflow. No native selects remain. TypeScript, lint, production build, and scoped design scan pass.

## macOS glass reference refinement

Match the supplied Battery menu reference with smoked charcoal glass, a subtle cool top tint, stronger blur, a luminous rim with inner edge highlight, rounder corners, and a deeper soft shadow. Apply this to the existing shared dropdown surface. Preserve typography, compact sizing, placement, and selection behavior.

Reference refinement verified at desktop and mobile sizes. Shared surface has 28px blur, a luminous boundary, inset top highlight, and smoked gradient. Organization regression passes; mobile menu remains within the viewport. Production build passes.
