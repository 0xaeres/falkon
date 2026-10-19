## Goal
Build the approved Falkon setup, status, and chat UI as a separate Next.js application in `packages/ui`.

## Evidence and scope
There is no UI implementation in the backend checkout. Approved compositions and states live in `.impeccable/mocks/setup/index.html`, `.impeccable/mocks/status/index.html`, `.impeccable/mocks/chat/index.html`, and their generator `build.py`. The three locked surface briefs govern the UI. Existing issues cover backend work, not this UI.

Implement the five-step Product setup, layer-stack status with selectable detail panes, and three-pane grounded chat with citations, generation provenance, coverage gaps, abstention, and retry states. Preserve approved Falkon and provider assets, Geist fonts, dimensions, and palette. Add responsive mobile compositions, keyboard navigation, and accessible controls.

Serve synthetic data from Next.js Route Handlers through runtime-validated contracts and one typed HTTP client. Keep endpoint replacement localized. Include Product switching, repository branch selection, mock ingestion progress/retry, and Product-scoped thread persistence.

## Acceptance
- Setup queues ingestion and navigates to status; repository edits preserve the Product identity.
- Status includes approved freshness, build, overlay, and failure states.
- Chat presents only mock grounded answers with evidence attached and explicit gaps; unknown questions abstain.
- TypeScript, lint, production build, API validation and isolation checks, and desktop/mobile browser checks pass.
- Capture and compare representative approved frames; document API replacement and mock limitations.

## Dependencies and blockers
Ready for local implementation. Real authentication, credential storage, Product registry, ingestion and general retrieval endpoints are external integration work. This issue does not claim they exist or send credentials to real hosts.

## Active work
Claimed by Codex on 2026-10-11 at the user's request. Mock-only local app; no deployment requested.
