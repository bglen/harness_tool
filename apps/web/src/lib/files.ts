import { safeParseProject, stableStringify, validateProject, type Diagnostic, type Project } from "@hs/model";
import { svc } from "./services";
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

/** Files larger than this are refused before parsing (feedback §10: size/schema limits). */
export const MAX_PROJECT_BYTES = 50_000_000;

/**
 * Validate a native file on load (§4.3): explicit schema migration, Zod shape checks, then semantic validation.
 * Problems are reported, never silently repaired or discarded.
 */
export function parseProjectText(text: string): { project: Project; notes: string[]; diagnostics: Diagnostic[] } {
  if (text.length > MAX_PROJECT_BYTES) throw new Error(`File is larger than ${MAX_PROJECT_BYTES / 1e6} MB`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file");
  }
  const r = safeParseProject(json);
  if (!r.ok) throw new Error(`Can't open this .harness.json: ${r.error}`);
  return { project: r.project, notes: r.notes, diagnostics: validateProject(r.project, svc().cat) };
}

export async function openFile(file: File) {
  try {
    const { project: p, notes, diagnostics } = parseProjectText(await file.text());
    useProject.getState().init(p);
    useUi.getState().clearSelection();
    const errs = diagnostics.filter((d) => d.severity === "error");
    const lines = [...notes, ...diagnostics.map((d) => `${d.severity === "error" ? "Error" : "Warning"} · ${d.where}: ${d.message}`)];
    if (lines.length) useUi.getState().toast({ kind: errs.length ? "error" : "info", text: `Opened ${p.name} with ${lines.length} note${lines.length > 1 ? "s" : ""}${errs.length ? ` (${errs.length} error${errs.length > 1 ? "s" : ""}): nothing was changed; the first edit will report any repairs` : ""}.`, detail: ["", ...lines] });
    else useUi.getState().toast({ kind: "success", text: `Opened ${p.name}` });
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
