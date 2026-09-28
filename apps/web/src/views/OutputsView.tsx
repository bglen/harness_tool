import { useEffect, useRef, useState } from "react";
import { currentRevision, setReportText, setTitleBlock } from "@hs/model";
import { REPORT_SECTIONS, autoSummary, type SectionId } from "@hs/docs";
import { verifyZip, type Manifest } from "@hs/io";
import { Download, FileCheck2, Loader2, RefreshCw } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { buildOutputPackage, docData, drawingBlob, PACKAGE_PRESETS, reportBlob, type PackageItem } from "../lib/docs";
import { downloadBlob, pickFile, safeName } from "../lib/files";
import { useUi } from "../store/ui";
import { Button, cx, DemoTag, Field, inputCls, Section, Select, Toggle } from "../ui/primitives";

type Tab = "drawing" | "report" | "package";

function usePdf(make: () => Promise<Blob>, deps: unknown[]) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const b = await make();
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(b);
      });
    } catch (e) {
      console.error(e);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { url, busy, err, run };
}

export default function OutputsView() {
  const [tab, setTab] = useState<Tab>("drawing");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border-subtle px-4 py-2">
        {(["drawing", "report", "package"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-control px-3 py-1 text-sm capitalize", tab === t ? "bg-bg-hover font-medium" : "text-text-secondary hover:text-text-primary")}>
            {t}
          </button>
        ))}
        <span className="ml-3 text-xs text-text-tertiary">Generated live from the model: nothing here is a separate document to maintain.</span>
      </div>
      <div className="min-h-0 flex-1">{tab === "drawing" ? <DrawingTab /> : tab === "report" ? <ReportTab /> : <PackageTab />}</div>
    </div>
  );
}

function Preview({ url, busy, err, run, title }: { url: string | null; busy: boolean; err: string | null; run: () => void; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-xs">
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        <span className="text-text-secondary">{busy ? "Rendering PDF…" : err ? `Failed: ${err}` : title}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={run}>
          <RefreshCw size={12} /> Refresh
        </Button>
        {url && (
          <a href={url} download={title} className="flex h-7 items-center gap-1 rounded-control bg-accent px-2 text-xs font-medium text-accent-on">
            <Download size={12} /> Download
          </a>
        )}
      </div>
      {url ? <iframe title={title} src={url} className="min-h-0 flex-1 bg-white" /> : <div className="flex flex-1 items-center justify-center text-sm text-text-tertiary">Preparing preview…</div>}
    </div>
  );
}

function DrawingTab() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const tb = project.titleBlock;
  const pdf = usePdf(() => drawingBlob(), [project.titleBlock]);
  const [notes, setNotes] = useState(tb.notes.join("\n"));
  const set = (patch: Partial<typeof tb>) => dispatch(setTitleBlock(patch));
  return (
    <div className="flex h-full">
      <div className="scroll-thin w-80 shrink-0 overflow-auto border-r border-border-subtle p-3">
        <Section title="Title block">
          <Field label="Company"><input className={inputCls} defaultValue={tb.company} onBlur={(e) => set({ company: e.target.value })} /></Field>
          <Field label="Title"><input className={inputCls} defaultValue={tb.title || project.name} onBlur={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Drawing number"><input className={cx(inputCls, "mono")} defaultValue={tb.drawingNumber || project.partNumber} onBlur={(e) => set({ drawingNumber: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Drawn"><input className={inputCls} defaultValue={tb.drawnBy} onBlur={(e) => set({ drawnBy: e.target.value })} /></Field>
            <Field label="Checked"><input className={inputCls} defaultValue={tb.checkedBy} onBlur={(e) => set({ checkedBy: e.target.value })} /></Field>
            <Field label="Approved"><input className={inputCls} defaultValue={tb.approvedBy} onBlur={(e) => set({ approvedBy: e.target.value })} /></Field>
          </div>
          <Field label="Sheet size"><Select value={tb.sheetSize} onChange={(v) => set({ sheetSize: v })} options={["ANSI B", "ANSI D", "ISO A3", "ISO A1"].map((x) => ({ value: x as typeof tb.sheetSize, label: x }))} /></Field>
          <Field label="Tolerances"><input className={inputCls} defaultValue={tb.tolerances} onBlur={(e) => set({ tolerances: e.target.value })} /></Field>
          <Field label="Export-control marking (every page)" hint="e.g. EAR99 / ITAR banner text. Phase 1 makes no compliance claims."><input className={inputCls} defaultValue={tb.exportControl} onBlur={(e) => set({ exportControl: e.target.value })} /></Field>
        </Section>
        <Section title="User notes (one per line)">
          <textarea className={cx(inputCls, "h-28 py-1")} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => set({ notes: notes.split("\n").map((x) => x.trim()).filter(Boolean) })} />
        </Section>
        <div className="mt-2 text-2xs text-text-tertiary">{rev.frozen ? "Frozen revision: output is deterministic." : "Working draft: every page is stamped DRAFT — NOT RELEASED."} Diagram changes happen in the Design view.</div>
      </div>
      <Preview {...pdf} title={`${safeName(project.partNumber)}_Rev${rev.label}_Drawing.pdf`} />
    </div>
  );
}

