/** Diagram sources above this fall back to the plain code block (a real diagram is a few hundred characters; mermaid's own limit is 50k). */
export const MERMAID_MAX_CHARS = 20_000;

type MermaidApi = Pick<
  typeof import("mermaid").default,
  "initialize" | "parse" | "render"
>;
const loadMermaid = async (): Promise<MermaidApi> =>
  (await import("mermaid")).default;

// Only mermaid's `base` theme takes custom variables; these are the Falkon dark tokens, hex only.
const THEME = {
  darkMode: true,
  background: "#0a0a0a",
  fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
  fontSize: "13px",
  primaryColor: "#0f172a",
  primaryTextColor: "#fafafa",
  primaryBorderColor: "#3b82f6",
  secondaryColor: "#1e293b",
  secondaryTextColor: "#e2e8f0",
  secondaryBorderColor: "#3b82f6",
  tertiaryColor: "#111113",
  tertiaryTextColor: "#d4d4d8",
  tertiaryBorderColor: "#334155",
  lineColor: "#64748b",
  textColor: "#d4d4d8",
  titleColor: "#fafafa",
  nodeTextColor: "#fafafa",
  mainBkg: "#0f172a",
  clusterBkg: "#0d1117",
  clusterBorder: "#334155",
  edgeLabelBackground: "#111113",
  noteBkgColor: "#27272a",
  noteTextColor: "#fafafa",
  noteBorderColor: "#52525b",
  actorBkg: "#0f172a",
  actorBorder: "#3b82f6",
  actorTextColor: "#fafafa",
  actorLineColor: "#52525b",
  signalColor: "#a1a1aa",
  signalTextColor: "#fafafa",
  labelBoxBkgColor: "#18181b",
  labelBoxBorderColor: "#52525b",
  labelTextColor: "#fafafa",
  loopTextColor: "#d4d4d8",
  activationBkgColor: "#27272a",
  activationBorderColor: "#71717a",
  sequenceNumberColor: "#0a0a0a",
};

let counter = 0;
/** The SVG for a mermaid source, or null when it is too big or does not parse (the caller shows the code). `load` is a seam for tests. */
export async function drawMermaid(
  source: string,
  load: () => Promise<MermaidApi> = loadMermaid,
): Promise<string | null> {
  if (source.length > MERMAID_MAX_CHARS) return null;
  const id = `mermaid-${++counter}`;
  try {
    const mermaid = await load();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      look: "classic",
      themeVariables: THEME,
      flowchart: {
        curve: "basis",
        padding: 14,
        nodeSpacing: 36,
        rankSpacing: 44,
      },
      sequence: { mirrorActors: false },
    });
    await mermaid.parse(source);
    return (await mermaid.render(id, source)).svg;
  } catch {
    // A failed render can leave its scratch node in the body.
    if (typeof document !== "undefined")
      document.getElementById(`d${id}`)?.remove();
    return null;
  }
}
