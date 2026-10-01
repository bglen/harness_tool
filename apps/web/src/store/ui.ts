import { create } from "zustand";
import type { CvdType } from "@hs/ui-tokens";

export type SelKind = "connector" | "wire" | "net" | "segment" | "node" | "pin" | "label" | "layer" | "splice" | "note" | "shield" | "clamp" | "boot" | "hardware";

/** Design canvas mode: the schematic (pins, nets, wires) or the physical bundle layout (routing, branching, coverings). */
export type CanvasMode = "schematic" | "bundles";

/** Selection kinds that only exist on the bundle layout (hidden in the schematic). */
export const BUNDLE_KINDS: SelKind[] = ["segment", "node", "label", "clamp", "boot", "hardware"];
/** Selection kinds that only exist on the schematic (pins aren't drawn on the bundle layout). */
export const SCHEMATIC_KINDS: SelKind[] = ["pin"];

export interface Selection {
  kind: SelKind | null;
  ids: string[];
}

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export type DialogId = "palette" | "settings" | "rules" | "pedigreeEditor" | "pedigreeCompare" | "import" | "order" | "finish" | "dfm" | "freeze" | "mate" | "open" | "shortcuts" | "potting" | "templateEditor";

export interface PickerState {
  screen: { x: number; y: number };
  canvas: { x: number; y: number };
  mode: "place" | "fromPin" | "replace";
  fromPins?: { connectorId: string; cavityId: string }[];
  connectorId?: string;
  /** Open centred on `screen` (toolbar +) instead of beside it. */
  centered?: boolean;
}

export interface PopoverState {
  kind: string;
  screen: { x: number; y: number };
  data?: any;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
  action?: { label: string; run: () => void };
  /** Extra lines shown under the text (e.g. every repair a command made). */
  detail?: string[];
}

type Theme = "dark" | "light" | "system";

const LS = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`hs.${k}`);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`hs.${k}`, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

interface UiState {
  view: "design" | "bom" | "outputs";
  canvasMode: CanvasMode;
  selection: Selection;
  hover: { kind: SelKind; id: string } | null;
  viewport: Viewport;
  theme: Theme;
  resolvedTheme: "dark" | "light";
  rightRail: boolean;
  drawerHeight: number;
  drawerTab: "wires" | "nets" | "connectors";
  picker: PickerState | null;
  popover: PopoverState | null;
  contextMenu: { screen: { x: number; y: number } } | null;
  dialogs: Partial<Record<DialogId, any>>;
  shieldView: boolean;
  /** Active canvas tool: "breakout" = next click on a bundle inserts a breakout there. */
  tool: "breakout" | null;
  /** Signed-in engineer (Phase 1: a local mock identity; accounts arrive with Phase 2). */
  userName: string;
  setUserName(n: string): void;
  cvd: CvdType | null;
  wireColorLabels: "detail" | "always" | "hover";
  colorblindAssist: boolean;
  hintsSeen: string[];
  toasts: Toast[];
  editing: { connectorId: string; cavityId: string; col: "signal" } | null;
  focusNetId: string | null;
  canvasSize: { w: number; h: number };
  dfmFilter: string | null;
  flash: { ids: string[]; at: number } | null;
  setView(v: UiState["view"]): void;
  setCanvasMode(m: CanvasMode): void;
  toggleCanvasMode(): void;
  select(kind: SelKind | null, ids: string[], additive?: boolean): void;
  clearSelection(): void;
  setHover(h: UiState["hover"]): void;
  setViewport(v: Viewport): void;
  setTheme(t: Theme): void;
  toggleRightRail(): void;
  setDrawer(h: number, tab?: UiState["drawerTab"]): void;
  openPicker(p: PickerState | null): void;
  openPopover(p: PopoverState | null): void;
  openContextMenu(c: UiState["contextMenu"]): void;
  openDialog(d: DialogId, data?: any): void;
  closeDialog(d: DialogId): void;
  toggleShieldView(): void;
  setTool(t: UiState["tool"]): void;
  setCvd(c: CvdType | null): void;
  setWireColorLabels(v: UiState["wireColorLabels"]): void;
  setColorblindAssist(v: boolean): void;
  markHint(id: string): void;
  toast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
  setEditing(e: UiState["editing"]): void;
  setFocusNet(id: string | null): void;
  setCanvasSize(s: { w: number; h: number }): void;
  setDfmFilter(f: string | null): void;
  flashObjects(ids: string[]): void;
}

function resolve(t: Theme): "dark" | "light" {
  if (t === "system") return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return t;
}

let toastId = 1;

