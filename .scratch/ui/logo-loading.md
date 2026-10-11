# Use the Falkon mark for loading states

Issue: https://github.com/0xaeres/nexus-v2/issues/28
Status: complete

Replace the shared generic skeleton loader across route transitions, workspace data loading, and lazy panels with the approved Falkon mark. Show no visible loading text. Animate the three existing wing bars in a restrained sequence using CSS only. Keep accessible status labels, preserve the mark geometry, respect reduced motion, and remove the placeholder cards. Do not add a minimum loading duration.

All skeleton callers use the shared primitive in src/components/ui/primitives.tsx. Existing issues #24 through #27 are complete; none covers this refinement. No external blocker.

Acceptance: every former skeleton uses the mark; no visible text or placeholder cards; CSS animation is lightweight and reduced-motion safe; loading state centers inside its region; existing checks and desktop/mobile verification pass.

## Verification

All former Skeleton callers use LoadingMark. No skeleton CSS remains. The actual server-rendered primitive and shipped CSS were inspected at desktop and mobile sizes: visible text is empty; the mark centers at 640,360 in 1280x720 and 195,422 in 390x844; animation delays are 0,120,240ms; mobile does not overflow. The reduced-motion rule disables movement and keeps the full mark visible. TypeScript, lint, all eight tests, and production build pass.
