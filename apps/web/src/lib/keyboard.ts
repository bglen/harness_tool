import { useEffect } from "react";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";
import { actionAvailable, runAction } from "./actions";

/** Global keyboard shortcuts (§5.4). Single-letter shortcuts are ignored while typing. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      // The drawing template editor handles its own keys (Delete, arrows, undo) while open.
      if (ui.dialogs.templateEditor) return;
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
      // Tab flips the design canvas between the schematic and the bundle layout (focus moves normally inside dialogs and menus).
      if (e.key === "Tab" && !e.altKey) {
        if (ui.view !== "design" || (e.target as HTMLElement).closest?.("[role=dialog],[role=menu],[role=listbox],[role=alertdialog]")) return;
        e.preventDefault();
        return runAction("canvasToggle");
      }
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
      // F flips the selected connector(s); Shift+F fits the view.
      if (k === "f") {
        e.preventDefault();
        if (e.shiftKey) return runAction("zoomFit");
        if (ui.selection.kind === "connector" && ui.selection.ids.length) return runAction("cFlip");
        return ui.toast({ kind: "info", text: "Select a connector to flip it (F). Shift+F fits the view." });
      }
      const map: Record<string, string> = { c: "addConnector", n: "addNote", r: "commit", g: "shieldView", l: "wireList", t: "wTwist", "1": "viewDesign", "2": "viewBom", "3": "viewOutputs", "?": "shortcuts" };
      const id = map[k] ?? map[e.key];
      if (id) {
        e.preventDefault();
        // T toggles: twists a loose selection, untwists one that is already twisted together.
        if (id === "wTwist" && !actionAvailable("wTwist")) return runAction("wUntwist");
        runAction(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