export const useUi = create<UiState>((set, get) => ({
  view: "design",
  canvasMode: "schematic",
  selection: { kind: null, ids: [] },
  hover: null,
  viewport: { x: 0, y: 0, k: 1 },
  theme: LS.get<Theme>("theme", "dark"),
  resolvedTheme: resolve(LS.get<Theme>("theme", "dark")),
  rightRail: LS.get("rightRail", true),
  drawerHeight: 36,
  drawerTab: "wires",
  picker: null,
  popover: null,
  contextMenu: null,
  dialogs: {},
  shieldView: false,
  tool: null,
  userName: LS.get("userName", "Demo Engineer"),
  setUserName(n) {
    LS.set("userName", n);
    set({ userName: n });
  },
  cvd: null,
  wireColorLabels: LS.get("wireColorLabels", "detail"),
  colorblindAssist: LS.get("colorblindAssist", false),
  hintsSeen: LS.get<string[]>("hints", []),
  toasts: [],
  editing: null,
  focusNetId: null,
  canvasSize: { w: 1000, h: 700 },
  dfmFilter: null,
  flash: null,
  setView: (view) => set({ view, popover: null, picker: null }),
  setCanvasMode(canvasMode) {
    const s = get();
    if (s.canvasMode === canvasMode) return;
    // Drop a selection the other mode can't show (bundles aren't drawn on the schematic, pins aren't on the bundle layout).
    const hidden = canvasMode === "schematic" ? BUNDLE_KINDS : SCHEMATIC_KINDS;
    const keep = !s.selection.kind || !hidden.includes(s.selection.kind);
    set({
      canvasMode,
      popover: null,
      picker: null,
      contextMenu: null,
      editing: null,
      tool: canvasMode === "schematic" ? null : s.tool,
      ...(keep ? {} : { selection: { kind: null, ids: [] } }),
    });
  },
  toggleCanvasMode() {
    get().setCanvasMode(get().canvasMode === "schematic" ? "bundles" : "schematic");
  },
  select(kind, ids, additive) {
    // Cross-probing (checks panel, wire list, BOM) to something only one canvas mode draws brings that mode up.
    if (kind && ids.length) {
      const mode = get().canvasMode;
      if (mode === "schematic" && BUNDLE_KINDS.includes(kind)) set({ canvasMode: "bundles" });
      if (mode === "bundles" && SCHEMATIC_KINDS.includes(kind)) set({ canvasMode: "schematic", tool: null });
    }
    const cur = get().selection;
    if (additive && kind && cur.kind === kind) {
      const s = new Set(cur.ids);
      for (const id of ids) s.has(id) ? s.delete(id) : s.add(id);
      set({ selection: { kind: s.size ? kind : null, ids: [...s] }, popover: null });
    } else set({ selection: { kind: ids.length ? kind : null, ids }, popover: null });
  },
  clearSelection: () => set({ selection: { kind: null, ids: [] }, popover: null, focusNetId: null }),
  setHover: (hover) => set({ hover }),
  setViewport: (viewport) => set({ viewport }),
  setTheme(theme) {
    LS.set("theme", theme);
    const r = resolve(theme);
    document.documentElement.dataset.theme = r;
    set({ theme, resolvedTheme: r });
  },
  toggleRightRail() {
    LS.set("rightRail", !get().rightRail);
    set({ rightRail: !get().rightRail });
  },
  setDrawer: (drawerHeight, tab) => set({ drawerHeight, ...(tab ? { drawerTab: tab } : {}) }),
  openPicker: (picker) => set({ picker, popover: null, contextMenu: null }),
  openPopover: (popover) => set({ popover, contextMenu: null }),
  openContextMenu: (contextMenu) => set({ contextMenu, popover: null }),
  openDialog: (d, data = true) => set({ dialogs: { ...get().dialogs, [d]: data }, contextMenu: null, popover: null }),
  closeDialog(d) {
    const x = { ...get().dialogs };
    delete x[d];
    set({ dialogs: x });
  },
  toggleShieldView: () => set({ shieldView: !get().shieldView }),
  // The breakout tool works on bundles, so it brings up the bundle layout.
  setTool(tool) {
    if (tool) get().setCanvasMode("bundles");
    set({ tool });
  },
  setCvd: (cvd) => set({ cvd }),
  setWireColorLabels(v) {
    LS.set("wireColorLabels", v);
    set({ wireColorLabels: v });
  },
  setColorblindAssist(v) {
    LS.set("colorblindAssist", v);
    set({ colorblindAssist: v });
    if (v) get().setWireColorLabels("always");
  },
  markHint(id) {
    if (get().hintsSeen.includes(id)) return;
    const h = [...get().hintsSeen, id];
    LS.set("hints", h);
    set({ hintsSeen: h });
  },
  toast(t) {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismissToast(id), t.action || t.detail ? 8000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setEditing: (editing) => set({ editing }),
  setFocusNet: (focusNetId) => set({ focusNetId }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setDfmFilter: (dfmFilter) => set({ dfmFilter }),
  flashObjects: (ids) => set({ flash: { ids, at: Date.now() } }),
}));

export const storage = LS;
