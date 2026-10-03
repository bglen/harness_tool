import { PedigreeSchemeSchema, type PedigreeScheme } from "@hs/model";

/**
 * The organization's pedigree scheme (with its default pedigree), which new designs start from. Phase 1 mocks the
 * organization with this browser's storage; a real deployment would serve it from the team's rules library.
 */
const KEY = "hs.orgPedigreeScheme";

export function getOrgScheme(): PedigreeScheme | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = PedigreeSchemeSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function setOrgScheme(scheme: PedigreeScheme | null): void {
  try {
    if (scheme) localStorage.setItem(KEY, JSON.stringify(scheme));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable (private window): new designs fall back to the built-in Standard scheme
  }
}
