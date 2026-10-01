import { create } from "zustand";
import { BUILTIN_TEMPLATES, isBuiltinTemplate, MAX_TEMPLATE_BYTES, parseDrawingTemplate, stableStringify, uid, type DrawingTemplate, type Logo } from "@hs/model";
import { LocalTemplateStore } from "@hs/providers";
import { useUi } from "../store/ui";
import { downloadBlob, pickFile, safeName } from "./files";

const store = new LocalTemplateStore();

interface TemplateLib {
  /** User templates saved in this browser (built-ins are not stored). */
  library: DrawingTemplate[];
  loaded: boolean;
  load(): Promise<void>;
  save(t: DrawingTemplate): Promise<DrawingTemplate>;
  remove(id: string): Promise<void>;
}

export const useTemplates = create<TemplateLib>((set, get) => ({
  library: [],
  loaded: false,
  async load() {
    try {
      const { templates, problems } = await store.list();
      set({ library: templates, loaded: true });
      if (problems.length) useUi.getState().toast({ kind: "error", text: `${problems.length} saved drawing template${problems.length > 1 ? "s" : ""} couldn't be read and ${problems.length > 1 ? "were" : "was"} skipped.`, detail: problems });
    } catch (e) {
      set({ loaded: true });
      useUi.getState().toast({ kind: "error", text: `Template library unavailable: ${(e as Error).message}` });
    }
  },
  async save(t) {
    // Built-ins are read-only: saving one stores an editable copy.
    const out: DrawingTemplate = isBuiltinTemplate(t.id) ? { ...t, id: uid(), name: `${t.name} (copy)` } : t;
    const stamped = { ...out, updated: new Date().toISOString() };
    await store.save(stamped);
    set({ library: [...get().library.filter((x) => x.id !== stamped.id), stamped].sort((a, b) => a.name.localeCompare(b.name)) });
    return stamped;
  },
  async remove(id) {
    await store.remove(id);
    set({ library: get().library.filter((x) => x.id !== id) });
  },
}));

/** Built-ins first, then the library. */
export function allTemplates(): DrawingTemplate[] {
  return [...BUILTIN_TEMPLATES, ...useTemplates.getState().library];
}

export function templateFileName(t: DrawingTemplate) {
  return `${safeName(t.name)}.harnesstemplate.json`;
}

export function exportTemplate(t: DrawingTemplate) {
  downloadBlob(templateFileName(t), stableStringify(t, 2) + "\n");
}

/** Validate a template file's text (size, JSON, schema). */
export function parseTemplateText(text: string): DrawingTemplate {
  if (text.length > MAX_TEMPLATE_BYTES) throw new Error(`Template file is larger than ${MAX_TEMPLATE_BYTES / 1e6} MB`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file");
  }
  const r = parseDrawingTemplate(json);
  if (!r.ok) throw new Error(`Can't use this template: ${r.error}`);
  return r.template;
}

/** Pick a .harnesstemplate.json and add it to the library. An id that's already taken gets a fresh one (nothing is overwritten). */
export async function importTemplateFile(file?: File): Promise<DrawingTemplate | undefined> {
  const f = file ?? (await pickFile(".json,.harnesstemplate.json,application/json"));
  if (!f) return undefined;
  try {
    let t = parseTemplateText(await f.text());
    const lib = useTemplates.getState();
    if (!lib.loaded) await lib.load();
    if (isBuiltinTemplate(t.id) || useTemplates.getState().library.some((x) => x.id === t.id)) t = { ...t, id: uid(), name: `${t.name} (imported)` };
    const saved = await useTemplates.getState().save(t);
    useUi.getState().toast({ kind: "success", text: `Imported drawing template “${saved.name}”` });
    return saved;
  } catch (e) {
    useUi.getState().toast({ kind: "error", text: (e as Error).message });
    return undefined;
  }
}

/** Largest logo edge kept (px); bigger images are scaled down so templates stay small. */
const LOGO_MAX_PX = 1200;

/** Read an image file (PNG, JPEG or SVG) into a PNG data URL for the template (PDFs can't embed SVG images). */
export async function logoFromFile(file: File): Promise<Logo> {
  if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type) && !/\.(png|jpe?g|svg)$/i.test(file.name)) throw new Error("Logo must be a PNG, JPEG or SVG image");
  if (file.size > 8_000_000) throw new Error("Logo image is larger than 8 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image"));
      i.src = url;
    });
    let w = img.naturalWidth || 600;
    let h = img.naturalHeight || 200;
    const k = Math.min(1, LOGO_MAX_PX / Math.max(w, h));
    // SVGs without intrinsic size render small; give them a print-friendly resolution.
    const up = /svg/i.test(file.type) || /\.svg$/i.test(file.name) ? Math.max(1, 800 / Math.max(w, h)) : 1;
    w = Math.round(w * k * up);
    h = Math.round(h * k * up);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}
