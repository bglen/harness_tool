import { ProjectSchema, stableStringify, type Project } from "@hs/model";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";

export function downloadBlob(name: string, data: Blob | string, type = "application/json") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(s: string) {
  return s.replace(/[^\w.+-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "harness";
}

export function projectJson(p: Project): string {
  return stableStringify(p, 2) + "\n";
}

/** Ctrl+S downloads the native file (§4.3). */
export function downloadProject(p: Project) {
  const rev = p.revisions.find((r) => r.id === p.currentRevisionId)!;
  downloadBlob(`${safeName(p.partNumber)}_Rev${rev.label}.harness.json`, projectJson(p));
  useUi.getState().toast({ kind: "success", text: "Design saved as .harness.json" });
}

/** Validate a native file with Zod on load (§4.3). */
export function parseProjectText(text: string): Project {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file");
  }
  const r = ProjectSchema.safeParse(json);
  if (!r.success) throw new Error(`Invalid .harness.json: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export async function openFile(file: File) {
  try {
    const p = parseProjectText(await file.text());
    useProject.getState().init(p);
    useUi.getState().clearSelection();
    useUi.getState().toast({ kind: "success", text: `Opened ${p.name}` });
    setTimeout(() => import("./viewport").then((m) => m.zoomToFit()), 50);
  } catch (e) {
    useUi.getState().toast({ kind: "error", text: (e as Error).message });
  }
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}

export async function openProjectFile() {
  const f = await pickFile(".json,.harness.json,application/json");
  if (f) await openFile(f);
}
