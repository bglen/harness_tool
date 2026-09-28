import { create } from "zustand";
import { applyBatch, applyCommand, applyPatches, currentRevision, FrozenRevisionError, type Command, type Harness, type Project, type Revision } from "@hs/model";
import type { Patch } from "immer";
import { svc } from "../lib/services";
import { useUi } from "./ui";

interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
  label: string;
}

type SaveState = "saved" | "saving" | "unsaved" | "error";

interface ProjectState {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  saveState: SaveState;
  lastChange: { label: string; at: number } | null;
  init(p: Project): void;
  /** merge: fold this change into the previous undo step (multi-stage operations such as import). */
  dispatch(cmd: Command | Command[], label?: string, opts?: { merge?: boolean }): boolean;
  undo(): void;
  redo(): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => ProjectState, set: (s: Partial<ProjectState>) => void) {
  set({ saveState: "unsaved" });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const p = get().project;
    if (!p) return;
    set({ saveState: "saving" });
    try {
      await svc().store.save(p);
      await svc().store.setLastOpened(p.id);
      set({ saveState: "saved" });
    } catch {
      set({ saveState: "error" });
    }
  }, 1000); // autosave debounced 1 s (§4.3)
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  saveState: "saved",
  lastChange: null,
  init(p) {
    set({ project: p, past: [], future: [], saveState: "saved", lastChange: null });
    void svc().store.save(p);
    void svc().store.setLastOpened(p.id);
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
      return true;
    } catch (e) {
      if (e instanceof FrozenRevisionError) useUi.getState().toast({ kind: "info", text: e.message, action: { label: "New revision", run: () => useUi.getState().openDialog("freeze") } });
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
