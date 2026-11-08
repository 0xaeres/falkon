import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// How the rail behaves, the operator's choice: always open, always closed, or closed and widening over the page on hover.
export type RailMode = "expanded" | "collapsed" | "hover";
const RAIL_MODES: [RailMode, string][] = [
  ["expanded", "Expanded"],
  ["collapsed", "Collapsed"],
  ["hover", "Expand on hover"],
];
export const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("sidebar-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("sidebar-change", listener);
  };
};
export function railPreference(): RailMode {
  try {
    const stored = localStorage.getItem("falkon.sidebar");
    return stored === "expanded" || stored === "collapsed" ? stored : "hover";
  } catch {
    return "hover";
  }
}
function setRailMode(mode: RailMode) {
  try {
    localStorage.setItem("falkon.sidebar", mode);
  } catch {
    /* Without storage the rail keeps expanding on hover. */
  }
  window.dispatchEvent(new Event("sidebar-change"));
}

/** The rail's footer button and its menu for choosing how the rail behaves. */
export function RailControl({
  mode,
  open,
  onOpenChange,
}: {
  mode: RailMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="shrink-0 border-t border-sidebar-border p-2">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sidebar control"
            title="Sidebar control"
            className="ml-[3px] text-faint"
          >
            <PanelLeft />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-52"
        >
          <DropdownMenuLabel className="text-xs font-normal text-faint">
            Sidebar control
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => setRailMode(value as RailMode)}
            >
              {RAIL_MODES.map(([value, text]) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {text}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
