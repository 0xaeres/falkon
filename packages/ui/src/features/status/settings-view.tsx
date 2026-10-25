"use client";
import Link from "next/link";
import { useState } from "react";
import { Pencil } from "lucide-react";
import type { KnowledgeActionRequest } from "@falkon/contracts";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { ProviderLogo } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Notice, Page, PageHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { knowledgeLine } from "@/lib/knowledge";

const ACTIONS = [
  ["scan", "Scan"],
  ["delete", "Delete"],
  ["include", "Include"],
] as const;

/** Delete destroys generated docs (regenerating costs model tokens): its first press only arms a confirmation. */
export function press(
  armed: string,
  repo: string,
  action: KnowledgeActionRequest["action"],
) {
  return action === "delete" && armed !== repo
    ? { armed: repo, send: false }
    : { armed: "", send: true };
}

export function SettingsView() {
  const { product, status, refresh } = useWorkspace();
  const [busy, setBusy] = useState("");
  const [armed, setArmed] = useState("");
  const [actionError, setActionError] = useState("");
  const kb = status?.knowledge;
  const kbLine = knowledgeLine(kb);
  // One request at a time: a double click cannot send the same action twice.
  async function ask(repo: string, action: KnowledgeActionRequest["action"]) {
    const step = press(armed, repo, action);
    setArmed(step.armed);
    if (!step.send) return;
    setBusy(repo);
    setActionError("");
    try {
      await api.knowledge(product.id, { repo, action });
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The request could not be sent. Try again.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <Page>
      <PageHeader title="Settings" description={product.name} />
      <Card className="col-span-12">
        <CardHeader className="border-b pb-3">
          <CardTitle>
            <h2>Product</h2>
          </CardTitle>
          <CardDescription>
            Identity and source of this Product.
          </CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href={`/setup?edit=${product.id}`}>
                <Pencil data-icon="inline-start" />
                Edit repositories
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <dl className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <dt className="text-xs text-muted-foreground">productId</dt>
            <dd className="mt-1 font-mono text-[0.8125rem]">{product.id}</dd>
          </div>
          <div className="px-5 py-4">
            <dt className="text-xs text-muted-foreground">Code host</dt>
            <dd className="mt-1 flex items-center gap-2 text-[0.8125rem]">
              <ProviderLogo
                provider={product.provider}
                size={12}
                className="p-1"
              />
              {product.host}
            </dd>
          </div>
          <div className="px-5 py-4">
            <dt className="text-xs text-muted-foreground">Repositories</dt>
            <dd className="mt-1 text-[0.8125rem]">
              {product.repositories.length} connected
            </dd>
          </div>
        </dl>
      </Card>
      {kb && (
        <Card className="col-span-12">
          <CardHeader className="border-b pb-3">
            <CardTitle>
              <h2>Knowledge base</h2>
            </CardTitle>
            <CardDescription>
              {kb.state === "off"
                ? "The knowledge base is turned off in the config."
                : kbLine}
            </CardDescription>
          </CardHeader>
          {kb.state !== "off" && (
            <>
              {actionError && (
                <Notice tone="err" className="m-5 mb-0 w-auto">
                  {actionError}
                </Notice>
              )}
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Repository</TableHead>
                    <TableHead className="pr-5 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {product.repositories.map((repo) => (
                    <TableRow key={repo.id}>
                      <TableCell className="pl-5" title={repo.id}>
                        <div className="font-medium">{repo.name}</div>
                        <div className="font-mono text-[0.6875rem] text-faint">
                          {repo.organization}
                        </div>
                      </TableCell>
                      <TableCell className="pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          {busy === repo.id && (
                            <Spinner className="mr-1 text-muted-foreground" />
                          )}
                          {ACTIONS.map(([action, label]) => (
                            <Button
                              key={action}
                              size="sm"
                              variant={
                                armed === repo.id && action === "delete"
                                  ? "destructive"
                                  : "outline"
                              }
                              disabled={busy !== ""}
                              onClick={() => void ask(repo.id, action)}
                            >
                              {armed === repo.id && action === "delete"
                                ? "Confirm delete"
                                : label}
                            </Button>
                          ))}
                          {armed === repo.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setArmed("")}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </Card>
      )}
    </Page>
  );
}
