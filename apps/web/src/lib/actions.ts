import {
  addBreakout,
  addNote,
  combineSegments,
  commitRatsnest,
  currentHarness,
  currentRevision,
  deleteConnectors,
  deleteNodes,
  deleteNotes,
  deleteSegments,
  deleteWires,
  duplicateConnectors,
  removeLabels,
  removeLayers,
  removeClamps,
  removeBoots,
  removeHardware,
  rotateConnector,
  setConnectorProps,
  twistWires,
  untwist,
  uid,
  unpinWireProps,
  type Harness,
} from "@hs/model";
import { dispatch, getProject, useProject } from "../store/project";
import { useUi, type SelKind } from "../store/ui";
import { copySelection, pasteClipboard } from "./clipboard";
import { downloadProject, openProjectFile } from "./files";
import { zoomToFit, screenToCanvas } from "./viewport";
import { nodePos } from "./geometry";

export interface ActionCtx {
  kind: SelKind | null;
  ids: string[];
  h: Harness;
  anchor: { x: number; y: number };
}

export interface Action {
  id: string;
  label: string;
  group: string;
  icon?: string;
  shortcut?: string;
  /** Show in the floating context bar for these selection kinds. */
  bar?: SelKind[];
  /** Show in the right-click menu for these kinds. */
  menu?: SelKind[];
  danger?: boolean;
  when?: (c: ActionCtx) => boolean;
  run: (c: ActionCtx) => void;
}

function sharedNode(h: Harness, a: string, b: string): string | undefined {
  const s1 = h.segments.find((x) => x.id === a);
  const s2 = h.segments.find((x) => x.id === b);
  if (!s1 || !s2) return undefined;
  return [s1.a, s1.b].find((n) => n === s2.a || n === s2.b);
}

const pop = (kind: string, c: ActionCtx, data?: unknown) => useUi.getState().openPopover({ kind, screen: c.anchor, data: data ?? { ids: c.ids, kind: c.kind } });

