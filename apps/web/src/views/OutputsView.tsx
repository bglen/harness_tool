import { useEffect, useRef, useState } from "react";
import { BUILTIN_TEMPLATES, currentRevision, resolvePedigree, setDrawingTemplate, setReportText, setTitleBlock, stableStringify, uid, type DrawingTemplate } from "@hs/model";
import { REPORT_SECTIONS, autoSummary, type MfgOrder, type SectionId } from "@hs/docs";
import { verifyZip, type Manifest } from "@hs/io";
import { Download, FileCheck2, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { buildOutputPackage, docData, drawingBlob, mfgReportBlob, PACKAGE_PRESETS, reportBlob, type PackageItem } from "../lib/docs";
import { downloadBlob, pickFile, safeName } from "../lib/files";
import { allTemplates, exportTemplate, importTemplateFile, useTemplates } from "../lib/templates";
import { useUi } from "../store/ui";
import { Button, cx, DemoTag, Field, inputCls, Section, Select, Toggle } from "../ui/primitives";

type Tab = "drawing" | "report" | "mfg" | "package";
const TAB_LABEL: Record<Tab, string> = { drawing: "Drawing", report: "Design Report", mfg: "Example Manufacturing Report", package: "Package" };

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
        {(["drawing", "report", "mfg", "package"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-control px-3 py-1 text-sm", tab === t ? "bg-bg-hover font-medium" : "text-text-secondary hover:text-text-primary")}>
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="ml-3 text-xs text-text-tertiary">Generated live from the model: nothing here is a separate document to maintain.</span>
      </div>
      <div className="min-h-0 flex-1">{tab === "drawing" ? <DrawingTab /> : tab === "report" ? <ReportTab /> : tab === "mfg" ? <MfgReportTab /> : <PackageTab />}</div>
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
  const pdf = usePdf(() => drawingBlob(), [project.titleBlock, project.drawingTemplate]);
  const [notes, setNotes] = useState(tb.notes.join("\n"));
  const set = (patch: Partial<typeof tb>) => dispatch(setTitleBlock(patch));
  return (
    <div className="flex h-full">
      <div className="scroll-thin w-80 shrink-0 overflow-auto border-r border-border-subtle p-3">
        <TemplatePicker />
        <Section title="Title block">
          <Field label="Company"><input className={inputCls} defaultValue={tb.company} onBlur={(e) => set({ company: e.target.value })} /></Field>
          <Field label="Title"><input className={inputCls} defaultValue={tb.title || project.name} onBlur={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Drawing number"><input className={cx(inputCls, "mono")} defaultValue={tb.drawingNumber || project.partNumber} onBlur={(e) => set({ drawingNumber: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Drawn"><input className={inputCls} defaultValue={tb.drawnBy} onBlur={(e) => set({ drawnBy: e.target.value })} /></Field>
            <Field label="Checked"><input className={inputCls} defaultValue={tb.checkedBy} onBlur={(e) => set({ checkedBy: e.target.value })} /></Field>
            <Field label="Approved"><input className={inputCls} defaultValue={tb.approvedBy} onBlur={(e) => set({ approvedBy: e.target.value })} /></Field>
          </div>
          {!project.drawingTemplate && <Field label="Sheet size"><Select value={tb.sheetSize} onChange={(v) => set({ sheetSize: v })} options={["ANSI B", "ANSI D", "ISO A3", "ISO A1"].map((x) => ({ value: x as typeof tb.sheetSize, label: x }))} /></Field>}
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

/** Choose, edit, import and export the drawing template this project generates its drawing from. */
function TemplatePicker() {
  const project = useProject((s) => s.project)!;
  const ui = useUi();
  const lib = useTemplates();
  useEffect(() => {
    if (!lib.loaded) void lib.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cur = project.drawingTemplate;
  const rev = currentRevision(project);
  const options = [
    { value: "classic", label: "Classic layout (built-in, no template)" },
    ...BUILTIN_TEMPLATES.map((t) => ({ value: t.id, label: `${t.name} (built-in)` })),
    ...lib.library.map((t) => ({ value: t.id, label: t.name })),
  ];
  if (cur && !options.some((o) => o.value === cur.id)) options.push({ value: cur.id, label: `${cur.name} (in this project)` });
  const use = (id: string) => {
    if (id === "classic") return dispatch(setDrawingTemplate({ template: null }));
    const t = allTemplates().find((x) => x.id === id) ?? (cur?.id === id ? cur : undefined);
    if (t) dispatch(setDrawingTemplate({ template: t }));
  };
  const libCopy = cur && lib.library.find((t) => t.id === cur.id);
  const edited = !!(cur && libCopy && stableStringify({ ...libCopy, updated: "" }) !== stableStringify({ ...cur, updated: "" }));
  const open = (template: DrawingTemplate, source: "project" | "library" | "new") => ui.openDialog("templateEditor", { template: structuredClone(template), source });
  const fresh = () => ({ ...structuredClone(BUILTIN_TEMPLATES[0]!), id: uid(), name: "New template", description: "" });
  return (
    <Section title="Drawing template" right={<span className="text-2xs text-text-tertiary">{lib.library.length} in library</span>}>
      <Select ariaLabel="Drawing template" value={cur?.id ?? "classic"} onChange={use} options={options} />
      <div className="text-2xs text-text-tertiary">
        {cur ? (
          <>
            This project stores its own copy of “{cur.name}”{edited ? ", edited since it was taken from the library" : ""}. Library changes don't affect it until you pick it again.
          </>
        ) : (
          "The fixed layout used before templates. Pick a template, or customize one, to add your logo and title block."
        )}
        {rev.frozen && " Released revisions keep the template they were released with."}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => open(cur ?? fresh(), cur ? "project" : "new")}>
          <Pencil size={12} /> {cur ? "Edit template" : "Customize"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => open(fresh(), "new")}>
          <Plus size={12} /> New
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const t = await importTemplateFile();
            if (t) dispatch(setDrawingTemplate({ template: t }));
          }}
        >
          <Upload size={12} /> Upload…
        </Button>
        <Button size="sm" variant="ghost" disabled={!cur} onClick={() => cur && exportTemplate(cur)}>
          <Download size={12} /> Export
        </Button>
      </div>
      {lib.library.length > 0 && (
        <div className="mt-1 flex flex-col rounded-control border border-border-subtle">
          <div className="label-caps border-b border-border-subtle px-2 py-1">Your library (this browser)</div>
          {lib.library.map((t) => (
            <div key={t.id} className="flex items-center gap-1 border-b border-border-subtle px-2 py-1 text-xs last:border-0">
              <span className={cx("flex-1 truncate", cur?.id === t.id && "font-medium text-accent")} title={t.description || t.name}>
                {t.name}
              </span>
              <button className="text-text-secondary hover:text-text-primary" onClick={() => use(t.id)}>
                Use
              </button>
              <button aria-label={`Edit ${t.name}`} className="text-text-tertiary hover:text-text-primary" onClick={() => open(t, "library")}>
                <Pencil size={12} />
              </button>
              <button aria-label={`Export ${t.name}`} className="text-text-tertiary hover:text-text-primary" onClick={() => exportTemplate(t)}>
                <Download size={12} />
              </button>
              <button
                aria-label={`Delete ${t.name}`}
                className="text-text-tertiary hover:text-status-error"
                onClick={() => {
                  if (window.confirm(`Delete “${t.name}” from your template library? Projects already using it keep their own copy.`)) void lib.remove(t.id);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
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

/** Documents an order can ask for on top of what the pedigree requires. */
const ORDER_DOCS = ["Test data package", "AS9102 First Article Inspection", "Material certifications", "Lot traceability", "Serial traceability", "Customer source-inspection hold point"];

/** Example of the report a manufacturer returns with a built lot, for a chosen pedigree and order (simulated data). */
function MfgReportTab() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const [order, setOrder] = useState<MfgOrder>(() => ({
    customer: project.titleBlock.company || "Example Customer Inc.",
    po: `PO-${new Date().getFullYear()}-0815`,
    workOrder: `WO-${new Date().getFullYear()}-0142`,
    qty: Math.max(1, Math.min(5, project.quote.selected.qty)),
    serialPrefix: "SN",
    buildDate: new Date().toISOString().slice(0, 10),
    pedigreeId: rev.activePedigreeId,
    extraDocs: [],
  }));
  const set = (patch: Partial<MfgOrder>) => setOrder((o) => ({ ...o, ...patch }));
  const pdf = usePdf(() => mfgReportBlob(order), [order, project]);
  const ped = resolvePedigree(project.pedigreeScheme, order.pedigreeId ?? rev.activePedigreeId);
  return (
    <div className="flex h-full">
      <div className="scroll-thin w-80 shrink-0 overflow-auto border-r border-border-subtle p-3">
        <div className="mb-2 flex items-center gap-2 text-2xs text-text-tertiary">
          What a manufacturer returns with a built lot: certificate, inspection results and the test data the pedigree and order ask for. All names, serials and measurements are simulated. <DemoTag />
        </div>
        <Section title="Built to">
          <Field label="Pedigree">
            <Select value={order.pedigreeId ?? rev.activePedigreeId} onChange={(v) => set({ pedigreeId: v })} options={[...project.pedigreeScheme.pedigrees].sort((a, b) => a.rank - b.rank).map((p) => ({ value: p.id, label: `${p.code} ${p.name}${p.id === rev.activePedigreeId ? " (design)" : ""}` }))} />
          </Field>
          <div className="text-2xs text-text-tertiary">
            {ped.inspections.filter((i) => i.sampling !== "none").length} inspections · documents: {ped.documentation.join(", ") || "none"}
          </div>
        </Section>
        <Section title="Order">
          <Field label="Customer"><input className={inputCls} defaultValue={order.customer} onBlur={(e) => set({ customer: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Customer PO"><input className={cx(inputCls, "mono")} defaultValue={order.po} onBlur={(e) => set({ po: e.target.value })} /></Field>
            <Field label="Work order"><input className={cx(inputCls, "mono")} defaultValue={order.workOrder} onBlur={(e) => set({ workOrder: e.target.value })} /></Field>
            <Field label="Quantity"><input type="number" min={1} max={50} className={cx(inputCls, "mono")} defaultValue={order.qty} onBlur={(e) => set({ qty: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} /></Field>
            <Field label="Serial prefix"><input className={cx(inputCls, "mono")} defaultValue={order.serialPrefix} onBlur={(e) => set({ serialPrefix: e.target.value })} /></Field>
          </div>
          <Field label="Final test date"><input type="date" className={inputCls} defaultValue={order.buildDate} onBlur={(e) => e.target.value && set({ buildDate: e.target.value })} /></Field>
        </Section>
        <Section title="Documents requested on the order">
          {ORDER_DOCS.map((d) => {
            const required = ped.documentation.includes(d);
            return <Toggle key={d} checked={required || order.extraDocs.includes(d)} onChange={(v) => !required && set({ extraDocs: v ? [...order.extraDocs, d] : order.extraDocs.filter((x) => x !== d) })} label={required ? `${d} (required by ${ped.code})` : d} />;
          })}
          <div className="text-2xs text-text-tertiary">The detailed measured values appear when the pedigree or the order asks for a test data package.</div>
        </Section>
      </div>
      <Preview {...pdf} title={`${safeName(project.partNumber)}_Rev${rev.label}_Manufacturing_Report_EXAMPLE.pdf`} />
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
                {(p.redact.pricing || p.redact.supply) && <span className="ml-1 text-2xs text-text-tertiary">(removes {[p.redact.pricing && "prices", p.redact.supply && "stock/lead times"].filter(Boolean).join(" and ")} from every file)</span>}
              </button>
            ))}
            <div className="text-2xs text-text-tertiary">Redaction applies to the report, BOM, DFM results and the native design file, not just the quote section.</div>
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
              const r = await buildOutputPackage(items, { revisionId: revId, redact: preset.redact });
              downloadBlob(r.name, new Blob([r.zip as BlobPart], { type: "application/zip" }));
              setManifest(r.manifest);
              if (r.releaseCheck && !r.releaseCheck.ok) ui.toast({ kind: "error", text: `Regenerated ${r.releaseCheck.differences.join(", ")} differ from Rev ${rev.label} as released (catalog or tool changed since release). The manifest records this.` });
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
              Design SHA-256 {manifest.designHash.slice(0, 16)}… · pedigree {manifest.pedigree.code} · profile {manifest.versions.machineProfile} · catalog {manifest.versions.catalog} · generated {manifest.generatedAt}
              {manifest.redaction && (manifest.redaction.pricing || manifest.redaction.supply) ? ` · redacted: ${[manifest.redaction.pricing && "pricing", manifest.redaction.supply && "supply"].filter(Boolean).join(", ")}` : ""}
            </div>
            {manifest.release && (
              <div className={cx("text-2xs", manifest.release.outputsMatchRelease === false ? "text-status-error" : "text-text-tertiary")}>
                Released {manifest.release.releasedAt.slice(0, 10)} · inputs {manifest.release.inputsSha256.slice(0, 12)}… · {manifest.release.outputsMatchRelease === null ? "no output hashes recorded at release" : manifest.release.outputsMatchRelease ? "wire list, pinouts and BOM match the release record" : `differs from release: ${manifest.release.differences.join(", ")}`}
              </div>
            )}
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
