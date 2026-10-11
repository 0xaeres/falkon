import { Suspense, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { Skeleton } from "@/components/ui/primitives";
type Props = { children: ReactNode; params: Promise<{ productId: string }> };
async function Workspace({ children, params }: Props) {
  const { productId } = await params;
  return (
    <WorkspaceShell key={productId} productId={productId}>
      {children}
    </WorkspaceShell>
  );
}
export default function ProductLayout(props: Props) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Workspace {...props} />
    </Suspense>
  );
}