export const ACTIONS: Action[] = [
  // ─── Global ───────────────────────────────────────────────────────────────
  {
    id: "addConnector",
    label: "Add connector",
    group: "Create",
    icon: "plus",
    shortcut: "C",
    run: () => {
      const ui = useUi.getState();
      const { w, h } = ui.canvasSize;
      const el = document.getElementById("hs-canvas");
      const r = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const last = (window as unknown as { __hsMouse?: { x: number; y: number } }).__hsMouse;
      const screen = last && last.x > r.left && last.y > r.top ? last : { x: r.left + w / 2, y: r.top + h / 2 };
      ui.openPicker({ screen, canvas: screenToCanvas(screen), mode: "place" });
    },
  },
  {
    id: "addNote",
    label: "Add note",
    group: "Create",
    icon: "sticky-note",
    shortcut: "N",
    run: () => {
      const { w, h } = useUi.getState().canvasSize;
      const el = document.getElementById("hs-canvas")?.getBoundingClientRect();
      const p = screenToCanvas({ x: (el?.left ?? 0) + w / 2, y: (el?.top ?? 0) + h / 2 });
      const id = uid();
      dispatch(addNote({ id, position: p, text: "Note" }));
      useUi.getState().select("note", [id]);
    },
  },
  { id: "zoomFit", label: "Zoom to fit", group: "View", icon: "maximize", shortcut: "F", run: () => zoomToFit() },
  { id: "undo", label: "Undo", group: "Edit", icon: "undo", shortcut: "Ctrl+Z", run: () => useProject.getState().undo() },
  { id: "redo", label: "Redo", group: "Edit", icon: "redo", shortcut: "Ctrl+Shift+Z", run: () => useProject.getState().redo() },
  { id: "save", label: "Save .harness.json", group: "File", icon: "download", shortcut: "Ctrl+S", run: () => downloadProject(getProject()) },
  { id: "open", label: "Open .harness.json…", group: "File", icon: "folder-open", shortcut: "Ctrl+O", run: () => void openProjectFile() },
  { id: "projects", label: "Projects & examples…", group: "File", icon: "folder", run: () => useUi.getState().openDialog("open") },
  { id: "import", label: "Import wire list / WireViz…", group: "File", icon: "file-input", run: () => useUi.getState().openDialog("import") },
  { id: "freeze", label: "Freeze revision…", group: "File", icon: "lock", run: () => useUi.getState().openDialog("freeze") },
  { id: "order", label: "Order…", group: "File", icon: "shopping-cart", run: () => useUi.getState().openDialog("order") },
  { id: "palette", label: "Command palette", group: "View", icon: "search", shortcut: "Ctrl+K", run: () => useUi.getState().openDialog("palette") },
  { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", icon: "keyboard", shortcut: "?", run: () => useUi.getState().openDialog("shortcuts") },
  {
    id: "theme",
    label: "Toggle theme",
    group: "View",
    icon: "sun-moon",
    run: () => {
      const ui = useUi.getState();
      ui.setTheme(ui.resolvedTheme === "dark" ? "light" : "dark");
    },
  },
  { id: "shieldView", label: "Shield view", group: "View", icon: "shield", shortcut: "G", run: () => useUi.getState().toggleShieldView() },
  { id: "wireList", label: "Toggle wire list", group: "View", icon: "table", shortcut: "L", run: () => useUi.getState().setDrawer(useUi.getState().drawerHeight > 40 ? 36 : 300) },
  { id: "rightRail", label: "Toggle right rail", group: "View", icon: "panel-right", run: () => useUi.getState().toggleRightRail() },
  { id: "viewDesign", label: "Go to Design", group: "View", shortcut: "1", run: () => useUi.getState().setView("design") },
  { id: "viewBom", label: "Go to BOM", group: "View", shortcut: "2", run: () => useUi.getState().setView("bom") },
  { id: "viewOutputs", label: "Go to Outputs", group: "View", shortcut: "3", run: () => useUi.getState().setView("outputs") },
  { id: "cvdOff", label: "Simulate color vision: off", group: "View", run: () => useUi.getState().setCvd(null) },
  { id: "cvdProtan", label: "Simulate color vision: protanopia", group: "View", run: () => useUi.getState().setCvd("protan") },
  { id: "cvdDeutan", label: "Simulate color vision: deuteranopia", group: "View", run: () => useUi.getState().setCvd("deutan") },
  { id: "cvdTritan", label: "Simulate color vision: tritanopia", group: "View", run: () => useUi.getState().setCvd("tritan") },
  { id: "cvdAchroma", label: "Simulate color vision: achromatopsia", group: "View", run: () => useUi.getState().setCvd("achroma") },
  { id: "rules", label: "Manage rules", group: "Checks", icon: "list-checks", run: () => useUi.getState().openDialog("rules") },
  { id: "dfm", label: "Show all checks", group: "Checks", icon: "clipboard-check", run: () => useUi.getState().openDialog("dfm") },
  { id: "pedigreeEditor", label: "Define pedigrees…", group: "Checks", icon: "badge-check", run: () => useUi.getState().openDialog("pedigreeEditor") },
  { id: "pedigreeCompare", label: "Compare pedigrees", group: "Checks", icon: "columns", run: () => useUi.getState().openDialog("pedigreeCompare") },
  { id: "finish", label: "Finish harness…", group: "Finishing", icon: "sparkles", run: (c) => useUi.getState().openDialog("finish", { segmentIds: c.kind === "segment" ? c.ids : undefined }) },
  { id: "settings", label: "Project settings", group: "File", icon: "settings", run: () => useUi.getState().openDialog("settings") },
  {
    id: "commit",
    label: "Commit connections",
    group: "Connect",
    icon: "git-commit",
    shortcut: "R",
    bar: [],
    run: (c) => dispatch(commitRatsnest(c.kind === "connector" && c.ids.length ? { connectorIds: c.ids } : {})),
  },
  {
    id: "selectAll",
    label: "Select all connectors",
    group: "Edit",
    shortcut: "Ctrl+A",
    run: (c) => useUi.getState().select("connector", c.h.connectors.map((x) => x.id)),
  },
  { id: "copy", label: "Copy", group: "Edit", icon: "copy", shortcut: "Ctrl+C", when: (c) => c.kind === "connector", menu: ["connector"], run: (c) => copySelection(c.ids) },
  { id: "paste", label: "Paste", group: "Edit", icon: "clipboard-paste", shortcut: "Ctrl+V", run: () => void pasteClipboard() },

  // ─── Connector ───────────────────────────────────────────────────────────
  { id: "cPart", label: "Part", group: "Connector", icon: "cpu", bar: ["connector"], menu: ["connector"], when: (c) => c.ids.length === 1, run: (c) => useUi.getState().openPicker({ screen: c.anchor, canvas: screenToCanvas(c.anchor), mode: "replace", connectorId: c.ids[0] }) },
  { id: "cBackshell", label: "Backshell", group: "Connector", icon: "cylinder", bar: ["connector"], menu: ["connector"], when: (c) => c.ids.length === 1, run: (c) => pop("backshell", c) },
  { id: "cAccessories", label: "Accessories", group: "Connector", icon: "package", bar: ["connector"], menu: ["connector"], when: (c) => c.ids.length === 1, run: (c) => pop("accessories", c) },
  { id: "cLabel", label: "Label", group: "Connector", icon: "tag", bar: ["connector", "wire", "segment"], menu: ["connector", "wire", "segment"], run: (c) => pop("label", c) },
  { id: "cPotting", label: "Potting", group: "Connector", icon: "droplet", menu: ["connector"], when: (c) => c.ids.length === 1, run: (c) => useUi.getState().openDialog("potting", { connectorId: c.ids[0] }) },
  {
    id: "cFlip",
    label: "Flip direction",
    group: "Connector",
    icon: "flip-horizontal",
    shortcut: "Shift+R",
    bar: ["connector"],
    menu: ["connector"],
    run: (c) => dispatch(c.ids.map((id) => rotateConnector({ id, rotation: (c.h.connectors.find((x) => x.id === id)!.rotation + 180) % 360 }))),
  },
  {
    id: "cUnused",
    label: "Show/hide unused pins",
    group: "Connector",
    icon: "list",
    menu: ["connector"],
    run: (c) => dispatch(c.ids.map((id) => setConnectorProps({ id, showUnused: !c.h.connectors.find((x) => x.id === id)!.showUnused }))),
  },
  {
    id: "cDuplicate",
    label: "Duplicate",
    group: "Connector",
    icon: "copy-plus",
    shortcut: "Ctrl+D",
    bar: ["connector"],
    menu: ["connector"],
    when: (c) => c.kind === "connector",
    run: (c) => {
      const newIds = c.ids.map(() => uid());
      dispatch(duplicateConnectors({ ids: c.ids, newIds, offset: { x: 60, y: 120 } }));
      useUi.getState().select("connector", newIds);
    },
  },
  { id: "cMore", label: "More…", group: "Connector", icon: "more-horizontal", bar: ["connector", "wire", "segment", "net", "node", "splice"], menu: ["connector", "wire", "segment", "net", "node", "splice"], when: (c) => c.ids.length >= 1, run: (c) => pop("sheet", c) },

  // ─── Wires ───────────────────────────────────────────────────────────────
  { id: "wGauge", label: "Gauge", group: "Wire", icon: "circle-dot", bar: ["wire"], menu: ["wire"], run: (c) => pop("wireProps", c, { ids: c.ids, focus: "gauge" }) },
  { id: "wColor", label: "Color", group: "Wire", icon: "palette", bar: ["wire"], menu: ["wire"], run: (c) => pop("wireProps", c, { ids: c.ids, focus: "color" }) },
  {
    id: "wTwist",
    label: "Twist",
    group: "Wire",
    icon: "waves",
    shortcut: "T",
    bar: ["wire"],
    menu: ["wire"],
    when: (c) => c.kind === "wire" && c.ids.length >= 2 && c.ids.length <= 4,
    run: (c) => dispatch(twistWires({ ids: c.ids, groupId: uid() })),
  },
  {
    id: "wUntwist",
    label: "Untwist",
    group: "Wire",
    icon: "minus",
    menu: ["wire"],
    when: (c) => c.kind === "wire" && c.ids.some((id) => c.h.wires.find((w) => w.id === id)?.twistGroupId),
    run: (c) => dispatch(untwist({ groupIds: [...new Set(c.ids.map((id) => c.h.wires.find((w) => w.id === id)?.twistGroupId).filter(Boolean) as string[])] })),
  },
  { id: "wShield", label: "Shield", group: "Wire", icon: "shield", bar: ["wire"], menu: ["wire"], when: (c) => c.kind === "wire", run: (c) => pop("shield", c) },
  { id: "wCable", label: "Make cable…", group: "Wire", icon: "cable", menu: ["wire"], when: (c) => c.kind === "wire" && c.ids.length >= 1 && c.ids.length <= 8, run: (c) => pop("cable", c) },
  { id: "wReset", label: "Reset to defaults", group: "Wire", icon: "rotate-ccw", menu: ["wire"], run: (c) => dispatch(unpinWireProps({ ids: c.ids, fields: ["spec", "gauge", "color"] })) },

  // ─── Segment / node ──────────────────────────────────────────────────────
  { id: "sLength", label: "Length", group: "Segment", icon: "ruler", bar: ["segment"], menu: ["segment"], when: (c) => c.ids.length === 1, run: (c) => pop("segmentLength", c) },
  { id: "sCovering", label: "Covering", group: "Segment", icon: "layers", bar: ["segment"], menu: ["segment"], run: (c) => pop("covering", c) },
  { id: "sTies", label: "Tie-downs", group: "Segment", icon: "anchor", bar: ["segment"], menu: ["segment"], when: (c) => c.ids.length === 1, run: (c) => pop("tiedowns", c) },
  {
    id: "sBreakout",
    label: "Add breakout",
    group: "Segment",
    icon: "git-branch",
    bar: ["segment"],
    menu: ["segment"],
    when: (c) => c.ids.length === 1,
    run: (c) => {
      const s = c.h.segments.find((x) => x.id === c.ids[0]);
      if (!s) return;
      const a = nodePos(c.h, s.a);
      const b = nodePos(c.h, s.b);
      const nodeId = uid();
      if (dispatch(addBreakout({ segmentId: s.id, t: 0.5, nodeId, position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }), "Add breakout")) {
        useUi.getState().select("node", [nodeId]);
        useUi.getState().toast({ kind: "info", text: "Breakout added. Drag it to move it, drop it on a connector or another breakout to join them, or drag from a bundle to branch off here." });
      }
    },
  },
  {
    id: "sCombine",
    label: "Combine into trunk",
    group: "Segment",
    icon: "git-merge",
    bar: ["segment"],
    menu: ["segment"],
    when: (c) => c.ids.length === 2 && !!sharedNode(c.h, c.ids[0]!, c.ids[1]!),
    run: (c) => {
      const [s1, s2] = c.ids.map((id) => c.h.segments.find((x) => x.id === id)!) as [Harness["segments"][0], Harness["segments"][0]];
      const shared = sharedNode(c.h, s1.id, s2.id)!;
      const far = (s: typeof s1) => nodePos(c.h, s.a === shared ? s.b : s.a);
      const p0 = nodePos(c.h, shared);
      const f1 = far(s1);
      const f2 = far(s2);
      const frac = 0.4;
      const trunkMm = Math.max(5, Math.round((Math.min(s1.lengthMm, s2.lengthMm) * frac) / 5) * 5);
      const position = { x: p0.x + ((f1.x + f2.x) / 2 - p0.x) * frac, y: p0.y + ((f1.y + f2.y) / 2 - p0.y) * frac };
      const nodeId = uid();
      if (dispatch(combineSegments({ segmentIds: [s1.id, s2.id], nodeId, trunkMm, position }), "Combine into trunk")) {
        useUi.getState().select("node", [nodeId]);
        useUi.getState().toast({ kind: "info", text: `Combined into a common trunk (${trunkMm} mm, taken out of both branches so wire lengths are kept). Click the trunk's length to set it.` });
      }
    },
  },
  { id: "nBoot", label: "Boot / transition", group: "Node", icon: "triangle", bar: ["node"], menu: ["node", "connector"], when: (c) => c.ids.length === 1, run: (c) => pop("boot", c) },
  { id: "nTerm", label: "Terminations", group: "Node", icon: "circle-slash", menu: ["node", "connector"], when: (c) => c.ids.length === 1, run: (c) => pop("terminations", c) },

  // ─── Net ─────────────────────────────────────────────────────────────────
  { id: "netEdit", label: "Rename / class / topology", group: "Net", icon: "pencil", bar: ["net"], menu: ["net", "wire"], run: (c) => pop("net", c, { ids: c.kind === "wire" ? [...new Set(c.ids.map((id) => c.h.wires.find((w) => w.id === id)?.netId).filter(Boolean))] : c.ids }) },
  { id: "spliceEdit", label: "Splice type & cover", group: "Splice", icon: "diamond", bar: ["splice"], menu: ["splice"], run: (c) => pop("splice", c) },

  // ─── Delete ──────────────────────────────────────────────────────────────
  {
    id: "delete",
    label: "Delete",
    group: "Edit",
    icon: "trash-2",
    shortcut: "Del",
    danger: true,
    bar: ["connector", "wire", "segment", "node", "label", "note", "layer", "clamp", "boot", "hardware"],
    menu: ["connector", "wire", "segment", "node", "label", "note", "layer", "clamp", "boot", "hardware", "net"],
    when: (c) => !!c.kind && c.ids.length > 0,
    run: (c) => {
      const map: Partial<Record<SelKind, () => void>> = {
        connector: () => dispatch(deleteConnectors({ ids: c.ids })),
        wire: () => dispatch(deleteWires({ ids: c.ids })),
        segment: () => dispatch(deleteSegments({ ids: c.ids })),
        node: () => dispatch(deleteNodes({ ids: c.ids })),
        label: () => dispatch(removeLabels({ ids: c.ids })),
        note: () => dispatch(deleteNotes({ ids: c.ids })),
        layer: () => dispatch(removeLayers({ ids: c.ids })),
        clamp: () => dispatch(removeClamps({ ids: c.ids })),
        boot: () => dispatch(removeBoots({ ids: c.ids })),
        hardware: () => dispatch(removeHardware({ ids: c.ids })),
        net: () => dispatch({ type: "deleteNets", payload: { ids: c.ids } }),
      };
      map[c.kind!]?.();
      useUi.getState().clearSelection();
    },
  },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function actionCtx(anchor?: { x: number; y: number }): ActionCtx {
  const ui = useUi.getState();
  const p = getProject();
  return { kind: ui.selection.kind, ids: ui.selection.ids, h: currentHarness(p), anchor: anchor ?? ui.contextMenu?.screen ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 } };
}

export function runAction(id: string, anchor?: { x: number; y: number }) {
  const a = ACTION_BY_ID.get(id);
  if (!a) return;
  const c = actionCtx(anchor);
  if (a.when && !a.when(c)) return;
  a.run(c);
}

export function isFrozen() {
  return currentRevision(getProject()).frozen;
}
