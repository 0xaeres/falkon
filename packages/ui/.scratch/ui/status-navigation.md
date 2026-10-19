# Status navigation redesign

Status: complete, verified with independent ship verdict on 2026-10-11.
Issue: https://github.com/0xaeres/nexus-v2/issues/25

Replace the status layer-card stack with a vertical section/status rail directly alongside the existing global navigation. Keep the established Falkon palette, fonts, Product scope, freshness verdict, generation provenance, and working actions. The remaining main area displays the selected section's details. At tablet widths retain the two-column section/detail arrangement; on mobile provide compact section navigation and readable detail content. Make selection, keyboard access, and status labels explicit.

Evidence: `src/features/status/status-view.tsx` owns all four detail views. Existing CSS stacks them below 1024px; the 861px incumbent capture shows details pushed far down by large layer cards. No new API or dependency is needed. Issue #24 completed the original UI; no existing open issue covers this requested replacement composition.

Acceptance: section selection updates details; most urgent section is selected initially; retry/dismiss/edit/chat behavior survives; desktop, tablet, and mobile remain usable; TypeScript, lint, production build, existing API checks, bounded browser verification, and independent finish review pass.
