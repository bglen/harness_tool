import { GitBranch, Maximize, MousePointer2, Plus, Shield, StickyNote } from "lucide-react";
import { useUi } from "../store/ui";
import { IconButton } from "../ui/primitives";
import { runAction } from "../lib/actions";

/** Bottom-centre canvas toolbar: Select, Add Connector, Add Breakout/Splice, Add Note, Zoom-to-fit. Nothing else (§3). */
export function FloatingToolbar() {
  const ui = useUi();
  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-card border border-border-subtle bg-bg-surface-2 p-1 shadow-lg" role="toolbar" aria-label="Canvas tools">
      <IconButton label="Select" shortcut="Esc" onClick={() => ui.clearSelection()}>
        <MousePointer2 size={18} />
      </IconButton>
      <IconButton label="Add connector" shortcut="C" onClick={() => runAction("addConnector")}>
        <Plus size={20} />
      </IconButton>
      <IconButton label="Add breakout: click a bundle to split it (B)" shortcut="B" active={ui.tool === "breakout"} onClick={() => ui.setTool(ui.tool === "breakout" ? null : "breakout")}>
        <GitBranch size={18} />
      </IconButton>
      <IconButton label="Add note" shortcut="N" onClick={() => runAction("addNote")}>
        <StickyNote size={18} />
      </IconButton>
      <div className="mx-1 h-5 w-px bg-border-subtle" />
      <IconButton label="Shield view" shortcut="G" active={ui.shieldView} onClick={() => ui.toggleShieldView()}>
        <Shield size={18} />
      </IconButton>
      <IconButton label="Zoom to fit" shortcut="F" onClick={() => runAction("zoomFit")}>
        <Maximize size={18} />
      </IconButton>
    </div>
  );
}
