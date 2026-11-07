"use client";

import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Highlighted HTML for a known language (highlight.js escapes the code), else undefined and the code shows plain. */
export const highlight = (code: string, lang?: string) =>
  lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : undefined;

export function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(code, lang), [code, lang]);
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
        {html ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
      </pre>
    </div>
  );
}
