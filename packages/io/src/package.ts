import JSZip from "jszip";
import { sha256Hex, stableStringify } from "@hs/model";

export interface PackageFile {
  path: string;
  data: string | Uint8Array;
}

export interface Manifest {
  schemaVersion: 1;
  package: string;
  generatedAt: string;
  generatedBy: string;
  designHash: string;
  project: { name: string; partNumber: string; revision: string; frozen: boolean };
  pedigree: { id: string; name: string; code: string; schemeVersion: string };
  versions: { tool: string; machineProfile: string; catalog: string; rulesets: { id: string; name: string; version: string }[] };
  demoPricing: boolean;
  files: { path: string; bytes: number; sha256: string }[];
}

/** Assemble the output package ZIP with a manifest of SHA-256 hashes (§13.3). */
export async function buildZip(root: string, files: PackageFile[], manifest: Omit<Manifest, "files">, fixedDate?: Date): Promise<{ zip: Uint8Array; manifest: Manifest }> {
  const entries: Manifest["files"] = [];
  const zip = new JSZip();
  const date = fixedDate ?? new Date(manifest.generatedAt);
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const bytes = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
    entries.push({ path: f.path, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
    zip.file(`${root}/${f.path}`, bytes, { date, binary: true });
  }
  const full: Manifest = { ...manifest, files: entries };
  zip.file(`${root}/manifest.json`, stableStringify(full, 2) + "\n", { date });
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { zip: out, manifest: full };
}

/** Verify a package's files against its manifest (acceptance #10). */
export async function verifyZip(data: Uint8Array | ArrayBuffer): Promise<{ ok: boolean; problems: string[]; manifest?: Manifest }> {
  const zip = await JSZip.loadAsync(data);
  const mf = Object.keys(zip.files).find((p) => p.endsWith("/manifest.json"));
  if (!mf) return { ok: false, problems: ["manifest.json missing"] };
  const root = mf.slice(0, -"manifest.json".length);
  const manifest = JSON.parse(await zip.file(mf)!.async("string")) as Manifest;
  const problems: string[] = [];
  for (const f of manifest.files) {
    const file = zip.file(root + f.path);
    if (!file) {
      problems.push(`${f.path}: missing`);
      continue;
    }
    const bytes = await file.async("uint8array");
    const h = await sha256Hex(bytes);
    if (h !== f.sha256) problems.push(`${f.path}: hash mismatch`);
  }
  return { ok: !problems.length, problems, manifest };
}
