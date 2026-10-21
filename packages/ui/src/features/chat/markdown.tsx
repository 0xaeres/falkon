"use client";

import {
  createContext,
  isValidElement,
  useContext,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";
import { MermaidBlock } from "./mermaid-block";

type Node = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

/** Turns `[n]` in prose into a marker element for each known citation; inside code the engine's zero-width space after `[` is dropped so `[n]` reads literally. */
const rehypeCitations = (ids: Set<number>) => (tree: Node) => {
  const walk = (parent: Node, inCode: boolean) => {
    parent.children = parent.children?.flatMap((child): Node[] => {
      if (child.type === "element") {
        walk(
          child,
          inCode || child.tagName === "code" || child.tagName === "pre",
        );
        return [child];
      }
      if (child.type !== "text") return [child];
      if (inCode)
        return [{ ...child, value: child.value!.replace(/\[\u200b/g, "[") }];
      return child.value!.split(/(\[\d+\])/).flatMap((part): Node[] => {
        const id = /^\[(\d+)\]$/.exec(part)?.[1];
        if (id && ids.has(Number(id)))
          return [
            {
              type: "element",
              tagName: "span",
              properties: { dataCite: id },
              children: [],
            },
          ];
        return part ? [{ type: "text", value: part }] : [];
      });
    });
  };
  walk(tree, false);
};

const safeHref = (href?: string) =>
  href && /^(https?:|mailto:)/i.test(href) ? href : undefined;

const Citations = createContext<Record<number, ReactNode>>({});

function Span(props: { children?: ReactNode }) {
  const citations = useContext(Citations);
  const id = (props as { "data-cite"?: string })["data-cite"];
  return id ? <>{citations[Number(id)]}</> : <span>{props.children}</span>;
}

/** Module-level so React sees the same component types on every render (no remount of citation buttons, diagrams or copy state). Citations reach the span through context. */
const base: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    );
  },
  img: () => null,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  span: Span,
};
const withPre = (final: boolean): Components => ({
  ...base,
  pre: ({ children }) => {
    const el = isValidElement<{ className?: string; children?: ReactNode }>(
      children,
    )
      ? children
      : undefined;
    const lang = /language-(\S+)/.exec(el?.props.className ?? "")?.[1];
    const code = String(el?.props.children ?? "").replace(/\n$/, "");
    return lang === "mermaid" && final ? (
      <MermaidBlock source={code} />
    ) : (
      <CodeBlock lang={lang} code={code} />
    );
  },
});
const finalComponents = withPre(true);
const streamingComponents = withPre(false);
/** The stable components object for a render mode (exported so a test can pin its identity). */
export const componentsFor = (final: boolean) =>
  final ? finalComponents : streamingComponents;

/** Model output as GFM Markdown. Raw HTML is not parsed into elements, images are dropped, links are http(s)/mailto only; `final` false (streaming) keeps mermaid as code. */
export function Markdown({
  text,
  citations = {},
  final = true,
}: {
  text: string;
  citations?: Record<number, ReactNode>;
  final?: boolean;
}) {
  return (
    <Citations.Provider value={citations}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeCitations, new Set(Object.keys(citations).map(Number))],
        ]}
        components={componentsFor(final)}
      >
        {text}
      </ReactMarkdown>
    </Citations.Provider>
  );
}
