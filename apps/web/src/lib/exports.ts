import { currentRevision } from "@hs/model";
import { bomFor, bomTable, dfmTable, exportWireViz, pinoutTable, toCsv, toXlsx, wireListTable } from "@hs/io";
import { exportProjectRuleset } from "@hs/dfm";
import { getProject } from "../store/project";
import { useAnalysis } from "../store/analysis";
import { useUi } from "../store/ui";
import { svc } from "./services";
import { downloadBlob, downloadProject, safeName } from "./files";
import { exportCanvasPng, exportCanvasSvg } from "./canvasExport";

export interface ExportItem {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

function base() {
  const p = getProject();
  const rev = currentRevision(p);
  return `${safeName(p.partNumber)}_Rev${rev.label}`;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function withToast(label: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    useUi.getState().toast({ kind: "success", text: `${label} exported` });
  } catch (e) {
    console.error(e);
    useUi.getState().toast({ kind: "error", text: `${label} failed: ${(e as Error).message}` });
  }
}

export const EXPORTS: (ExportItem | "-")[] = [
  { id: "json", label: "Design (.harness.json)", shortcut: "Ctrl+S", run: () => downloadProject(getProject()) },
  "-",
  { id: "wlcsv", label: "Wire list (CSV)", run: () => withToast("Wire list", () => downloadBlob(`${base()}_WireList.csv`, toCsv(wireListTable(getProject(), svc().cat)), "text/csv")) },
  {
    id: "wlxlsx",
    label: "Wire list + pinouts (XLSX)",
    run: () => withToast("Wire list", async () => downloadBlob(`${base()}_WireList.xlsx`, new Blob([(await toXlsx([wireListTable(getProject(), svc().cat), pinoutTable(getProject(), svc().cat)])) as BlobPart], { type: XLSX_MIME }))),
  },
  { id: "pincsv", label: "Pinouts (CSV)", run: () => withToast("Pinouts", () => downloadBlob(`${base()}_Pinouts.csv`, toCsv(pinoutTable(getProject(), svc().cat)), "text/csv")) },
  { id: "bomcsv", label: "BOM (CSV)", run: () => withToast("BOM", () => downloadBlob(`${base()}_BOM.csv`, toCsv(bomTableFor()), "text/csv")) },
  { id: "bomxlsx", label: "BOM (XLSX)", run: () => withToast("BOM", async () => downloadBlob(`${base()}_BOM.xlsx`, new Blob([(await toXlsx([bomTableFor()])) as BlobPart], { type: XLSX_MIME }))) },
  {
    id: "dfmcsv",
    label: "DFM / design-rule results (CSV)",
    run: () =>
      withToast("DFM results", () => {
        const p = getProject();
        const a = useAnalysis.getState().byPedigree[currentRevision(p).activePedigreeId];
        if (!a) throw new Error("checks still running");
        downloadBlob(`${base()}_DFM_Results.csv`, toCsv(dfmTable(a.dfm)), "text/csv");
      }),
  },
  { id: "wireviz", label: "WireViz YAML", run: () => withToast("WireViz", () => downloadBlob(`${base()}.yml`, exportWireViz(getProject(), svc().cat), "text/yaml")) },
  { id: "rules", label: "Project rules + pedigrees (.harnessrules.json)", run: () => withToast("Ruleset", () => downloadBlob(`${base()}_rules.harnessrules.json`, JSON.stringify(exportProjectRuleset(getProject()), null, 2))) },
  "-",
  { id: "svg", label: "Canvas as SVG", run: () => withToast("SVG", () => exportCanvasSvg(`${base()}_canvas.svg`)) },
  { id: "png", label: "Canvas as PNG", run: () => withToast("PNG", () => exportCanvasPng(`${base()}_canvas.png`)) },
  "-",
  { id: "drawing", label: "Drawing (PDF)", run: () => withToast("Drawing", async () => (await import("./docs")).downloadDrawing()) },
  { id: "report", label: "Design report (PDF)", run: () => withToast("Design report", async () => (await import("./docs")).downloadReport()) },
  { id: "package", label: "Output package (ZIP)…", run: () => useUi.getState().setView("outputs") },
];

function bomTableFor() {
  return bomTable(bomFor(getProject(), svc().cat), { pricing: true });
}
