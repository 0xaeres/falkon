import { Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Product } from "@falkon/contracts";
import { stepNotes, steps } from "../lib/wizard-content";

/** The step indicator: a progress bar on narrow screens, the numbered rail beside the form on wide ones. */
export function WizardProgress({
  edit,
  step,
}: {
  edit?: Product;
  step: number;
}) {
  return (
    <>
      <div className="col-span-12 flex flex-col gap-2 lg:hidden">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Step {step + 1} of {steps.length}
          </span>
          <span className="font-medium text-foreground">{steps[step]}</span>
        </div>
        <Progress
          value={((step + 1) / steps.length) * 100}
          aria-label={`Step ${step + 1} of ${steps.length}`}
          className="h-1"
        />
      </div>
      <aside className="col-span-3 hidden lg:block">
        <div className="sticky top-12 flex flex-col gap-6">
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
              {edit ? `Edit ${edit.name}` : "Set up a Product"}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {edit
                ? "Change which repositories and branches it reads."
                : "Four steps. Indexing starts when you confirm."}
            </p>
          </div>
          <ol aria-label="Product setup steps" className="flex flex-col">
            {steps.map((label, index) => {
              const done = index < step;
              const now = index === step;
              return (
                <li
                  key={label}
                  aria-current={now ? "step" : undefined}
                  className="relative grid grid-cols-[24px_1fr] gap-x-3 pb-6 last:pb-0"
                >
                  {index < steps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-7 bottom-1 left-[11.5px] w-px bg-border",
                        done && "bg-foreground/40",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "z-10 grid size-6 place-items-center rounded-full border bg-background font-mono text-[0.6875rem] text-faint transition-colors",
                      now && "border-foreground bg-foreground text-background",
                      done &&
                        "border-foreground/40 bg-secondary text-foreground",
                    )}
                  >
                    {done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <div className="pt-0.5">
                    <div
                      className={cn(
                        "text-[0.8125rem] font-medium",
                        !now && !done && "text-muted-foreground",
                      )}
                    >
                      {label}
                    </div>
                    <div className="text-xs text-faint">{stepNotes[index]}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </>
  );
}
