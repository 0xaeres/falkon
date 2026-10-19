# Falkon UI

Issue: https://github.com/0xaeres/nexus-v2/issues/24
Status: complete

Build the locked setup, status and chat surfaces from the backend checkout's `.impeccable/mocks/` galleries and `build.py`. Separate sibling Next.js app. Synthetic data served only by local Next.js APIs; no real code-host credentials or integrations. Preserve Product boundaries, generation provenance, evidence, gaps and abstentions. Use shared layouts and small UI primitives, strict TypeScript, runtime API validation, on-demand evidence loading and accessible responsive behavior. Complete production build, lint, API tests and desktop/mobile browser verification before marking complete.

Source evidence: backend has `/v1/query` requiring an HTTP-route target and principal; it does not yet expose the general free-form chat, setup, or index-status contracts this UI needs. Those integrations remain deferred. Approved design fixes the visual world; no new design choice is needed.
