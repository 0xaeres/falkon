import Link from "next/link";
import { Mark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-[560px] flex-col items-start justify-center gap-3 px-6"
    >
      <Mark size={32} />
      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">
        Page not found
      </h1>
      <p className="text-muted-foreground">
        This page does not exist in Falkon.
      </p>
      <Button asChild className="mt-4">
        <Link href="/">Open status</Link>
      </Button>
    </main>
  );
}
