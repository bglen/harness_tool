import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { DocData } from "./data";
import { C, DraftStamp, ExportBanner, fmtLen, fontMono, fontUi, pdfSafe, s, Swatch, Table } from "./common";
import { HarnessDiagram } from "./diagram";

const SHEETS: Record<string, [number, number]> = {
  "ANSI B": [1224, 792],
  "ANSI D": [2448, 1584],
  "ISO A3": [1191, 842],
  "ISO A1": [2384, 1684],
};

/** Drawing notes: workmanship, inspections, markings, user notes, rulesets, waivers, tooling (§13.1). */
export function drawingNotes(data: DocData): string[] {
  const { ped, project, dfm, cat, rev } = data;
  const notes: string[] = [];
  notes.push(`Workmanship per ${ped.workmanship}.`);
  notes.push(`Build class (pedigree): ${ped.name} (${ped.code}), scheme “${project.pedigreeScheme.name}” v${project.pedigreeScheme.version}.`);
  const insp = ped.inspections.map((i) => {
    const t = data.inspections.find((x) => x.id === i.typeId);
    const params = Object.entries(i.params)
      .filter(([, v]) => typeof v !== "object")
      .map(([k, v]) => `${t?.params.find((p) => p.key === k)?.label ?? k} ${v}${t?.params.find((p) => p.key === k)?.unit ? " " + t.params.find((p) => p.key === k)!.unit : ""}`)
      .join(", ");
    return `${t?.name ?? i.typeId} (${i.sampling}${params ? "; " + params : ""})`;
  });
  notes.push(`Inspection and test: ${insp.join("; ") || "continuity 100%"}.`);
  if (ped.documentation.length) notes.push(`Deliverables: ${ped.documentation.join(", ")}.`);
  if (ped.markings.length) notes.push(`Markings: ${ped.markings.map((m) => m.text).join(", ")}.`);
  notes.push(`Wire lengths include termination allowances; segment lengths ${project.titleBlock.tolerances}. Dimensions in ${project.units === "in" ? "inches" : "millimetres"}.`);
  notes.push("Unused cavities sealed with sealing plugs per BOM. Wire color codes per MIL-STD-681.");
  const tools = new Map<string, string>();
  for (const w of rev.harness.wires)
    for (const e of [w.from, w.to]) {
      if (e.kind !== "pin") continue;
      const c = rev.harness.connectors.find((x) => x.id === e.connectorId);
      const cav = c && cat.cavity(c.pn, e.cavityId);
      const cp = cav && cat.contactFor(cav.size, cat.connector(c!.pn)!.gender, w.gauge);
      if (cp) tools.set(cp.pn, `${cp.pn}: crimp ${cp.crimpTool} / ${cp.positioner}, insert ${cp.insertionTool}, remove ${cp.removalTool}`);
    }
  if (tools.size) notes.push(`Crimp tooling (verify before use): ${[...tools.values()].join("; ")}.`);
  const rs = project.rulesets.map((r) => `${r.name} v${r.version}${r.enforced ? " (enforced)" : ""}`);
  notes.push(`Checked against machine profile ${data.profile.version}${rs.length ? ` and design rulesets: ${rs.join(", ")}` : ""}${project.projectRules.length ? ` + ${project.projectRules.length} project rules` : ""}. DFM: ${dfm.manufacturability.errors} errors, ${dfm.manufacturability.warnings} warnings.`);
  for (const w of project.waivers) notes.push(`WAIVER ${w.ruleId}: ${w.note}${w.author ? ` (${w.author}, ${w.date})` : ` (${w.date})`}.`);
  for (const n of project.titleBlock.notes) notes.push(n);
  return notes.map(pdfSafe);
}

function TitleBlock({ data }: { data: DocData }) {
  const { project, rev, ped } = data;
  const tb = project.titleBlock;
  const cell = (label: string, value: string, flex = 1, mono = false) => (
    <View style={{ flex, borderLeft: `0.75pt solid ${C.text}`, padding: 3 }}>
      <Text style={{ fontSize: 5.5, color: C.text3 }}>{label}</Text>
      <Text style={{ fontSize: 8, fontFamily: mono ? fontMono() : fontUi(), fontWeight: 600 }}>{value}</Text>
    </View>
  );
  return (
    <View fixed style={{ position: "absolute", right: 24, bottom: 24, width: 420, border: `1pt solid ${C.text}`, backgroundColor: "#FFFFFF" }}>
      <View style={{ flexDirection: "row", borderBottom: `0.75pt solid ${C.text}` }}>
        <View style={{ flex: 2, padding: 3 }}>
          <Text style={{ fontSize: 10, fontWeight: 600 }}>{tb.company || "Harness Studio"}</Text>
          <Text style={{ fontSize: 8 }}>{tb.title || project.name}</Text>
        </View>
        {cell("PEDIGREE", `${ped.code} ${ped.name}`, 1.3)}
      </View>
      <View style={{ flexDirection: "row", borderBottom: `0.75pt solid ${C.text}` }}>
        {cell("DRAWING NO.", tb.drawingNumber || project.partNumber, 1.4, true)}
        {cell("REV", rev.label, 0.5, true)}
        {cell("DATE", data.generatedAt.slice(0, 10), 0.9)}
        {cell("UNITS", project.units === "in" ? "INCH" : "MM", 0.6)}
      </View>
      <View style={{ flexDirection: "row", borderBottom: `0.75pt solid ${C.text}` }}>
        {cell("DRAWN", tb.drawnBy || "—")}
        {cell("CHECKED", tb.checkedBy || "—")}
        {cell("APPROVED", tb.approvedBy || "—")}
        <View style={{ flex: 1, borderLeft: `0.75pt solid ${C.text}`, padding: 3 }}>
          <Text style={{ fontSize: 5.5, color: C.text3 }}>SHEET</Text>
          <Text style={{ fontSize: 8, fontWeight: 600 }} render={({ pageNumber, totalPages }) => `${pageNumber} OF ${totalPages}`} />
        </View>
      </View>
      <View style={{ padding: 3 }}>
        <Text style={{ fontSize: 6, color: C.text2 }}>TOLERANCES: {tb.tolerances}. HARNESS PN {project.partNumber}. DESIGN HASH {data.designHash}.</Text>
      </View>
    </View>
  );
}

