"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block max-w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b bg-card py-1 pr-1 pl-3">
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
      <pre className="overflow-x-auto px-3.5 py-3 text-[0.78rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
