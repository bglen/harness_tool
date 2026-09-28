import { currentRevision, formatMass, formatTotalLength } from "@hs/model";
import { useProject } from "../store/project";
import { activePedigreeOf, useActiveAnalysis, useDerived } from "../store/analysis";
import { useUi } from "../store/ui";
import { SeverityIcon } from "../ui/primitives";
import { PedigreePill } from "./TopBar";

/** Live counts, total wire length, estimated weight, DFM tally (§3). */
export function StatusBar() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const h = rev.harness;
  const d = useDerived();
  const a = useActiveAnalysis();
  const ui = useUi();
  const errors = a ? a.dfm.manufacturability.errors + a.dfm.design.errors : 0;
  const warns = a ? a.dfm.manufacturability.warnings + a.dfm.design.warnings : 0;
  return (
    <footer className="tnum flex h-7 shrink-0 items-center gap-3 border-t border-border-subtle bg-bg-app px-3 text-xs text-text-secondary" role="contentinfo">
      <span>
        {h.connectors.length} connector{h.connectors.length === 1 ? "" : "s"} · {h.wires.length} wires · {h.nets.length} nets · {formatTotalLength(d.totalWireMm, project.units)} wire · est. {a ? formatMass(a.massG) : "—"}
      </span>
      <button className="flex items-center gap-1 hover:text-text-primary" onClick={() => ui.openDialog("dfm")} aria-label={`${errors} errors, ${warns} warnings: open checks`}>
        <SeverityIcon severity={errors ? "error" : "pass"} size={12} /> {errors} errors
        <SeverityIcon severity="warning" size={12} /> {warns} warn
      </button>
      {a && <span className="text-text-tertiary">DFM {Math.round(a.ms)}&thinsp;ms</span>}
      <div className="flex-1" />
      <span className="text-text-tertiary">Units: {project.units === "in" ? "inches" : "mm"}</span>
      <PedigreePill id={activePedigreeOf(project)} className="py-0 text-2xs" />
      <span className="text-text-tertiary">Phase 1: designs stay in this browser; nothing is uploaded</span>
    </footer>
  );
}
