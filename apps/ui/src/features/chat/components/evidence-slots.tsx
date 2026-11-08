import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

/** The evidence as a resizable side pane (wide screens). */
export function EvidenceAside({ children }: { children: ReactNode }) {
  return (
    <>
      <ResizableHandle
        withHandle
        className="w-px bg-border transition-colors hover:bg-info data-[separator=active]:bg-info"
      />
      <ResizablePanel id="evidence" defaultSize="34" minSize={340} maxSize="65">
        <aside
          className="h-full min-h-0 min-w-0 overflow-hidden"
          aria-label="Source evidence"
        >
          {children}
        </aside>
      </ResizablePanel>
    </>
  );
}

/** The evidence in a sheet (narrower screens). */
export function EvidenceSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-[480px] xl:hidden"
      >
        <SheetTitle className="sr-only">Source evidence</SheetTitle>
        <SheetDescription className="sr-only">
          Source excerpts and pinned revisions for this answer.
        </SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
