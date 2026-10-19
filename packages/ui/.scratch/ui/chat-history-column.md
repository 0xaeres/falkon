# Separate chat history from page navigation

Status: complete

Move chat threads and New thread out of the global navigation into a dedicated chat history column beside it. Keep the global Product switcher, Status/Chat/Settings links, Docs, and Account in the existing navigation. Preserve Product-scoped history, day grouping, active-thread selection, thread creation, and errors. On mobile, use a separate history drawer opened from the header. With the extra column, use the existing evidence sheet on tablet so the conversation remains readable.

Current source: WorkspaceShell embeds history in navigation and hides it when the navigation collapses. Existing completed issues #24–28 do not cover this layout change. No external blocker.

Acceptance: history is a sibling of navigation, remains available when navigation collapses, works independently on mobile, preserves thread behavior, and does not create horizontal overflow. Existing tests, TypeScript/lint/build, and desktop/mobile browser checks pass.


Verification: nine tests passed, including an SSR regression proving saved conversations render outside page navigation. TypeScript, ESLint, and production build passed. Browser checks covered expanded/collapsed desktop navigation, tablet evidence, mobile history selection and independent page navigation. Saved-thread navigation also exposed and fixed a citation React-key collision and dynamic params awaiting outside Suspense. Screenshots: `.impeccable/review/chat-history-column.jpg` and `chat-history-mobile.jpg`.
