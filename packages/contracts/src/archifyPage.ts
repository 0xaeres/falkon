// The page a chat diagram is stored and shown as: archify's drawing alone (its ~650 KB viewer dropped), restyled on
// Falkon's palette, with the looped trace animation, hover focus (a node lights up with its links and neighbours) and a
// height report to the parent frame. About 20 to 40 KB. Pure string work so the engine (on store) and the UI (for pages
// stored before this) build the same page; it runs only in the UI's sandboxed iframe.

/** Message the page posts to its parent with its height in pixels. */
export const ARCHIFY_HEIGHT = "archify:height";

const CSS = `
:root{color-scheme:dark}
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block;width:100%;height:auto;
--text:#fafafa;--text-muted:#a1a1aa;--text-dim:#71717a;--grid:transparent;--mask:#0a0a0a;--lane-fill:rgba(255,255,255,.015);--lane-stroke:#3f3f46;--panel-border:#27272a;
--arrow:#71717a;--arrow-emphasis:#60a5fa;
--frontend-fill:rgba(8,51,68,.45);--frontend-stroke:#22d3ee;--backend-fill:rgba(6,78,59,.45);--backend-stroke:#34d399;
--database-fill:rgba(76,29,149,.45);--database-stroke:#a78bfa;--cloud-fill:rgba(120,53,15,.35);--cloud-stroke:#fbbf24;
--security-fill:rgba(136,19,55,.45);--security-stroke:#fb7185;--messagebus-fill:rgba(251,146,60,.3);--messagebus-stroke:#fb923c;
--external-fill:rgba(39,39,42,.6);--external-stroke:#a1a1aa;
font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace}
.c-grid{stroke:var(--grid);fill:none}.c-mask{fill:var(--mask);stroke:none}
.c-lane{fill:var(--lane-fill);stroke:var(--lane-stroke);stroke-dasharray:6,6}.c-lane-rule{stroke:var(--lane-stroke);fill:none;opacity:.7}.c-lane-wash{fill:var(--lane-fill);stroke:none}
.c-region{fill:rgba(251,191,36,.04);stroke:var(--cloud-stroke);stroke-dasharray:8,4}
.c-frontend{fill:var(--frontend-fill);stroke:var(--frontend-stroke)}.c-backend{fill:var(--backend-fill);stroke:var(--backend-stroke)}
.c-database{fill:var(--database-fill);stroke:var(--database-stroke)}.c-cloud{fill:var(--cloud-fill);stroke:var(--cloud-stroke)}
.c-security{fill:var(--security-fill);stroke:var(--security-stroke)}.c-messagebus{fill:var(--messagebus-fill);stroke:var(--messagebus-stroke)}
.c-external{fill:var(--external-fill);stroke:var(--external-stroke)}
.t-primary{fill:var(--text)}.t-muted{fill:var(--text-muted)}.t-dim{fill:var(--text-dim)}
.t-frontend{fill:var(--frontend-stroke)}.t-backend{fill:var(--backend-stroke)}.t-database{fill:var(--database-stroke)}.t-cloud{fill:var(--cloud-stroke)}
.t-security{fill:var(--security-stroke)}.t-messagebus{fill:var(--messagebus-stroke)}.t-external{fill:var(--external-stroke)}
.t-edge-default{fill:var(--arrow)}.t-edge-emphasis{fill:var(--arrow-emphasis)}.t-edge-security{fill:var(--security-stroke)}.t-edge-dashed{fill:var(--database-stroke)}
.semantic-sigil{fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;opacity:.76}
.semantic-sigil>*{vector-effect:non-scaling-stroke}.semantic-sigil .sigil-fill{fill:currentColor;stroke:none}
.s-frontend{color:var(--frontend-stroke)}.s-backend{color:var(--backend-stroke)}.s-database{color:var(--database-stroke)}.s-cloud{color:var(--cloud-stroke)}
.s-security{color:var(--security-stroke)}.s-messagebus{color:var(--messagebus-stroke)}.s-external{color:var(--external-stroke)}
.a-default{stroke:var(--arrow);fill:none}.a-emphasis{stroke:var(--arrow-emphasis);fill:none}
.a-security{stroke:var(--security-stroke);fill:none;stroke-dasharray:5,5}.a-dashed{stroke:var(--database-stroke);fill:none;stroke-dasharray:4,4}
.m-default{fill:var(--arrow)}.m-emphasis{fill:var(--arrow-emphasis)}.m-security{fill:var(--security-stroke)}.m-dashed{fill:var(--database-stroke)}
.brand-mark-badge{fill:#fff;stroke:none}.brand-mark-frame{fill:none;stroke:#cbd5e1;stroke-width:.8}
[data-legend-count-badge] rect{fill:var(--mask);stroke:var(--panel-border)}[data-legend-count-badge] text{fill:var(--text-muted);font-size:8px;font-weight:700;text-anchor:middle}
svg[data-animation=trace] [data-animate=edge]{animation:flow 6s linear infinite;animation-delay:calc(var(--step,0)*160ms)}
svg[data-animation=trace] [data-animate=node]{transform-box:fill-box;transform-origin:center;animation:pulse 6s ease-in-out infinite;animation-delay:calc(var(--step,0)*160ms)}
@keyframes flow{0%{stroke-dasharray:10 8;stroke-dashoffset:54;opacity:.45}38%{stroke-dasharray:10 8;stroke-dashoffset:0;opacity:1}38.1%,100%{stroke-dashoffset:0;opacity:1}}
@keyframes pulse{0%,30%,100%{filter:none}8%,16%{filter:drop-shadow(0 0 6px var(--arrow-emphasis))}}
[data-node-id]{cursor:pointer;outline:none;transition:opacity .15s}[data-edge-from]{transition:opacity .15s,stroke .15s}
svg[data-focus] [data-node-id]:not(.on),svg[data-focus] :is([data-edge-from],.a-default,.a-emphasis,.a-dashed,.a-security):not(.on){opacity:.16;animation:none}
svg[data-focus] [data-node-id].on :is(.c-frontend,.c-backend,.c-database,.c-cloud,.c-security,.c-messagebus,.c-external){filter:drop-shadow(0 0 6px var(--arrow-emphasis))}
svg[data-focus] path[data-edge-from].on{stroke:var(--arrow-emphasis);stroke-width:2.2;animation:none;stroke-dasharray:none}
svg[data-focus] g[data-edge-from].on text{fill:var(--arrow-emphasis)}
@media (prefers-reduced-motion:reduce){[data-animate]{animation:none!important}}
`;

