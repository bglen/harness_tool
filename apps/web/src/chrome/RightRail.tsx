import { ClipboardCheck, PanelRightClose, PanelRightOpen, Receipt, Package } from "lucide-react";
import { useUi } from "../store/ui";
import { IconButton } from "../ui/primitives";
import { QuoteCard } from "./QuoteCard";
import { BomSnapshot, DfmCard } from "./DfmCard";

/** Right rail (~320 px): Instant Quote (sticky), Manufacturability, BOM Snapshot. Collapses to icons below 1280 px (§3). */
export function RightRail() {
  const ui = useUi();
  const narrow = typeof window !== "undefined" && window.innerWidth < 1280;
  const open = ui.rightRail && !narrow;
  if (!open)
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border-subtle bg-bg-surface-1 py-2" aria-label="Right rail (collapsed)">
        <IconButton label="Expand panel" onClick={() => (narrow ? ui.openDialog("dfm") : ui.toggleRightRail())} tipSide="left">
          <PanelRightOpen size={16} />
        </IconButton>
        <IconButton label="Quote" onClick={() => ui.openDialog("order")} tipSide="left">
          <Receipt size={16} />
        </IconButton>
        <IconButton label="Manufacturability" onClick={() => ui.openDialog("dfm")} tipSide="left">
          <ClipboardCheck size={16} />
        </IconButton>
        <IconButton label="BOM" onClick={() => ui.setView("bom")} tipSide="left">
          <Package size={16} />
        </IconButton>
      </aside>
    );
  return (
    <aside className="scroll-thin flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border-subtle bg-bg-surface-1" aria-label="Quote, manufacturability and BOM">
      <div className="sticky top-0 z-10 bg-bg-surface-1">
        <div className="flex justify-end px-1 pt-1">
          <IconButton label="Collapse panel" onClick={ui.toggleRightRail} tipSide="left" className="h-6 w-6">
            <PanelRightClose size={14} />
          </IconButton>
        </div>
        <QuoteCard />
      </div>
      <DfmCard />
      <BomSnapshot />
    </aside>
  );
}
