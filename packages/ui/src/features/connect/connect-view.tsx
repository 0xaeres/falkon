"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileJson,
  KeyRound,
  Network,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, PageHeader } from "@/components/ui/primitives";
import type { Snippets } from "@/lib/connect";
import { TOOLS } from "@/lib/tools";
import { tryCopy } from "./copy";

const CLIENTS = [
  {
    id: "claude",
    label: "Claude Code",
    icon: SquareTerminal,
    wrap: true,
    where:
      "Run in a terminal. Claude Code registers the server for this machine.",
    note: "Export FALKON_API_KEY before running.",
  },
  {
    id: "codex",
    label: "Codex",
    icon: SquareTerminal,
    wrap: true,
    where: "Run in a terminal. Codex adds the server to its config.",
    note: "Export FALKON_API_KEY, and keep it set when you run Codex.",
  },
  {
    id: "vscode",
    label: "Copilot (VS Code)",
    icon: FileJson,
    wrap: false,
    where: "Add to .vscode/mcp.json in your workspace.",
    note: "VS Code asks for the key when the server starts.",
  },
] as const;

type Copy = "idle" | "copied" | "failed";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<Copy>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    const next = await tryCopy(text);
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() => void copy()}
      >
        {state === "copied" ? (
          <Check data-icon="inline-start" />
        ) : (
          <Copy data-icon="inline-start" />
        )}
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed"
            : "Copy"}
      </Button>
      <span className="sr-only" role="status">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed, select the text"
            : ""}
      </span>
    </>
  );
}

/** One numbered step on the client setup rail. */
function Step({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative grid grid-cols-[28px_1fr] gap-x-4">
      <span className="z-10 grid size-7 place-items-center rounded-full border bg-secondary font-mono text-xs text-muted-foreground">
        {n}
      </span>
      {!last && (
        <span
          aria-hidden="true"
          className="absolute top-8 bottom-1 left-[13.5px] w-px bg-border"
        />
      )}
      <div className={last ? "min-w-0" : "min-w-0 pb-7"}>
        <h3 className="pt-1 text-[0.8125rem] font-medium">{title}</h3>
        <div className="mt-1 flex flex-col gap-3 text-[0.8125rem] text-muted-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}

export function ConnectView({
  apiKey,
  isDefault,
  url,
  snippets,
}: {
  apiKey: boolean;
  isDefault: boolean;
  url: string;
  snippets: Snippets;
}) {
  const { product } = useWorkspace();
  return (
    <Page>
      <PageHeader
        title="Connect"
        description={<>Add {product.name} to your coding agent over MCP.</>}
      />

      <Card className="col-span-12 lg:col-span-8">
        <Tabs defaultValue="claude" className="gap-0">
          <CardHeader className="border-b pb-0">
            <CardTitle>
              <h2>Choose your client</h2>
            </CardTitle>
            <CardDescription>
              Each client gets one command or config. Copy it, then restart the
              agent.
            </CardDescription>
            <TabsList
              variant="line"
              className="-mb-px mt-3 h-10 w-full justify-start gap-4 p-0"
            >
              {CLIENTS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="flex-none px-0.5">
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </CardHeader>
          {CLIENTS.map((client) => (
            // Every panel is in the page so each command stays findable; only the chosen one is shown.
            <TabsContent
              key={client.id}
              value={client.id}
              forceMount
              className="px-5 py-6 data-[state=inactive]:hidden"
            >
              <h2 className="sr-only">{client.label}</h2>
              <ol>
                <Step
                  n={1}
                  title={
                    client.id === "vscode"
                      ? "Add the server config"
                      : "Add the server"
                  }
                  last={!apiKey}
                >
                  <p>{client.where}</p>
                  <div className="overflow-hidden rounded-lg border bg-background">
                    <div className="flex items-center gap-2 border-b bg-card py-1.5 pr-1.5 pl-3">
                      <span className="flex-1 font-mono text-[0.6875rem] text-faint">
                        {client.id === "vscode" ? ".vscode/mcp.json" : "shell"}
                      </span>
                      <CopyButton
                        text={snippets[client.id]}
                        label={`${client.label} command`}
                      />
                    </div>
                    <pre
                      tabIndex={0}
                      aria-label={`${client.label} command`}
                      className={
                        client.wrap
                          ? "px-4 py-3.5 font-mono text-[0.78rem] leading-relaxed break-all whitespace-pre-wrap text-foreground"
                          : "overflow-x-auto px-4 py-3.5 font-mono text-[0.78rem] leading-relaxed text-foreground"
                      }
                    >
                      <code>{snippets[client.id]}</code>
                    </pre>
                  </div>
                </Step>
                {apiKey && (
                  <Step n={2} title="Provide the API key" last>
                    <p>{client.note}</p>
                  </Step>
                )}
              </ol>
            </TabsContent>
          ))}
        </Tabs>
      </Card>

      <div className="col-span-12 flex flex-col gap-6 lg:col-span-4">
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle>
              <h2>Endpoint</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="flex items-start gap-3">
              <Network
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">MCP URL</div>
                <div className="mt-0.5 font-mono text-xs break-all">{url}</div>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <KeyRound
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex-1 text-xs text-muted-foreground">
                Authentication
              </span>
              <Badge variant={apiKey ? "info" : "muted"}>
                {apiKey ? "API key" : "None"}
              </Badge>
            </div>
          </CardContent>
          {isDefault && (
            <CardFooter className="text-xs leading-relaxed text-muted-foreground">
              Using the local default address. Set FALKON_MCP_URL if agents
              connect from another machine.
            </CardFooter>
          )}
        </Card>
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <Wrench
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <h2>Tools</h2>
              <Badge variant="muted" className="ml-auto font-mono">
                {TOOLS.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              What your agent can call once connected.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ul aria-label="Tools" className="flex flex-wrap gap-1.5">
              {TOOLS.map((tool) => (
                <li key={tool}>
                  <Badge
                    variant="outline"
                    className="font-mono font-normal text-muted-foreground"
                  >
                    {tool}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

export function ConnectSkeleton() {
  return (
    <Page>
      <div
        role="status"
        aria-label="Loading connect"
        className="col-span-12 flex flex-col gap-2.5"
      >
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="col-span-12 flex flex-col gap-5 rounded-xl border bg-card p-5 lg:col-span-8">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-80" />
        <div className="flex gap-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
      <div className="col-span-12 flex flex-col gap-6 lg:col-span-4">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    </Page>
  );
}
