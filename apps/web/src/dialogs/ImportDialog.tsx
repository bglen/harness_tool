import { useEffect, useMemo, useState } from "react";
import { applyMapping, autoMap, buildImportCommands, expandDeferred, FIELD_LABELS, importWireViz, isDeferred, parseDelimited, parseXlsx, resolveConnectorPn, type FieldKey, type MappedImport, type ParsedTable, type PartMatch } from "@hs/io";
import { Check, FileSpreadsheet, Upload } from "lucide-react";
import { dispatch, getProject, useProject } from "../store/project";
import { storage, useUi } from "../store/ui";
import { svc } from "../lib/services";
import { pickFile } from "../lib/files";
import { zoomToFit } from "../lib/viewport";
import { Button, Chip, cx, Dialog, inputCls, SeverityIcon } from "../ui/primitives";

type Step = "source" | "map" | "parts";

/** Import: CSV/XLSX/pasted table/WireViz → column mapping (auto-detected) → part resolution → build (§12). */
export function ImportDialog({ data }: { data: { file?: File; text?: string } | true }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const init = typeof data === "object" ? data : {};
  const [step, setStep] = useState<Step>("source");
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [map, setMap] = useState<FieldKey[]>([]);
  const [mapped, setMapped] = useState<MappedImport | null>(null);
  const [matches, setMatches] = useState<Record<string, PartMatch>>({});
  const [pns, setPns] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => ui.closeDialog("import");
  const cat = svc().cat;

  const loadTable = (t: ParsedTable) => {
    setTable(t);
    // Remember mappings per header signature (per user, §12)
    const sig = t.header.join("|").toLowerCase();
    const saved = storage.get<Record<string, FieldKey[]>>("importMaps", {})[sig];
    setMap(saved && saved.length === t.header.length ? saved : autoMap(t.header));
    setStep("map");
  };

  const toParts = (m: MappedImport) => {
    setMapped(m);
    const res: Record<string, PartMatch> = {};
    const chosen: Record<string, string> = {};
    const existing = getProject().revisions.find((r) => r.id === getProject().currentRevisionId)!.harness.connectors;
    for (const c of m.connectors) {
      const onCanvas = existing.find((x) => x.refDes === c.refDes);
      if (onCanvas) {
        res[c.refDes] = { input: c.pn ?? "", status: "exact", pn: onCanvas.pn, candidates: [onCanvas.pn] };
        chosen[c.refDes] = onCanvas.pn;
        continue;
      }
      const pins = [...new Set(m.rows.flatMap((r) => [r.from, r.to]).filter((e) => e.conn === c.refDes).map((e) => e.pin))];
      res[c.refDes] = resolveConnectorPn(c.pn, cat, pins);
      if (res[c.refDes]!.pn) chosen[c.refDes] = res[c.refDes]!.pn!;
    }
    setMatches(res);
    setPns(chosen);
    setStep("parts");
  };

  const handleFile = async (f: File) => {
    setError(null);
    try {
      if (/\.ya?ml$/i.test(f.name)) return toParts(importWireViz(await f.text()));
      if (/\.harnessrules\.json$/i.test(f.name)) return close(), ui.openDialog("rules", { importFile: f });
      if (/\.json$/i.test(f.name)) return close(), (await import("../lib/files")).openFile(f);
      if (/\.xlsx?$/i.test(f.name)) return loadTable(await parseXlsx(await f.arrayBuffer()));
      loadTable(parseDelimited(await f.text()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (init.file) void handleFile(init.file);
    else if (init.text) loadTable(parseDelimited(init.text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = useMemo(() => (table ? applyMapping(table, map, project.units) : null), [table, map, project.units]);
  const required: FieldKey[] = ["fromConn", "toConn"];
  const hasPins = map.includes("fromPin") && map.includes("toPin");
  const missing = required.filter((k) => !map.includes(k));

  const doImport = () => {
    if (!mapped) return;
    const { commands, notes } = buildImportCommands(getProject(), cat, mapped, pns);
    const main = commands.filter((c) => !isDeferred(c));
    const deferred = commands.filter(isDeferred);
    if (!dispatch(main, `Import ${mapped.rows.length} wires`)) return;
    const after = expandDeferred(getProject(), deferred, cat);
    if (after.length) dispatch(after, undefined, { merge: true });
    ui.toast({ kind: "success", text: `Imported ${mapped.rows.length} wires on ${mapped.connectors.length} connectors. ${notes[0] ?? ""}` });
    if (table) storage.set("importMaps", { ...storage.get<Record<string, FieldKey[]>>("importMaps", {}), [table.header.join("|").toLowerCase()]: map });
    close();
    setTimeout(zoomToFit, 60);
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Import"
      width={960}
      description="CSV / XLSX wire lists, pasted tables and WireViz YAML. Columns are detected automatically; connector part numbers are matched to the catalog."
      footer={
        step === "map" ? (
          <>
            <Button variant="ghost" onClick={() => setStep("source")}>Back</Button>
            <Button variant="primary" disabled={!!missing.length || !preview?.rows.length} onClick={() => preview && toParts(preview)}>
              Next: parts ({preview?.connectors.length ?? 0} connectors)
            </Button>
          </>
        ) : step === "parts" ? (
          <>
            <Button variant="ghost" onClick={() => setStep(table ? "map" : "source")}>Back</Button>
            <Button variant="primary" disabled={!mapped || mapped.connectors.some((c) => !pns[c.refDes] || !cat.connector(pns[c.refDes]!))} onClick={doImport}>
              Import {mapped?.rows.length} wires
            </Button>
          </>
        ) : undefined
      }
    >
      {step === "source" && (
        <div className="grid grid-cols-2 gap-4">
          <button className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-control p-8 text-sm hover:border-accent" onClick={async () => { const f = await pickFile(".csv,.tsv,.txt,.xlsx,.xls,.yml,.yaml,.json"); if (f) void handleFile(f); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}>
            <Upload size={24} className="text-text-tertiary" />
            Choose or drop a file
            <span className="text-2xs text-text-tertiary">CSV · XLSX · WireViz YAML · .harness.json · .harnessrules.json</span>
          </button>
          <div className="flex flex-col gap-2">
            <textarea className={cx(inputCls, "mono h-40 py-1 text-xs")} placeholder={"Or paste rows from Excel (with a header row)\nWire\tFrom\tFrom Pin\tTo\tTo Pin\tSignal\tGauge\tColor"} value={paste} onChange={(e) => setPaste(e.target.value)} />
            <Button disabled={!paste.trim()} onClick={() => loadTable(parseDelimited(paste))}>
              <FileSpreadsheet size={14} /> Use pasted table
            </Button>
          </div>
          {error && <div className="col-span-2 text-sm text-status-error">{error}</div>}
        </div>
      )}
      {step === "map" && table && (
        <div className="flex flex-col gap-3">
          <div className="text-sm">
            {missing.length ? (
              <span className="text-status-warning">Map the {missing.map((k) => FIELD_LABELS[k]).join(" and ")} column{missing.length > 1 ? "s" : ""}.</span>
            ) : (
              <span className="flex items-center gap-1 text-status-pass"><Check size={14} /> Columns detected automatically. Check them and continue.</span>
            )}
            {!hasPins && !missing.length && <span className="ml-2 text-xs text-text-secondary">(pins will be split from values like “P1-3”)</span>}
          </div>
          <div className="scroll-thin max-h-[50vh] overflow-auto rounded-card border border-border-subtle">
            <table className="text-xs">
              <thead className="sticky top-0 bg-bg-surface-2">
                <tr>
                  {table.header.map((h, i) => (
                    <th key={i} className="min-w-[110px] p-1 text-left">
                      <div className="mb-1 truncate font-medium">{h}</div>
                      <select className={cx(inputCls, "h-7 w-full text-xs", map[i] !== "ignore" && "border-accent")} value={map[i]} onChange={(e) => setMap(map.map((m, j) => (j === i ? (e.target.value as FieldKey) : m === e.target.value ? "ignore" : m)))}>
                        {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => <option key={k} value={k}>{FIELD_LABELS[k]}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 12).map((r, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    {r.map((c, j) => <td key={j} className={cx("mono truncate p-1", map[j] === "ignore" && "text-text-tertiary")}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-text-secondary">{table.rows.length} rows · {preview?.rows.length ?? 0} wires recognised · {preview?.issues.length ?? 0} issues</div>
          {preview?.issues.slice(0, 5).map((i) => <div key={i} className="flex gap-1 text-2xs text-status-warning"><SeverityIcon severity="warning" size={11} /> {i}</div>)}
        </div>
      )}
      {step === "parts" && mapped && (
        <div className="flex flex-col gap-2">
          <div className="text-sm text-text-secondary">Review how connector part numbers were matched (exact → normalized → fuzzy). Unknown wire specs fall back to the project default.</div>
          <table className="w-full text-sm">
            <thead className="text-left text-2xs uppercase tracking-wide text-text-tertiary">
              <tr><th className="p-1">RefDes</th><th className="p-1">Imported PN</th><th className="p-1">Match</th><th className="p-1">Use part</th></tr>
            </thead>
            <tbody>
              {mapped.connectors.map((c) => {
                const m = matches[c.refDes];
                const pn = pns[c.refDes] ?? "";
                const ok = !!cat.connector(pn);
                return (
                  <tr key={c.refDes} className="border-t border-border-subtle">
                    <td className="mono p-1">{c.refDes}</td>
                    <td className="mono p-1 text-text-secondary">{c.pn || "—"}</td>
                    <td className="p-1">
                      <Chip className={m?.status === "exact" || m?.status === "normalized" ? "border-status-pass text-status-pass" : m?.status === "fuzzy" ? "border-status-warning text-status-warning" : "border-status-error text-status-error"}>
                        {m?.status === "none" ? (c.pn ? "not found" : "no PN given") : m?.status}
                      </Chip>
                    </td>
                    <td className="p-1">
                      <div className="flex items-center gap-1">
                        <input list={`cand-${c.refDes}`} className={cx(inputCls, "mono h-7 w-60 text-xs", !ok && "border-status-error")} value={pn} onChange={(e) => setPns({ ...pns, [c.refDes]: e.target.value.toUpperCase() })} />
                        <datalist id={`cand-${c.refDes}`}>{m?.candidates.map((x) => <option key={x} value={x} />)}</datalist>
                        {ok ? <Check size={14} className="text-status-pass" /> : <span className="text-2xs text-status-error">choose a catalog part</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mapped.issues.map((i) => <div key={i} className="text-2xs text-status-warning">{i}</div>)}
          <div className="text-2xs text-text-tertiary">Imported connectors are laid out left-to-right; with more than two connectors, segments are created as a star from a central breakout.</div>
        </div>
      )}
    </Dialog>
  );
}
