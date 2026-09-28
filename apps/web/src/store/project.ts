import { create } from "zustand";
import { applyBatch, applyCommand, applyPatches, CommandRejectedError, currentRevision, FrozenRevisionError, type Command, type Harness, type Project, type Revision } from "@hs/model";
import type { Patch } from "immer";
import { svc } from "../lib/services";
import { useUi } from "./ui";

interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
  label: string;
}

/**
 * Persistence state (feedback §6/§7). "saved" means the CURRENT edit generation is in this browser's storage;
 * nothing leaves the device in Phase 1.
 */
type SaveState = "saved" | "saving" | "unsaved" | "error" | "conflict";

interface ProjectState {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  saveState: SaveState;
  saveError?: string;
  /** Another tab saved this project after we loaded it. */
  conflict?: { updated: string };
  /** Increments on every change; a save only counts if it wrote this generation. */
  generation: number;
  savedGeneration: number;
  lastChange: { label: string; at: number } | null;
  init(p: Project): void;
  /** merge: fold this change into the previous undo step (multi-stage operations such as import). */
  dispatch(cmd: Command | Command[], label?: string, opts?: { merge?: boolean }): boolean;
  undo(): void;
  redo(): void;
  saveNow(opts?: { force?: boolean }): Promise<void>;
  reloadFromStorage(): Promise<void>;
}

const TAB_ID = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
const channel: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("harness-studio-projects") : null;
/** `updated` stamp of the stored copy we last loaded or wrote; a newer stored stamp means another tab wrote it. */
let baseUpdated = "";

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => ProjectState, set: (s: Partial<ProjectState>) => void) {
  set({ saveState: get().conflict ? "conflict" : "unsaved", generation: get().generation + 1 });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void get().saveNow(), 1000); // autosave debounced 1 s (§4.3)
}

function describeSaveError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "QuotaExceededError") return "Browser storage is full. Download the design (Ctrl+S) and free space.";
  if (name === "InvalidStateError" || name === "UnknownError") return "Browser storage is unavailable (private window or blocked site data). Download the design (Ctrl+S) to keep it.";
  return (e as Error)?.message || "Unknown storage error";
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  saveState: "saved",
  generation: 0,
  savedGeneration: 0,
  lastChange: null,
  init(p) {
    baseUpdated = p.updated;
    set({ project: p, past: [], future: [], saveState: "unsaved", saveError: undefined, conflict: undefined, lastChange: null, generation: 1, savedGeneration: 0 });
    void get().saveNow();
  },
  async saveNow(opts) {
    const p = get().project;
    if (!p) return;
    const gen = get().generation;
    if (get().conflict && !opts?.force) {
      set({ saveState: "conflict" });
      return;
    }
    set({ saveState: "saving" });
    try {
      const store = svc().store;
      // Multi-tab safety: refuse to overwrite a copy another tab wrote after we loaded ours.
      if (!opts?.force) {
        const stored = await store.load(p.id).catch(() => undefined);
        if (stored && baseUpdated && stored.updated > baseUpdated && stored.updated !== p.updated) {
          set({ saveState: "conflict", conflict: { updated: stored.updated } });
          return;
        }
      }
      await store.save(p);
      await store.setLastOpened(p.id);
      baseUpdated = p.updated;
      channel?.postMessage({ type: "saved", id: p.id, updated: p.updated, tab: TAB_ID });
      if (get().project?.id !== p.id) return;
      const done = get().generation === gen;
      set({ savedGeneration: gen, saveState: done ? "saved" : "unsaved", saveError: undefined, ...(opts?.force ? { conflict: undefined } : {}) });
    } catch (e) {
      set({ saveState: "error", saveError: describeSaveError(e) });
    }
  },
  async reloadFromStorage() {
    const p = get().project;
    if (!p) return;
    const stored = await svc().store.load(p.id);
    if (stored) {
      baseUpdated = stored.updated;
      set({ project: stored, past: [], future: [], saveState: "saved", conflict: undefined, generation: get().generation + 1, savedGeneration: get().generation + 1 });
    }
  },
  dispatch(cmd, label, opts) {
    const p = get().project;
    if (!p) return false;
    try {
      const ctx = { cat: svc().cat };
      const r = Array.isArray(cmd) ? applyBatch(p, cmd, ctx, label) : applyCommand(p, cmd, ctx);
      if (!r.patches.length) return true;
      const past = get().past;
      const prev = past[past.length - 1];
      const entry = opts?.merge && prev ? { patches: [...prev.patches, ...r.patches], inverse: [...r.inverse, ...prev.inverse], label: prev.label } : { patches: r.patches, inverse: r.inverse, label: label ?? r.label };
      set({ project: r.project, past: [...(opts?.merge && prev ? past.slice(0, -1) : past), entry].slice(-500), future: [], lastChange: { label: entry.label, at: Date.now() } });
      scheduleSave(get, set);
      // Side effects beyond the command itself are always reported (feedback: no silent repairs).
      if (r.repairs.length) {
        const uniq = [...new Set(r.repairs)];
        useUi.getState().toast({ kind: "info", text: uniq.length === 1 ? uniq[0]! : `${uniq[0]} (+${uniq.length - 1} more)`, detail: uniq.length > 1 ? uniq : undefined });
      }
      return true;
    } catch (e) {
      if (e instanceof FrozenRevisionError) useUi.getState().toast({ kind: "info", text: e.message, action: { label: "New revision", run: () => useUi.getState().openDialog("freeze") } });
      else if (e instanceof CommandRejectedError) useUi.getState().toast({ kind: "error", text: e.message });
      else {
        console.error(e);
        useUi.getState().toast({ kind: "error", text: `Couldn't apply: ${(e as Error).message}` });
      }
      return false;
    }
  },
  undo() {
    const { past, future, project } = get();
    const e = past[past.length - 1];
    if (!e || !project) return;
    set({ project: applyPatches(project, e.inverse), past: past.slice(0, -1), future: [e, ...future], lastChange: { label: `Undo ${e.label}`, at: Date.now() } });
    scheduleSave(get, set);
  },
  redo() {
    const { past, future, project } = get();
    const e = future[0];
    if (!e || !project) return;
    set({ project: applyPatches(project, e.patches), past: [...past, e], future: future.slice(1), lastChange: { label: e.label, at: Date.now() } });
    scheduleSave(get, set);
  },
}));

channel?.addEventListener("message", (ev: MessageEvent<{ type: string; id: string; updated: string; tab: string }>) => {
  const m = ev.data;
  const st = useProject.getState();
  if (m.type !== "saved" || m.tab === TAB_ID || !st.project || m.id !== st.project.id) return;
  if (m.updated === st.project.updated) return;
  useProject.setState({ conflict: { updated: m.updated }, saveState: "conflict" });
});

// Warn before closing with an unsaved generation (interrupted saves).
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (e) => {
    const s = useProject.getState();
    if (s.project && (s.saveState === "unsaved" || s.saveState === "saving" || s.saveState === "error" || s.saveState === "conflict")) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

export function useCurrentRevision(): Revision {
  return useProject((s) => currentRevision(s.project!));
}

export function useHarness(): Harness {
  return useProject((s) => currentRevision(s.project!).harness);
}

export function dispatch(cmd: Command | Command[], label?: string, opts?: { merge?: boolean }) {
  return useProject.getState().dispatch(cmd, label, opts);
}

export function getProject(): Project {
  return useProject.getState().project!;
}

export function getHarness(): Harness {
  return currentRevision(getProject()).harness;
}
