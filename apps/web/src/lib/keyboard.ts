import { useEffect } from "react";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";
import { runAction } from "./actions";

/** Global keyboard shortcuts (§5.4). Single-letter shortcuts are ignored while typing. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const typing = !!(e.target as HTMLElement).closest?.("input,textarea,select,[contenteditable=true]");
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") return e.preventDefault(), runAction("save");
      if (mod && k === "k") return e.preventDefault(), ui.openDialog("palette");
      if (mod && k === "o") return e.preventDefault(), runAction("open");
      if (typing) return;
      if (mod && k === "z" && !e.shiftKey) return e.preventDefault(), useProject.getState().undo();
      if ((mod && k === "z" && e.shiftKey) || (mod && k === "y")) return e.preventDefault(), useProject.getState().redo();
      if (mod && k === "d") return e.preventDefault(), runAction("cDuplicate");
      if (mod && k === "c") return runAction("copy");
      if (mod && k === "v") return runAction("paste");
      if (mod && k === "a") return e.preventDefault(), runAction("selectAll");
      if (mod) return;
      if (e.key === "Escape") {
        if (ui.picker) return ui.openPicker(null);
        if (ui.popover) return ui.openPopover(null);
        if (ui.contextMenu) return ui.openContextMenu(null);
        if (ui.tool) return ui.setTool(null);
        if (ui.shieldView) return ui.toggleShieldView();
        return ui.clearSelection();
      }
      if (e.key === "Delete" || e.key === "Backspace") return runAction("delete");
      if (ui.view !== "design" && !["1", "2", "3", "?"].includes(e.key)) return;
      if (k === "b") return e.preventDefault(), ui.setTool(ui.tool === "breakout" ? null : "breakout");
      const map: Record<string, string> = { c: "addConnector", n: "addNote", f: "zoomFit", r: e.shiftKey ? "cFlip" : "commit", g: "shieldView", l: "wireList", t: "wTwist", "1": "viewDesign", "2": "viewBom", "3": "viewOutputs", "?": "shortcuts" };
      const id = map[k] ?? map[e.key];
      if (id) {
        e.preventDefault();
        runAction(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
