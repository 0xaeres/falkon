# Render workspace routes during initial server rendering

Issue: https://github.com/0xaeres/nexus-v2/issues/27
Status: complete

The shared WorkspaceShell uses client SWR to load the Product and returns only a skeleton before that request completes. Its route children are omitted during SSR. Next.js 16.4 instant-navigation validation reports the chat page as an unrendered segment; the same shell also wraps status, settings, and thread routes.

Load the initial Product in the existing asynchronous workspace layout and seed SWR with that Product. Keep client revalidation and Product-scoped cache keys. Preserve the existing Suspense loading boundary. Do not opt routes out of validation.

Acceptance: a server render with an empty SWR cache includes child route content and the correct Product context; the reported chat route has no unrendered-segment insight; status-to-chat navigation and unknown Product handling work; UI/API tests, TypeScript, lint, and build pass.

Reproduction: dev overlay at /sdsadsa/chat reports instant-unrendered-segment. `npx tsx --test tests/workspace-render.test.tsx` fails because the rendered HTML omits the child route. Existing UI issues #24 through #26 are complete; none covers this error. No external blocker.

## Verification

The regression failed before the fix and passes after it. `npm test` now includes both the seven existing API tests and the workspace SSR regression. TypeScript, ESLint, production build, and whitespace checks pass. The dev tool menu on /sdsadsa/chat has no Insights entry after reload and after status-to-chat client navigation. A missing Product displays the not-found page. No instant-validation opt-out or debug instrumentation was added.

The server layout uses the existing local store for the initial Product; README documents replacing this load alongside the real API adapter. The shared shell retains SWR revalidation, Product-specific cache keys, loading behavior, and existing error handling.

Framework guidance: https://nextjs.org/docs/messages/instant-unrendered-segment