const SCRIPT = `
(() => {
  const svg = document.querySelector("svg");
  if (!svg) return;
  // Crop to the drawing: archify reserves empty bands, and its background grid is a full-size rect.
  const boxes = [...svg.children].filter((el) => el.getBBox && !/url\\(#grid\\)/.test(el.getAttribute("fill") || "")).map((el) => el.getBBox()).filter((b) => b.width || b.height);
  if (boxes.length) {
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y)), pad = 12;
    const w = Math.max(...boxes.map((b) => b.x + b.width)) - x, h = Math.max(...boxes.map((b) => b.y + b.height)) - y;
    svg.setAttribute("viewBox", [x - pad, y - pad, w + 2 * pad, h + 2 * pad].join(" "));
  }
  // Hover or keyboard focus on a node lights it, its links and its neighbours.
  const nodes = [...svg.querySelectorAll("[data-node-id]")], edges = [...svg.querySelectorAll("[data-edge-from]")];
  const clear = () => { svg.removeAttribute("data-focus"); for (const el of svg.querySelectorAll(".on")) el.classList.remove("on"); };
  for (const node of nodes) {
    const on = () => {
      const id = node.dataset.nodeId, linked = edges.filter((e) => e.dataset.edgeFrom === id || e.dataset.edgeTo === id);
      const ids = new Set([id, ...linked.flatMap((e) => [e.dataset.edgeFrom, e.dataset.edgeTo])]);
      clear();
      svg.setAttribute("data-focus", "");
      for (const n of nodes) if (ids.has(n.dataset.nodeId)) n.classList.add("on");
      for (const e of linked) e.classList.add("on");
    };
    node.addEventListener("mouseenter", on); node.addEventListener("focus", on);
    node.addEventListener("mouseleave", clear); node.addEventListener("blur", clear);
  }
  const post = () => parent.postMessage({ type: "${ARCHIFY_HEIGHT}", height: Math.ceil(svg.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(svg);
  post();
})();
`;

/** The diagram's `<svg>`: the first one with a viewBox inside archify's diagram container (or anywhere in a page without one), nested svgs kept whole. */
function diagramSvg(html: string) {
  const from = Math.max(0, html.indexOf('class="diagram-container"'));
  const found = html.slice(from).search(/<svg[^>]*\sviewBox=/);
  if (found < 0) return undefined;
  const start = from + found;
  const tags = /<svg\b|<\/svg>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m; (m = tags.exec(html)); ) {
    depth += m[0] === "</svg>" ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return undefined;
}

/** The compact diagram page for an archify page (or an already compact one), or undefined when it holds no diagram. */
export function archifyPage(html: string) {
  const svg = diagramSvg(html);
  return svg && `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${svg}<script>${SCRIPT}</script></body></html>`;
}
