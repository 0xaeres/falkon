import { Suspense, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { notFound } from "next/navigation";
import { findProduct, MockError, transact } from "@/lib/mock/store";
import { LoadingMark } from "@/components/ui/primitives";
type Props = { children: ReactNode; params: Promise<{ productId: string }> };
async function Workspace({ children, params }: Props) {
  const { productId } = await params;
  const initialProduct = await transact((db) =>
    findProduct(db, productId),
  ).catch((error: unknown) => {
    if (error instanceof MockError && error.status === 404) notFound();
    throw error;
  });
  return (
    <WorkspaceShell
      key={productId}
      productId={productId}
      initialProduct={initialProduct}
    >
      {children}
    </WorkspaceShell>
  );
}
export default function ProductLayout(props: Props) {
  return (
    <Suspense fallback={<LoadingMark />}>
      <Workspace {...props} />
    </Suspense>
  );
}
