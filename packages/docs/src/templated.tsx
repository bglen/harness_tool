import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { FLOW_KINDS, resolveDrawingTokens, SHEET_SIZES, type DrawingTemplate, type TemplateBlock, type TemplateSheet } from "@hs/model";
import type { DocData } from "./data";
import { C, DraftStamp, ExportBanner, fmtLen, fontMono, fontUi, pdfSafe } from "./common";
import { HarnessDiagram } from "./diagram";
import { drawingNotes } from "./drawing";
import { SchematicDiagram } from "./schematicPdf";
import { estimateLines, fitText, headerH, packFlow, rowH, titleH, type FlowCell, type FlowCol, type FlowGroup, type FlowItem } from "./flow";

/** Gap between flow columns inside a block (pt). */
const COL_GAP = 10;

/** Token values for title blocks and text blocks (sheet tokens are filled per page). */
export function drawingTokenValues(data: DocData, template: Pick<DrawingTemplate, "company">): Record<string, string> {
  const { project, rev, ped } = data;
  const tb = project.titleBlock;
  const company = tb.company && tb.company !== "Harness Studio" ? tb.company : template.company || tb.company || "";
  return {
    company,
    title: tb.title || project.name,
    drawingNumber: tb.drawingNumber || project.partNumber,
    partNumber: project.partNumber,
    rev: rev.label,
    date: data.generatedAt.slice(0, 10),
    status: data.draft ? "DRAFT — NOT RELEASED" : "RELEASED",
    units: project.units === "in" ? "INCH" : "MM",
    drawnBy: tb.drawnBy || "—",
    checkedBy: tb.checkedBy || "—",
    approvedBy: tb.approvedBy || "—",
    pedigree: `${ped.code} ${ped.name}`,
    tolerances: tb.tolerances,
    designHash: data.designHash,
    projectName: project.name,
    exportControl: tb.exportControl,
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Block rectangle in points, and the area under its heading. */
function boxes(b: TemplateBlock, W: number, H: number): { outer: Box; inner: Box; head: number } {
  const outer = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
  const head = b.title && b.kind !== "titleBlock" && b.kind !== "logo" && b.kind !== "text" ? titleH(Math.max(7, b.fontSize + 1)) : 0;
  return { outer, inner: { x: outer.x, y: outer.y + head, w: outer.w, h: Math.max(1, outer.h - head) }, head };
}

const colWidth = (inner: Box, columns: number) => (inner.w - COL_GAP * (columns - 1)) / columns;

function tableGroup(title: string | null, cols: FlowCol[], rows: FlowCell[][], fs: number): FlowGroup {
  const header: FlowItem = { t: "header", cols, h: headerH(fs) };
  const head: FlowItem[] = title ? [{ t: "title", text: title, h: titleH(fs) }, header] : [header];
  const contHead: FlowItem[] = title ? [{ t: "title", text: `${title} (cont.)`, h: titleH(fs) }, header] : [header];
  return { head, contHead, items: rows.map((cells, i) => ({ t: "row", cols, cells, h: rowH(fs), zebra: i % 2 === 1 })) };
}

/** Flow content of a block, as groups of fixed-height items. */
export function flowGroups(b: TemplateBlock, data: DocData, colW: number): FlowGroup[] {
  const fs = b.fontSize;
  const u = data.project.units;
  switch (b.kind) {
    case "notes": {
      const notes = drawingNotes(data);
      const lineH = fs * 1.35;
      return [{ head: [], items: notes.map((text, i) => ({ t: "note", n: i + 1, text, h: estimateLines(text, colW - fs * 2, fs) * lineH + 3 })) }];
    }
    case "connectorTables": {
      const cols: FlowCol[] = [{ label: "Pin", w: 0.6, mono: true }, { label: "Signal", w: 2, mono: true }, { label: "Wire", w: 0.8, mono: true }, { label: "AWG", w: 0.5 }, { label: "Color", w: 1.6 }, { label: "Contact / plug", w: 1.9, mono: true }];
      return data.connectorRows.map((c) => tableGroup(`${c.refDes} — ${c.pn}`, cols, c.rows.map((r) => [r.cavity, r.signal || "spare", r.wire, r.gauge, { codes: r.colorCode, text: r.color }, r.contact]), fs));
    }
    case "wireList": {
      const cols: FlowCol[] = [{ label: "Wire", w: 0.7, mono: true }, { label: "Net", w: 1.6, mono: true }, { label: "From", w: 1, mono: true }, { label: "To", w: 1, mono: true }, { label: "AWG", w: 0.5 }, { label: "Spec", w: 1.1, mono: true }, { label: "Color", w: 1.5 }, { label: `Len (${u})`, w: 0.8, align: "right" }, { label: "Twist", w: 0.5 }, { label: "Shield", w: 0.6 }];
      return [tableGroup(null, cols, data.wireRows.map((w) => [w.id, w.net, w.from, w.to, String(w.gauge), w.spec, { codes: w.colorCode, text: w.color }, fmtLen(w.lengthMm, u).replace(/ (in|mm)$/, ""), w.twist, w.shield]), fs)];
    }
    case "bom": {
      const cols: FlowCol[] = [{ label: "Line", w: 0.4 }, { label: "Part number", w: 2, mono: true }, { label: "Description", w: 3.4 }, { label: "Qty", w: 0.6, align: "right" }, { label: "UoM", w: 0.4 }, { label: "Refs", w: 1.8 }];
      return [tableGroup(null, cols, data.bom.lines.map((l) => [String(l.line), l.pn, l.description, l.uom === "ea" ? String(l.qty) : l.qty.toFixed(2), l.uom, l.refs.slice(0, 12).join(" ") + (l.refs.length > 12 ? " …" : "")]), fs)];
    }
    case "labels": {
      const cols: FlowCol[] = [{ label: "Text", w: 3, mono: true }, { label: "Location", w: 1 }, { label: "Label stock", w: 1.5, mono: true }];
      return [tableGroup(null, cols, data.labelTexts.map((l) => [l.text, l.where, l.pn]), fs)];
    }
    default:
      return [];
  }
}

export interface PagePlan {
  sheet: TemplateSheet;
  /** 0 on a sheet's first page; >0 on continuation pages carrying overflowing tables/notes. */
  cont: number;
  /** Flow block id → its columns on this page. */
  flows: Map<string, FlowItem[][]>;
}

/** Every page of the drawing: each template sheet, plus continuation pages where tables/notes overflow their box. */
export function planTemplatePages(data: DocData, t: DrawingTemplate): PagePlan[] {
  const [W, H] = SHEET_SIZES[t.sheetSize];
  const out: PagePlan[] = [];
  for (const sheet of t.sheets) {
    const packed = new Map<string, FlowItem[][][]>();
    for (const b of sheet.blocks) {
      if (!FLOW_KINDS.includes(b.kind)) continue;
      const { inner } = boxes(b, W, H);
      const cw = colWidth(inner, b.columns);
      packed.set(b.id, packFlow(flowGroups(b, data, cw), inner.h, b.columns));
    }
    const n = Math.max(1, ...[...packed.values()].map((p) => p.length));
    for (let i = 0; i < n; i++) out.push({ sheet, cont: i, flows: new Map([...packed].map(([id, p]) => [id, p[i] ?? []])) });
  }
  return out;
}

function Cell({ text, w, fs, mono, align }: { text: string; w: number; fs: number; mono?: boolean; align?: "left" | "right" }) {
  return <Text style={{ width: w, paddingHorizontal: 2, fontSize: fs, fontFamily: mono ? fontMono() : fontUi(), color: C.text, textAlign: align ?? "left" }}>{fitText(pdfSafe(text), w - 4, fs, mono)}</Text>;
}

function FlowColumn({ items, w, fs, printWire }: { items: FlowItem[]; w: number; fs: number; printWire: (c: number) => string }) {
  return (
    <View style={{ width: w }}>
      {items.map((it, i) => {
        if (it.t === "title") return <Text key={i} style={{ height: it.h, paddingTop: 3, fontSize: fs + 0.5, fontWeight: 600, color: C.text }}>{fitText(pdfSafe(it.text), w, fs + 0.5)}</Text>;
        if (it.t === "note")
          return (
            <View key={i} style={{ height: it.h, flexDirection: "row" }}>
              <Text style={{ width: fs * 2, fontSize: fs, color: C.text }}>{it.n}.</Text>
              <Text style={{ flex: 1, fontSize: fs, lineHeight: 1.35, color: C.text }}>{it.text}</Text>
            </View>
          );
        const total = it.cols.reduce((a, c) => a + c.w, 0);
        const cw = (c: FlowCol) => (w * c.w) / total;
        if (it.t === "header")
          return (
            <View key={i} style={{ height: it.h, flexDirection: "row", alignItems: "center", backgroundColor: C.fill, borderTop: `0.6pt solid ${C.border}`, borderBottom: `0.6pt solid ${C.border}` }}>
              {it.cols.map((c) => (
                <Text key={c.label} style={{ width: cw(c), paddingHorizontal: 2, fontSize: fs - 0.5, fontWeight: 600, color: C.text2, textAlign: c.align ?? "left" }}>{fitText(c.label, cw(c) - 4, fs - 0.5)}</Text>
              ))}
            </View>
          );
        return (
          <View key={i} style={{ height: it.h, flexDirection: "row", alignItems: "center", borderBottom: `0.3pt solid ${C.rule}`, backgroundColor: it.zebra ? "#FAFAFB" : undefined }}>
            {it.cells.map((cell, j) => {
              const c = it.cols[j]!;
              if (typeof cell === "string") return <Cell key={j} text={cell} w={cw(c)} fs={fs} mono={c.mono} align={c.align} />;
              return (
                <View key={j} style={{ width: cw(c), paddingHorizontal: 2, flexDirection: "row", alignItems: "center" }}>
                  {cell.codes.length > 0 && (
                    <View style={{ width: fs * 1.6, height: fs * 0.8, flexDirection: "row", border: `0.4pt solid ${C.text3}`, marginRight: 2 }}>
                      {cell.codes.map((code, k) => (
                        <View key={k} style={{ flex: k === 0 ? 2 : 1, backgroundColor: printWire(code) }} />
                      ))}
                    </View>
                  )}
                  <Text style={{ fontSize: fs - 0.5, fontFamily: fontMono(), color: C.text }}>{fitText(cell.text, cw(c) - fs * 2 - 6, fs - 0.5, true)}</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function Heading({ b, box, cont }: { b: TemplateBlock; box: Box; cont: boolean }) {
  if (!b.title) return null;
  const fs = Math.max(7, b.fontSize + 1);
  return (
    <Text style={{ position: "absolute", left: box.x, top: box.y, width: box.w, fontSize: fs, fontWeight: 600, letterSpacing: 0.4, color: C.text }}>
      {pdfSafe(b.title)}
      {cont ? " (CONT.)" : ""}
    </Text>
  );
}

function TitleBlockView({ b, box, tokens }: { b: TemplateBlock; box: Box; tokens: Record<string, string> }) {
  const total = b.rows.reduce((a, r) => a + r.height, 0) || 1;
  return (
    <View style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, border: `1pt solid ${C.text}`, backgroundColor: "#FFFFFF" }}>
      {b.rows.map((r, ri) => {
        const rowFlex = r.cells.reduce((a, c) => a + c.flex, 0) || 1;
        const rh = (box.h * r.height) / total;
        return (
          <View key={r.id} style={{ height: rh, flexDirection: "row", borderTop: ri ? `0.75pt solid ${C.text}` : undefined }}>
            {r.cells.map((c, ci) => (
              <View key={c.id} style={{ width: (box.w * c.flex) / rowFlex, padding: 2.5, borderLeft: ci ? `0.75pt solid ${C.text}` : undefined, overflow: "hidden" }}>
                {c.label ? <Text style={{ fontSize: 5.5, color: C.text3 }}>{pdfSafe(c.label)}</Text> : null}
                {resolveDrawingTokens(c.value, tokens)
                  .split("\n")
                  .map((line, li) => (
                    <Text key={li} style={{ fontSize: li ? Math.max(5, c.size - 1) : c.size, fontWeight: c.bold && li === 0 ? 600 : 400, fontFamily: c.mono ? fontMono() : fontUi(), color: C.text }}>
                      {pdfSafe(line)}
                    </Text>
                  ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function RevisionBlock({ b, inner, data }: { b: TemplateBlock; inner: Box; data: DocData }) {
  const fs = b.fontSize;
  const cols: FlowCol[] = [{ label: "REV", w: 0.5, mono: true }, { label: "DESCRIPTION", w: 3 }, { label: "DATE", w: 1 }, { label: "STATUS", w: 1 }];
  const all = data.project.revisions.map((r) => [r.label, r.notes || (r.id === data.rev.id && !r.frozen ? "Working draft" : ""), r.frozenAt?.slice(0, 10) ?? "", r.frozen ? "Released" : "Draft"]);
  const fit = Math.max(0, Math.floor((inner.h - headerH(fs)) / rowH(fs)));
  // When space is short, keep the latest revisions.
  const rows = all.slice(Math.max(0, all.length - fit));
  const items: FlowItem[] = [{ t: "header", cols, h: headerH(fs) }, ...rows.map((cells, i): FlowItem => ({ t: "row", cols, cells, h: rowH(fs), zebra: i % 2 === 1 }))];
  return (
    <View style={{ position: "absolute", left: inner.x, top: inner.y }}>
      <FlowColumn items={items} w={inner.w} fs={fs} printWire={data.printWire} />
    </View>
  );
}

/** Frame inset from the sheet edge with zone letters (rows) and numbers (columns) in the margin. */
function Frame({ W, H, m, zones }: { W: number; H: number; m: number; zones: boolean }) {
  if (m <= 0) return null;
  const nx = Math.max(2, Math.round(W / 153));
  const ny = Math.max(2, Math.round(H / 198));
  const fs = Math.min(7, m * 0.6);
  const lab = zones && m >= 8;
  return (
    <View fixed style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
      <View style={{ position: "absolute", left: m, top: m, width: W - 2 * m, height: H - 2 * m, border: `1.2pt solid ${C.text}` }} />
      {lab &&
        Array.from({ length: nx }, (_, i) => {
          const cx = m + ((W - 2 * m) * (i + 0.5)) / nx;
          const label = String(nx - i);
          return [m / 2 - fs / 2, H - m / 2 - fs / 2].map((y, k) => (
            <Text key={`x${i}-${k}`} style={{ position: "absolute", left: cx - 10, top: y, width: 20, textAlign: "center", fontSize: fs, color: C.text2 }}>
              {label}
            </Text>
          ));
        })}
      {lab &&
        Array.from({ length: nx - 1 }, (_, i) => {
          const x = m + ((W - 2 * m) * (i + 1)) / nx;
          return [0, H - m].map((y, k) => <View key={`tx${i}-${k}`} style={{ position: "absolute", left: x, top: y, width: 0.6, height: m, backgroundColor: C.text2 }} />);
        })}
      {lab &&
        Array.from({ length: ny }, (_, j) => {
          const cy = m + ((H - 2 * m) * (j + 0.5)) / ny;
          const label = String.fromCharCode(65 + ny - 1 - j);
          return [0, W - m].map((x, k) => (
            <Text key={`y${j}-${k}`} style={{ position: "absolute", left: x, top: cy - fs / 2, width: m, textAlign: "center", fontSize: fs, color: C.text2 }}>
              {label}
            </Text>
          ));
        })}
      {lab &&
        Array.from({ length: ny - 1 }, (_, j) => {
          const y = m + ((H - 2 * m) * (j + 1)) / ny;
          return [0, W - m].map((x, k) => <View key={`ty${j}-${k}`} style={{ position: "absolute", left: x, top: y, width: m, height: 0.6, backgroundColor: C.text2 }} />);
        })}
    </View>
  );
}

function BlockView({ b, page, W, H, data, template, tokens }: { b: TemplateBlock; page: PagePlan; W: number; H: number; data: DocData; template: DrawingTemplate; tokens: Record<string, string> }) {
  const { outer, inner } = boxes(b, W, H);
  const cont = page.cont > 0;
  const framed = b.frame ? { border: `0.75pt solid ${C.text}` } : {};
  switch (b.kind) {
    case "titleBlock":
      return <TitleBlockView b={b} box={outer} tokens={tokens} />;
    case "logo":
      return (
        <View style={{ position: "absolute", left: outer.x, top: outer.y, width: outer.w, height: outer.h, padding: 4, alignItems: "center", justifyContent: "center", ...framed }}>
          {template.logo ? <Image src={template.logo.dataUrl} style={{ maxWidth: outer.w - 8, maxHeight: outer.h - 8, objectFit: "contain" }} /> : null}
        </View>
      );
    case "text":
      return (
        <View style={{ position: "absolute", left: outer.x, top: outer.y, width: outer.w, height: outer.h, padding: b.frame ? 3 : 0, ...framed }}>
          <Text style={{ fontSize: b.fontSize, fontWeight: b.bold ? 600 : 400, textAlign: b.align, color: C.text, lineHeight: 1.25 }}>{pdfSafe(resolveDrawingTokens(b.text, tokens))}</Text>
        </View>
      );
    case "bundleView":
    case "schematicView":
      if (cont) return null;
      return (
        <>
          <Heading b={b} box={outer} cont={false} />
          <View style={{ position: "absolute", left: inner.x, top: inner.y, width: inner.w, height: inner.h, ...framed }}>
            {b.kind === "bundleView" ? <HarnessDiagram data={data} width={inner.w} height={inner.h} showLengths={b.showLengths} /> : <SchematicDiagram data={data} width={inner.w} height={inner.h} />}
          </View>
        </>
      );
    case "revisionBlock":
      return (
        <>
          <Heading b={b} box={outer} cont={false} />
          <RevisionBlock b={b} inner={inner} data={data} />
        </>
      );
    default: {
      const cols = page.flows.get(b.id) ?? [];
      // A finished table leaves its box empty on continuation pages.
      if (cont && !cols.some((c) => c.length)) return null;
      const cw = colWidth(inner, b.columns);
      return (
        <>
          <Heading b={b} box={outer} cont={cont} />
          <View style={{ position: "absolute", left: inner.x, top: inner.y, width: inner.w, height: inner.h, flexDirection: "row", ...framed }}>
            {cols.map((items, i) => (
              <View key={i} style={{ marginLeft: i ? COL_GAP : 0 }}>
                <FlowColumn items={items} w={cw} fs={b.fontSize} printWire={data.printWire} />
              </View>
            ))}
          </View>
        </>
      );
    }
  }
}

/** Drawing generated from a template: every sheet, its blocks, and continuation pages for long tables. */
export function TemplateDrawingDocument({ data, template }: { data: DocData; template: DrawingTemplate }) {
  const [W, H] = SHEET_SIZES[template.sheetSize];
  const pages = planTemplatePages(data, template);
  const base = drawingTokenValues(data, template);
  const { project } = data;
  return (
    <Document title={`${project.partNumber} Rev ${data.rev.label} Drawing`} author={base.company} creator="Harness Studio" producer="Harness Studio">
      {pages.map((pg, i) => {
        const tokens = { ...base, sheet: String(i + 1), sheets: String(pages.length), sheetName: pg.sheet.name };
        return (
          <Page key={i} size={[W, H]} style={{ fontFamily: fontUi(), color: C.text, fontSize: 8 }}>
            <Frame W={W} H={H} m={template.marginPt} zones={template.zones} />
            {pg.sheet.blocks.map((b) => (
              <BlockView key={b.id} b={b} page={pg} W={W} H={H} data={data} template={template} tokens={tokens} />
            ))}
            <DraftStamp draft={data.draft} />
            <ExportBanner text={project.titleBlock.exportControl} />
          </Page>
        );
      })}
    </Document>
  );
}
