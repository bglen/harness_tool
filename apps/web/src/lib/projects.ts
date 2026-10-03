import { newProject, parseProject, type PedigreeScheme } from "@hs/model";
import { getOrgScheme } from "./orgScheme";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";
import { svc } from "./services";
import { zoomToFit } from "./viewport";

export async function openExample(id: string) {
  const raw = await svc().catalog.example(id);
  const p = parseProject(raw);
  // Give each opened example a fresh id so edits don't overwrite the template in local storage
  const fresh = { ...p, id: globalThis.crypto.randomUUID(), created: new Date().toISOString(), updated: new Date().toISOString() };
  useProject.getState().init(fresh);
  useUi.getState().clearSelection();
  useUi.getState().setView("design");
  setTimeout(zoomToFit, 60);
}

/** New design: on the given scheme, else the organization's (this browser), else the built-in Standard; starts on the scheme's default pedigree. */
export function createNewProject(scheme?: PedigreeScheme) {
  const p = newProject({ units: "in", scheme: scheme ?? getOrgScheme() ?? undefined });
  p.catalogVersion = svc().cat.version.hash;
  useProject.getState().init(p);
  useUi.getState().clearSelection();
  useUi.getState().setView("design");
}
