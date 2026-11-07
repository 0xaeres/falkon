import { Suspense, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { notFound } from "next/navigation";
import { engineProduct } from "@/lib/api/engine";
import { LoadingMark } from "@/components/ui/primitives";
type Props = { children: ReactNode; params: Promise<{ productId: string }> };
async function Workspace({ children, params }: Props) {
  const { productId } = await params;
  const initialProduct = (await engineProduct(productId)) ?? notFound();
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
