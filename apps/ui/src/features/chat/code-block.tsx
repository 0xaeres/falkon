"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type Hljs = typeof import("highlight.js/lib/common").default;
let loaded: Hljs | undefined;
const load = () => import("highlight.js/lib/common").then((m) => (loaded = m.default));
const highlight = (h: Hljs, code: string, lang?: string) =>
  lang && h.getLanguage(lang)
    ? h.highlight(code, { language: lang, ignoreIllegals: true }).value
    : undefined;

export function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [hl, setHl] = useState(loaded);
  useEffect(() => {
    if (!hl) void load().then(setHl);
  }, [hl]);
  const html = hl && highlight(hl, code, lang);
  return (
    <div className="code-block max-w-full overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b py-1 pr-1 pl-3">
        <span className="code-lang font-mono text-[0.6875rem] text-faint">
          {lang}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy code"
          title={copied ? "Copied" : "Copy code"}
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            );
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[0.8125rem] leading-relaxed">
        {html ? (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}