function ReportTab() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const sections = project.report.sections as Partial<Record<SectionId, boolean>>;
  const pdf = usePdf(() => reportBlob(), [project.report]);
  const auto = useRef(autoSummary(docData()));
  return (
    <div className="flex h-full">
      <div className="scroll-thin w-80 shrink-0 overflow-auto border-r border-border-subtle p-3">
        <Section title="Sections">
          {REPORT_SECTIONS.map((sec) => (
            <Toggle key={sec.id} checked={sections[sec.id] !== false} onChange={(v) => dispatch(setReportText({ sections: { [sec.id]: v } }))} label={sec.label} />
          ))}
        </Section>
        <Section title="Summary paragraph" right={<button className="text-2xs text-accent" onClick={() => dispatch(setReportText({ summary: "" }))}>reset to auto</button>}>
          <textarea className={cx(inputCls, "h-28 py-1 text-xs")} defaultValue={project.report.summary || auto.current} onBlur={(e) => dispatch(setReportText({ summary: e.target.value === auto.current ? "" : e.target.value }))} />
          <div className="text-2xs text-text-tertiary">Filled from model facts (template, deterministic). Edit to override.</div>
        </Section>
        <Section title="Design notes">
          <textarea className={cx(inputCls, "h-20 py-1 text-xs")} defaultValue={project.report.designNotes} onBlur={(e) => dispatch(setReportText({ designNotes: e.target.value }))} />
        </Section>
        <Section title="Review comments">
          <textarea className={cx(inputCls, "h-20 py-1 text-xs")} defaultValue={project.report.reviewComments} onBlur={(e) => dispatch(setReportText({ reviewComments: e.target.value }))} />
        </Section>
        <div className="mt-2 flex items-center gap-1 text-2xs text-text-tertiary">Pricing and stock are frozen at generation time and labelled with a timestamp. <DemoTag /></div>
      </div>
      <Preview {...pdf} title={`${safeName(project.partNumber)}_Rev${rev.label}_Design_Report.pdf`} />
    </div>
  );
}

function PackageTab() {
  const project = useProject((s) => s.project)!;
  const ui = useUi();
  const [preset, setPreset] = useState(PACKAGE_PRESETS[0]!);
  const [items, setItems] = useState<PackageItem[]>(PACKAGE_PRESETS[0]!.items);
  const [revId, setRevId] = useState(project.currentRevisionId);
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const LABELS: Record<PackageItem, string> = { drawing: "Drawing (PDF)", report: "Design report (PDF)", bom: "BOM (CSV + XLSX)", wirelist: "Wire list (CSV)", pinouts: "Pinouts (CSV)", dfm: "DFM results (CSV)", design: "Native design file (.harness.json)", rules: "Applied rulesets + pedigree scheme", pricing: "Include pricing (demo)" };
  const rev = project.revisions.find((r) => r.id === revId)!;
  return (
    <div className="scroll-thin h-full overflow-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Output package</h1>
          <DemoTag />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Section title="Preset">
            {PACKAGE_PRESETS.map((p) => (
              <button key={p.id} onClick={() => (setPreset(p), setItems(p.items))} className={cx("rounded-control border px-3 py-2 text-left text-sm", preset.id === p.id ? "border-accent bg-bg-hover" : "border-border-subtle hover:border-border-control")}>
                {p.name}
                {p.hideQuote && <span className="ml-1 text-2xs text-text-tertiary">(quote section hidden)</span>}
              </button>
            ))}
          </Section>
          <Section title="Contents">
            {(Object.keys(LABELS) as PackageItem[]).map((k) => (
              <Toggle key={k} checked={items.includes(k)} onChange={(v) => setItems(v ? [...items, k] : items.filter((x) => x !== k))} label={LABELS[k]} />
            ))}
            <Field label="Revision">
              <Select value={revId} onChange={setRevId} options={project.revisions.map((r) => ({ value: r.id, label: `Rev ${r.label}${r.frozen ? ` (frozen ${r.frozenAt?.slice(0, 10)})` : " (working draft)"}` }))} />
            </Field>
            {!rev.frozen && <div className="text-2xs text-status-warning">Draft: PDFs will be stamped “DRAFT — not released”. Freeze the revision for a release package.</div>}
          </Section>
        </div>
        <Button
          variant="primary"
          className="h-10 self-start px-4"
          disabled={busy || !items.length}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await buildOutputPackage(items, { revisionId: revId, hideQuote: preset.hideQuote || !items.includes("pricing") });
              downloadBlob(r.name, new Blob([r.zip as BlobPart], { type: "application/zip" }));
              setManifest(r.manifest);
            } catch (e) {
              console.error(e);
              ui.toast({ kind: "error", text: `Package failed: ${(e as Error).message}` });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Generate output package
        </Button>
        {manifest && (
          <Section title="Manifest">
            <table className="w-full text-xs">
              <tbody>
                {manifest.files.map((f) => (
                  <tr key={f.path} className="border-b border-border-subtle">
                    <td className="mono py-1">{f.path}</td>
                    <td className="tnum py-1 text-right text-text-secondary">{(f.bytes / 1024).toFixed(1)} KB</td>
                    <td className="mono py-1 pl-3 text-2xs text-text-tertiary">{f.sha256.slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-2xs text-text-tertiary">
              Design hash {manifest.designHash} · pedigree {manifest.pedigree.code} · profile {manifest.versions.machineProfile} · catalog {manifest.versions.catalog} · generated {manifest.generatedAt}
            </div>
          </Section>
        )}
        <Section title="Verify a package">
          <Button
            size="sm"
            className="self-start"
            onClick={async () => {
              const f = await pickFile(".zip");
              if (!f) return;
              const r = await verifyZip(await f.arrayBuffer());
              setVerify(r.ok ? `✓ ${r.manifest?.files.length} files match their SHA-256 hashes (${r.manifest?.package})` : `✗ ${r.problems.join("; ")}`);
            }}
          >
            <FileCheck2 size={14} /> Check manifest hashes…
          </Button>
          {verify && <div className={cx("text-sm", verify.startsWith("✓") ? "text-status-pass" : "text-status-error")}>{verify}</div>}
        </Section>
      </div>
    </div>
  );
}
