"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig, type ScopedMutator } from "swr";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { api, keys } from "@/lib/api/client";
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

/** Deletes the Product, drops its cached reads, and leaves for /setup. Returns the error text, or "" on success. */
export async function removeProduct(
  id: string,
  mutate: ScopedMutator,
  push: (path: string) => void,
) {
  try {
    await api.deleteProduct(id);
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "The request could not be sent. Try again.";
  }
  // Leave first: a refetch of the now-404 Product must not flash an error on this page.
  push("/setup");
  await mutate(
    (key) =>
      key === keys.products ||
      (typeof key === "string" &&
        (key === keys.product(id) || key.startsWith(`${keys.product(id)}/`))),
    undefined,
    { revalidate: false },
  );
  return "";
}

/** The dialog body: the red button enables only on the exact slug (GitHub pattern). */
export function DeleteForm({
  slug,
  typed,
  busy,
  error,
  onType,
  onConfirm,
}: {
  slug: string;
  typed: string;
  busy: boolean;
  error: string;
  onType: (value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <label className="grid gap-2 text-sm">
        <span>
          Type <code className="font-mono">{slug}</code> to confirm.
        </span>
        <Input
          value={typed}
          onChange={(event) => onType(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {error && <Notice tone="err">{error}</Notice>}
      <DialogFooter>
        <Button
          variant="destructive"
          disabled={typed !== slug || busy}
          onClick={onConfirm}
        >
          Delete Product
        </Button>
      </DialogFooter>
    </>
  );
}

function DangerZone({ id }: { id: string }) {
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    const message = await removeProduct(id, mutate, router.push);
    // Success navigates away: stay busy so a second click cannot send a second DELETE.
    if (message) {
      setError(message);
      setBusy(false);
    }
  }
  return (
    <Card className="col-span-12 border-destructive/50">
      <CardHeader>
        <CardTitle>
          <h2 className="text-destructive">Danger zone</h2>
        </CardTitle>
        <CardDescription>
          Deleting a Product removes its chats and any repositories no other
          Product needs. This cannot be undone.
        </CardDescription>
        <CardAction>
          <Dialog
            onOpenChange={() => {
              setTyped("");
              setError("");
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive">
                Delete Product
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {id}?</DialogTitle>
                <DialogDescription>
                  This removes the Product and its chats for good.
                </DialogDescription>
              </DialogHeader>
              <DeleteForm
                slug={id}
                typed={typed}
                busy={busy}
                error={error}
                onType={setTyped}
                onConfirm={() => void confirm()}
              />
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
    </Card>
  );
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
      <DangerZone id={product.id} />
    </Page>
  );
}