export function DrawingDocument({ data }: { data: DocData }) {
  const { project } = data;
  const [W, H] = SHEETS[project.titleBlock.sheetSize] ?? SHEETS["ANSI B"]!;
  const scale = W / 1224;
  const u = project.units;
  const notes = drawingNotes(data);
  const pageStyle = { padding: 24, paddingBottom: 120, fontFamily: fontUi(), color: C.text, fontSize: 8 * scale };
  const frame = <View fixed style={{ position: "absolute", top: 12, left: 12, right: 12, bottom: 12, border: `1.2pt solid ${C.text}` }} />;
  return (
    <Document title={`${project.partNumber} Rev ${data.rev.label} Drawing`} author={project.titleBlock.company} creator="Harness Studio" producer="Harness Studio">
      <Page size={[W, H]} style={pageStyle}>
        {frame}
        <DraftStamp draft={data.draft} />
        <ExportBanner text={project.titleBlock.exportControl} />
        <View style={{ flexDirection: "row", flex: 1 }}>
          <View style={{ flex: 3 }}>
            <Text style={{ fontSize: 11 * scale, fontWeight: 600, marginBottom: 4 }}>
              {project.name} — {project.partNumber} Rev {data.rev.label}
            </Text>
            <HarnessDiagram data={data} width={W * 0.66} height={H - 190} />
          </View>
          <View style={{ flex: 1.1, paddingLeft: 10, paddingTop: 16 }}>
            <Text style={s.caps}>Notes</Text>
            {notes.map((n, i) => (
              <View key={i} style={{ flexDirection: "row", marginTop: 3 }}>
                <Text style={{ width: 12, fontSize: 7 * scale }}>{i + 1}.</Text>
                <Text style={{ flex: 1, fontSize: 7 * scale, lineHeight: 1.35 }}>{n}</Text>
              </View>
            ))}
          </View>
        </View>
        <TitleBlock data={data} />
      </Page>
      <Page size={[W, H]} style={pageStyle} wrap>
        {frame}
        <DraftStamp draft={data.draft} />
        <ExportBanner text={project.titleBlock.exportControl} />
        <Text style={s.h2}>Connector tables</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {data.connectorRows.map((c) => (
            <View key={c.refDes} style={{ width: (W - 60) / 2 - 8, marginRight: 8, marginBottom: 8 }}>
              <Text style={s.h3}>
                {c.refDes} — <Text style={{ fontFamily: fontMono() }}>{c.pn}</Text>
              </Text>
              <Text style={s.small}>{c.description}</Text>
              <Table
                cols={[{ label: "Pin", w: 0.6, mono: true }, { label: "Signal", w: 2, mono: true }, { label: "Wire", w: 0.8, mono: true }, { label: "AWG", w: 0.5 }, { label: "Color", w: 1.8 }, { label: "Contact / plug", w: 1.8, mono: true }]}
                rows={c.rows.map((r) => [r.cavity, r.signal || "spare", r.wire, r.gauge, <Swatch key="s" codes={r.colorCode} text={r.color} wire={data.printWire} />, r.contact])}
              />
            </View>
          ))}
        </View>
        <Text style={s.h2} break>
          Wire list
        </Text>
        <Table
          cols={[{ label: "Wire", w: 0.7, mono: true }, { label: "Net", w: 1.8, mono: true }, { label: "From", w: 1, mono: true }, { label: "To", w: 1, mono: true }, { label: "AWG", w: 0.5 }, { label: "Spec", w: 1.1, mono: true }, { label: "Color", w: 1.8 }, { label: `Length (${u})`, w: 0.9, align: "right" }, { label: "Twist", w: 0.5 }, { label: "Shield", w: 0.6 }]}
          rows={data.wireRows.map((w) => [w.id, w.net, w.from, w.to, w.gauge, w.spec, <Swatch key="s" codes={w.colorCode} text={w.color} wire={data.printWire} />, fmtLen(w.lengthMm, u).replace(/ (in|mm)$/, ""), w.twist, w.shield])}
        />
        <Text style={s.h2}>Bill of materials</Text>
        <Table
          cols={[{ label: "Line", w: 0.4 }, { label: "Part number", w: 2, mono: true }, { label: "Description", w: 3.5 }, { label: "Qty", w: 0.6, align: "right" }, { label: "UoM", w: 0.4 }, { label: "Refs", w: 2 }]}
          rows={data.bom.lines.map((l) => [l.line, l.pn, l.description, l.uom === "ea" ? l.qty : l.qty.toFixed(2), l.uom, l.refs.slice(0, 12).join(" ") + (l.refs.length > 12 ? " …" : "")])}
        />
        {data.labelTexts.length > 0 && (
          <>
            <Text style={s.h2}>Labels</Text>
            <Table cols={[{ label: "Text", w: 3, mono: true }, { label: "Location", w: 1 }, { label: "Label stock", w: 1.5, mono: true }]} rows={data.labelTexts.map((l) => [l.text, l.where, l.pn])} />
          </>
        )}
        <TitleBlock data={data} />
      </Page>
    </Document>
  );
}
