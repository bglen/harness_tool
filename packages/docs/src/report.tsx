import { Document, Page, Text, View } from "@react-pdf/renderer";
import { resolvePedigree, type NetClass } from "@hs/model";
import { opLabel } from "@hs/ops";
import type { DocData } from "./data";
import { C, DEMO_FOOTER, DraftStamp, ExportBanner, fmtLen, fontMono, fontUi, money, pdfSafe, s, Swatch, Table } from "./common";
import { Bar, FaceSvg, HarnessDiagram } from "./diagram";

export const REPORT_SECTIONS = [
  { id: "cover", label: "0 Cover" },
  { id: "summary", label: "1 Executive summary" },
  { id: "overview", label: "2 Design overview" },
  { id: "connectors", label: "3 Connectors" },
  { id: "engineering", label: "4 Engineering details" },
  { id: "components", label: "5 Components & supply chain" },
  { id: "quote", label: "6 Quote" },
  { id: "dfm", label: "7 Manufacturability (DFM)" },
  { id: "rules", label: "8 Design rules" },
  { id: "mfgtest", label: "9 Manufacturing & test" },
  { id: "history", label: "10 Revision history" },
  { id: "appendix", label: "A Appendices" },
] as const;
export type SectionId = (typeof REPORT_SECTIONS)[number]["id"];

const STATUS_TEXT = { ready: "Ready for automated build", manual: "Buildable with manual steps", incomplete: "Needs review: not all checks could be confirmed", notBuildable: "Not buildable" } as const;

/** Deterministic, template-based summary paragraph (not LLM-generated) (§13.2). */
export function autoSummary(data: DocData): string {
  const h = data.rev.harness;
  const n = h.connectors.length;
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const len = data.d.totalWireMm;
  const series = [...new Set(h.connectors.map((c) => data.cat.connector(c.pn)?.series).filter(Boolean))].join("/") || "38999";
  const braid = h.layers.some((l) => l.type === "overbraid") ? "overall braid" : h.layers.length ? "sleeved/taped" : "no overall covering";
  const shields = h.shields.length ? `, ${h.shields.length} individual shield${h.shields.length > 1 ? "s" : ""}` : "";
  const twist = h.twistGroups.length ? `, ${h.twistGroups.length} twisted group${h.twistGroups.length > 1 ? "s" : ""}` : "";
  const longest = Math.max(0, ...h.segments.map((s) => s.lengthMm));
  return `${words[n] ?? n}-connector ${series} harness, ${h.wires.length} wires across ${h.nets.length} nets, ${fmtLen(len, data.project.units, 1)} of wire (longest segment ${fmtLen(longest, data.project.units, 1)}), ${braid}${shields}${twist}. ${STATUS_TEXT[data.dfm.manufacturability.status]}; built as ${data.ped.name}.`;
}

function Section({ title, children, brk = true }: { title: string; children: React.ReactNode; brk?: boolean }) {
  return (
    <View break={brk}>
      <Text style={s.h1}>{title}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "25%", padding: 4 }}>
      <Text style={s.caps}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: 600 }}>{value}</Text>
    </View>
  );
}

/** Audience redaction applied to every section (feedback §7): prices/costs and supply (stock, lead times). */
export interface Redaction {
  pricing?: boolean;
  supply?: boolean;
}

export function ReportDocument({ data, sections, hideQuote: hideQuoteIn, redact = {} }: { data: DocData; sections?: Partial<Record<SectionId, boolean>>; hideQuote?: boolean; redact?: Redaction }) {
  const hideQuote = hideQuoteIn || !!redact.pricing;
  const hideSupply = !!redact.supply;
  const { project, rev, ped, dfm, bom, quote, d } = data;
  const u = project.units;
  const h = rev.harness;
  const on = (id: SectionId) => (id === "quote" && hideQuote ? false : sections?.[id] !== false);
  const sel = project.quote.selected;
  const cell = quote?.cells.find((c) => c.qty === sel.qty && c.tier === sel.tier);
  const tierName = quote?.tiers.find((t) => t.id === sel.tier)?.name ?? sel.tier;
  const asOf = quote ? new Date(quote.asOf).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  const openIssues = dfm.results.filter((r) => r.status === "fail").reduce((a, r) => a + r.violations.length, 0);
  const summary = project.report.summary || autoSummary(data);
  const maxOd = Math.max(0, ...[...d.segOuterOdMm.values()]);
  const status = STATUS_TEXT[dfm.manufacturability.status];
  const stampColor = dfm.manufacturability.status === "ready" ? C.pass : dfm.manufacturability.status === "manual" || dfm.manufacturability.status === "incomplete" ? C.warning : C.error;
  const pageStyle = { padding: 42, paddingBottom: 48, fontFamily: fontUi(), fontSize: 8.5, color: C.text };
  const footer = (priced: boolean) => (
    <View fixed style={{ position: "absolute", bottom: 18, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={s.small}>
        {project.partNumber} Rev {rev.label} · {ped.code} · report {data.designHash}
        {priced && !hideQuote ? ` · ${DEMO_FOOTER}` : ""}
      </Text>
      <Text style={s.small} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
  const byClass = (cls: NetClass) => h.nets.filter((n) => n.cls === cls);
  const catCost = new Map<string, number>();
  for (const l of bom.lines) catCost.set(l.category, (catCost.get(l.category) ?? 0) + l.extCost);
  const catMax = Math.max(1, ...catCost.values());
  const leadRank = [...bom.lines].filter((l) => !l.customerFurnished).sort((a, b) => b.leadDays - a.leadDays).slice(0, 10);
  const powerNets = h.nets.filter((n) => n.currentA);
  const massByCat = new Map<string, number>();
  for (const l of bom.lines) massByCat.set(l.category, (massByCat.get(l.category) ?? 0) + l.massG);
  return (
    <Document title={`${project.partNumber} Rev ${rev.label} Design Report`} author={project.titleBlock.company} creator="Harness Studio" producer="Harness Studio">
      {on("cover") && (
        <Page size="LETTER" style={pageStyle}>
          <DraftStamp draft={data.draft} />
          <ExportBanner text={project.titleBlock.exportControl} />
          <View style={{ height: 6, backgroundColor: data.pedigreeColor, marginBottom: 60 }} />
          <Text style={s.caps}>Design report</Text>
          <Text style={{ fontSize: 26, fontWeight: 600, marginTop: 6 }}>{project.titleBlock.title || project.name}</Text>
          <Text style={{ fontSize: 13, marginTop: 6, fontFamily: fontMono() }}>
            {project.partNumber} · Rev {rev.label}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16 }}>
            <View style={{ width: 10, height: 10, backgroundColor: data.pedigreeColor, marginRight: 6, transform: "rotate(45deg)" }} />
            <Text style={{ fontSize: 13, fontWeight: 600 }}>
              {ped.name} ({ped.code})
            </Text>
          </View>
          <View style={{ marginTop: 40, border: `1.5pt solid ${stampColor}`, padding: 10, width: 300 }}>
            <Text style={{ fontSize: 12, fontWeight: 600, color: stampColor }}>
              DFM: {dfm.manufacturability.errors} errors — {status.toLowerCase()}
            </Text>
            <Text style={s.small}>
              Design rules: {dfm.design.errors} errors, {dfm.design.warnings} warnings
            </Text>
          </View>
          <View style={{ marginTop: "auto" }}>
            <Text style={s.p}>
              {project.titleBlock.company} · Author {project.titleBlock.drawnBy || "—"} · Generated {new Date(data.generatedAt).toLocaleString("en-US")}
            </Text>
            <Text style={s.small}>
              Report ID {data.designHash}-{rev.label} · design hash {data.designHash}
            </Text>
          </View>
        </Page>
      )}
      <Page size="LETTER" style={pageStyle} wrap>
        <DraftStamp draft={data.draft} />
        <ExportBanner text={project.titleBlock.exportControl} />
        {footer(true)}
        {on("summary") && (
          <Section title="1 Executive summary" brk={false}>
            <Text style={{ ...s.p, fontSize: 9.5, color: C.text }}>{summary}</Text>
            <HarnessDiagram data={data} width={528} height={220} showLengths={false} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
              <Metric label="Connectors" value={String(h.connectors.length)} />
              <Metric label="Wires / nets" value={`${h.wires.length} / ${h.nets.length}`} />
              <Metric label="Total wire" value={fmtLen(d.totalWireMm, u, 1)} />
              <Metric label="Est. weight" value={`${Math.round(bom.massG)} g`} />
              <Metric label="Max bundle OD" value={fmtLen(maxOd, u, u === "in" ? 2 : 1)} />
              <Metric label="Open issues" value={String(openIssues)} />
              {!hideQuote && <Metric label={`Unit price, ${sel.qty} units`} value={cell ? money(cell.unit) : "—"} />}
              <Metric label="Est. ship date" value={cell?.shipDate ?? "—"} />
            </View>
            <View style={{ flexDirection: "row", marginTop: 8 }}>
              <View style={{ flex: 1, border: `0.75pt solid ${C.border}`, padding: 6, marginRight: 6 }}>
                <Text style={s.caps}>Manufacturability (against {ped.name})</Text>
                <Text style={{ fontSize: 10, fontWeight: 600, color: stampColor }}>{status}</Text>
                <Text style={s.small}>
                  {dfm.manufacturability.checks} checks · {dfm.manufacturability.errors} errors · {dfm.manufacturability.warnings} warnings · {dfm.manufacturability.infos} info (per machine profile {data.profile.version})
                </Text>
              </View>
              <View style={{ flex: 1, border: `0.75pt solid ${C.border}`, padding: 6 }}>
                <Text style={s.caps}>Design rules</Text>
                <Text style={{ fontSize: 10, fontWeight: 600 }}>{dfm.design.errors || dfm.design.warnings ? `${dfm.design.errors} errors · ${dfm.design.warnings} warnings` : `${dfm.design.passed} checks passed`}</Text>
                <Text style={s.small}>{dfm.design.rulesets.join(" · ") || "No team or project rules"}</Text>
              </View>
            </View>
            {!hideQuote && cell && (
              <Text style={{ ...s.p, marginTop: 6 }}>
                Quote: {money(cell.unit)} per unit, {money(cell.total)} for {sel.qty} units, {tierName} lead time, ships {cell.shipDate}. Valid until {quote!.validUntil}. Prices and stock as of {asOf} (demo data).{quote!.state === "needsReview" ? " Estimate. Final price on order confirmation." : ""}
                {quote!.criticalPart ? ` Critical-path part: ${quote!.criticalPart.pn} (${quote!.criticalPart.leadDays} days).` : ""}
              </Text>
            )}
          </Section>
        )}
        {on("overview") && (
          <Section title="2 Design overview">
            <HarnessDiagram data={data} width={528} height={300} />
            <Text style={s.h2}>Topology</Text>
            <Table
              cols={[{ label: "Segment", w: 1.2 }, { label: "Length", w: 1, align: "right" }, { label: "Tol.", w: 0.8, align: "right" }, { label: "Wires", w: 0.6, align: "right" }, { label: "Bundle OD", w: 1, align: "right" }, { label: "Coverings", w: 3 }]}
              rows={h.segments.map((sg) => {
                const name = (nid: string) => {
                  const n = h.nodes.find((x) => x.id === nid)!;
                  return n.kind === "connector" ? h.connectors.find((c) => c.id === n.connectorId)?.refDes ?? "?" : `B${h.nodes.filter((x) => x.kind === "breakout").indexOf(n) + 1}`;
                };
                return [sg.label || `${name(sg.a)}–${name(sg.b)}`, fmtLen(sg.lengthMm, u), fmtLen(sg.toleranceMm, u), d.segWires.get(sg.id)?.length ?? 0, fmtLen(d.segOuterOdMm.get(sg.id) ?? 0, u, u === "in" ? 3 : 1), (d.segStack.get(sg.id) ?? []).map((l) => data.cat.layer(l.layer.pn)?.description ?? l.layer.type).join(" / then ") || "—"];
              })}
            />
            {h.splices.length > 0 && <Text style={s.p}>Splices: {h.splices.map((sp) => `${sp.label} (${sp.type}, ${sp.pn}) for ${h.nets.find((n) => n.id === sp.netId)?.name}`).join("; ")}.</Text>}
            {!!project.report.designNotes && (
              <>
                <Text style={s.h2}>Design notes</Text>
                <Text style={s.p}>{project.report.designNotes}</Text>
              </>
            )}
          </Section>
        )}
        {on("connectors") && (
          <Section title="3 Connectors">
            {h.connectors.map((c, idx) => {
              const part = data.cat.connector(c.pn);
              const rows = data.connectorRows.find((r) => r.refDes === c.refDes)?.rows ?? [];
              const mate = part ? c.pn.replace(/([A-HJ]\d{1,3})([PS])([NABCDE])/, (_m, a, g, k) => `${a}${g === "P" ? "S" : "P"}${k}`).replace(/\/(26)/, "/20") : "";
              return (
                <View key={c.id} break={idx > 0} wrap>
                  <Text style={s.h2}>
                    {c.refDes} <Text style={{ fontFamily: fontMono(), fontSize: 10 }}>{c.pn}</Text>
                  </Text>
                  <Text style={s.p}>
                    {part?.description}. Backshell {c.backshell ? `${c.backshell.pn}` : "none"}; accessories {c.accessories.map((a) => a.pn).join(", ") || "none"}; sealing plugs {rows.filter((r) => !r.signal).length}. Mating connector reference: {mate || "—"}.
                    {part && part.arrangement.status !== "verified" ? " Insert geometry is machine-extracted (unreviewed)." : ""}
                  </Text>
                  <View style={{ flexDirection: "row" }}>
                    {part && (
                      <View style={{ width: 170, alignItems: "center" }}>
                        <FaceSvg arr={part.arrangement} gender={part.gender} c={c} h={h} size={150} />
                        <Text style={s.small}>Face view ({part.gender} side), cavities colored by net class:</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: 2 }}>
                          {(
                            [
                              ["power", "#C4234F"],
                              ["ground", "#16181D"],
                              ["signal", "#0B7F92"],
                              ["RF", "#7A3CC2"],
                              ["spare", "#FFFFFF"],
                            ] as const
                          ).map(([l, col]) => (
                            <View key={l} style={{ flexDirection: "row", alignItems: "center", marginRight: 5 }}>
                              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col, border: `0.5pt solid ${C.text3}`, marginRight: 2 }} />
                              <Text style={s.small}>{l}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Table cols={[{ label: "Pin", w: 0.5, mono: true }, { label: "Signal", w: 2, mono: true }, { label: "Wire", w: 0.7, mono: true }, { label: "AWG", w: 0.5 }, { label: "Color", w: 1.8 }]} rows={rows.map((r) => [r.cavity, r.signal || "spare", r.wire, r.gauge, <Swatch key="s" codes={r.colorCode} text={r.color} wire={data.printWire} />])} />
                    </View>
                  </View>
                </View>
              );
            })}
          </Section>
        )}
        {on("engineering") && (
          <Section title="4 Engineering details">
            <Text style={s.h2}>Nets by class</Text>
            {(["power", "ground", "signal", "rf", "spare"] as NetClass[]).map((cls) => byClass(cls).length > 0 && <Text key={cls} style={s.p}>{`${cls.toUpperCase()} (${byClass(cls).length}): ${byClass(cls).map((n) => n.name).join(", ")}`}</Text>)}
            <Text style={s.h2}>Wire summary</Text>
            <Table cols={[{ label: "Spec", w: 1.2, mono: true }, { label: "AWG", w: 0.5 }, { label: "Wires", w: 0.5, align: "right" }, { label: "Length", w: 1, align: "right" }]} rows={[...new Set(h.wires.map((w) => `${w.spec}|${w.gauge}`))].map((k) => { const [spec, g] = k.split("|"); const ws = h.wires.filter((w) => w.spec === spec && w.gauge === Number(g)); return [spec!, g!, ws.length, fmtLen(ws.reduce((a, w) => a + (d.wireLengthMm.get(w.id) ?? 0), 0), u, 1)]; })} />
            {(h.twistGroups.length > 0 || h.shields.length > 0) && (
              <>
                <Text style={s.h2}>Twisted pairs and shields</Text>
                {h.twistGroups.map((g, i) => <Text key={g.id} style={s.p}>{`TW${i + 1}: ${g.wireIds.map((id) => h.nets.find((n) => n.id === h.wires.find((w) => w.id === id)?.netId)?.name).join(" / ")}`}</Text>)}
                {h.shields.map((sh) => <Text key={sh.id} style={s.p}>{`${sh.label} (${sh.material}, ${sh.coverage}%): ${h.terminations.filter((t) => t.targetId === sh.id).map((t) => `${h.connectors.find((c) => c.id === h.nodes.find((n) => n.id === t.nodeId)?.connectorId)?.refDes ?? "breakout"} ${t.method}`).join(", ")}`}</Text>)}
              </>
            )}
            <Text style={s.h2}>Bundle diameter vs backshell clamp range</Text>
            <Table cols={[{ label: "Connector", w: 0.8 }, { label: "Backshell", w: 1.5, mono: true }, { label: "Clamp range", w: 1.2 }, { label: "Bundle OD", w: 1 }, { label: "Bend radius needed", w: 1.2 }]} rows={h.connectors.map((c) => { const bs = c.backshell && data.cat.backshell(c.backshell.pn); const node = h.nodes.find((n) => n.connectorId === c.id); const od = (node && d.nodeOdMm.get(node.id)) ?? 0; return [c.refDes, c.backshell?.pn ?? "—", bs ? `${fmtLen(bs.clampMinMm, u)}–${fmtLen(bs.clampMaxMm, u)}` : "—", fmtLen(od, u, u === "in" ? 3 : 1), fmtLen(od * (ped.process.bendRadiusMultiple ?? 6), u)]; })} />
            <Text style={s.h2}>Weight breakdown ({Math.round(bom.massG)} g)</Text>
            {[...massByCat].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]).map(([c, m]) => (
              <View key={c} style={{ flexDirection: "row", alignItems: "center", marginBottom: 1 }}>
                <Text style={{ width: 90, fontSize: 7.5 }}>{c}</Text>
                <Bar w={(m / bom.massG) * 300} h={6} fill={C.accent} />
                <Text style={{ fontSize: 7.5, marginLeft: 4 }}>{m.toFixed(1)} g</Text>
              </View>
            ))}
            {powerNets.length > 0 && (
              <>
                <Text style={s.h2}>Derating and voltage drop (power nets)</Text>
                <Table cols={[{ label: "Net", w: 1.3, mono: true }, { label: "Current", w: 0.7, align: "right" }, { label: "Wire", w: 1.2 }, { label: "Rating", w: 0.7, align: "right" }, { label: "Length", w: 0.8, align: "right" }, { label: "Drop (one way)", w: 1, align: "right" }]} rows={powerNets.flatMap((n) => h.wires.filter((w) => w.netId === n.id).map((w) => { const ws = data.cat.wire(w.spec, w.gauge); const L = d.wireLengthMm.get(w.id) ?? 0; const vd = ws ? (n.currentA! * ws.ohmPerKm * L) / 1e6 : 0; return [n.name, `${n.currentA} A`, `${w.gauge} AWG ${w.spec}`, ws ? `${ws.currentA} A` : "—", fmtLen(L, u, 1), `${(vd * 1000).toFixed(0)} mV`]; }))} />
                <Text style={s.small}>Resistance per length from catalog wire data (seed values); rating is single wire in free air.</Text>
              </>
            )}
            <Text style={s.h2}>Materials and finish</Text>
            <Text style={s.p}>{h.connectors.map((c) => data.cat.connector(c.pn)).filter((p) => p?.finishInfo.cadmium).length ? `Cadmium-plated shells used: ${h.connectors.filter((c) => data.cat.connector(c.pn)?.finishInfo.cadmium).map((c) => c.refDes).join(", ")} (restricted for many programs; RoHS/REACH relevant).` : "No cadmium-plated shells."}</Text>
          </Section>
        )}
        {on("components") && (
          <Section title="5 Components & supply chain">
            <Text style={s.p}>
              {bom.lines.length} BOM lines.{hideQuote ? "" : ` Material cost ${money(bom.materialCost)} per unit at ${sel.qty} units.`}
              {hideQuote && hideSupply ? "" : ` Supply data as of ${bom.asOfRange.oldest}${bom.asOfRange.newest !== bom.asOfRange.oldest ? ` to ${bom.asOfRange.newest}` : ""} (demo data).`}
            </Text>
            {!hideQuote &&
              [...catCost].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                <View key={c} style={{ flexDirection: "row", alignItems: "center", marginBottom: 1 }}>
                  <Text style={{ width: 90, fontSize: 7.5 }}>{c}</Text>
                  <Bar w={(v / catMax) * 300} h={6} fill={C.accent} />
                  <Text style={{ fontSize: 7.5, marginLeft: 4 }}>{money(v)}</Text>
                </View>
              ))}
            {!hideSupply && (
              <>
                <Text style={s.h2}>Lead-time analysis</Text>
                <Text style={s.p}>{bom.criticalPath ? `Critical path at ${sel.qty} units: ${bom.criticalPath.pn} (${bom.criticalPath.stock} in stock, ${bom.criticalPath.leadDays} days).` : `Stock covers ${sel.qty} units for every line.`}</Text>
                <Table cols={[{ label: "Part number", w: 2, mono: true }, { label: "Lead", w: 0.6, align: "right" }, { label: "Stock", w: 0.6, align: "right" }, { label: "Covers order", w: 0.7 }, { label: "Lifecycle", w: 0.8 }, { label: "Alternate", w: 2, mono: true }]} rows={leadRank.map((l) => [l.pn, `${l.leadDays} d`, l.stock, l.stockSufficient ? "yes" : "no", l.lifecycle, l.alternates[0] ? `${l.alternates[0].alternate} (${l.alternates[0].relationship})` : "—"])} />
              </>
            )}
            {bom.lines.some((l) => l.customerFurnished) && <Text style={s.p}>Customer-furnished: {bom.lines.filter((l) => l.customerFurnished).map((l) => l.pn).join(", ")}.</Text>}
          </Section>
        )}
        {on("quote") && quote && (
          <Section title="6 Quote">
            {quote.state === "needsReview" && <Text style={{ ...s.p, color: C.warning, fontWeight: 600 }}>Estimate. Final price on order confirmation. {quote.reason}</Text>}
            <Table cols={[{ label: "Lead time", w: 1.2 }, ...quote.quantities.map((q) => ({ label: `${q} pcs`, w: 1, align: "right" as const }))]} rows={quote.tiers.map((t) => [`${t.name} (${t.days} d)`, ...quote.quantities.map((q) => { const c = quote.cells.find((x) => x.qty === q && x.tier === t.id); return c ? `${money(c.unit)} / ${money(c.total, 0)}` : "—"; })])} />
            {cell && (
              <>
                <Text style={s.h2}>Price breakdown ({sel.qty} units, {tierName})</Text>
                <Table cols={[{ label: "Item", w: 3 }, { label: "Per unit", w: 1, align: "right" }]} rows={[["Materials", money(cell.breakdown.materials)], ["Machine time", money(cell.breakdown.machine)], ["Manual operations", money(cell.breakdown.manual)], [`Inspection & test (${ped.name})`, money(cell.breakdown.inspection)], ...cell.breakdown.inspectionItems.map((i) => [`   ${i.name} (${i.sampling})`, money(i.amount)]), [`Setup / NRE ${money(cell.breakdown.nre, 0)} amortized over ${sel.qty}`, money(cell.breakdown.nrePerUnit)], ["Unit price", money(cell.unit)]]} />
              </>
            )}
            <Text style={s.p}>Quote valid until {quote.validUntil}; generated {asOf}. Assumptions: demo rates (Phase 1), standard packaging, FOB origin, pedigree requirements as listed in section 9.</Text>
          </Section>
        )}
        {on("dfm") && (
          <Section title="7 Manufacturability (DFM) report">
            <Text style={s.p}>{status}. Checked against {ped.name} with machine profile {data.profile.version}: {dfm.manufacturability.checks} checks, {dfm.manufacturability.errors} errors, {dfm.manufacturability.warnings} warnings, {dfm.manufacturability.infos} info.</Text>
            <Table cols={[{ label: "Rule", w: 1, mono: true }, { label: "Severity", w: 0.6 }, { label: "Message", w: 4 }]} rows={dfm.results.filter((r) => r.eff.source.layer === "manufacturer" && r.status === "fail").flatMap((r) => r.violations.map((v) => [r.eff.rule.id, r.eff.severity, v.message]))} />
            {dfm.results.some((r) => r.waived.length) && (
              <>
                <Text style={s.h2}>Waivers</Text>
                {dfm.results.flatMap((r) =>
                  r.waived.map((w) => (
                    <Text key={w.waiverId} style={s.p}>{`${r.eff.rule.id} ${r.eff.rule.title}: ${w.message} Waived by ${w.author || "unknown engineer"} on ${w.date}: “${w.note}”${w.changed ? " (finding changed since waived: re-assess)" : ""}`}</Text>
                  )),
                )}
              </>
            )}
            <Text style={s.h2}>Operations</Text>
            <Text style={s.p}>{data.ops.automatedCount} automated and {data.ops.manualCount} manual operations{data.ops.cureHours ? `; ${data.ops.cureHours} h potting cure` : ""}.</Text>
            {data.ops.manualReasons.map((r) => <Text key={r} style={s.p}>• {r}</Text>)}
            <Table cols={[{ label: "Operation", w: 2 }, { label: "Qty", w: 0.6, align: "right" }, { label: "Mode", w: 0.8 }]} rows={data.ops.ops.map((o) => [o.kind === "inspection" ? data.inspections.find((i) => i.id === o.inspectionId)?.name ?? "Inspection" : opLabel(o.kind), o.kind.endsWith("PerM") ? `${o.qty} m` : o.qty, o.automated ? "automated" : "manual"])} />
          </Section>
        )}
        {on("rules") && (
          <Section title="8 Design rules report">
            <Text style={s.p}>Applied rulesets: {project.rulesets.map((r) => `${r.name} v${r.version}${r.enforced ? " (enforced)" : ""}`).join(", ") || "none"}; {project.projectRules.length} project rules; pedigree requirements for {ped.name}.</Text>
            {dfm.results.some((r) => r.eff.source.layer !== "manufacturer") ? (
              <Table cols={[{ label: "Rule", w: 1, mono: true }, { label: "Source", w: 1.4 }, { label: "Title", w: 2.4 }, { label: "Result", w: 0.8 }]} rows={dfm.results.filter((r) => r.eff.source.layer !== "manufacturer").map((r) => [r.eff.rule.id, r.eff.source.name, r.eff.rule.title, r.status === "fail" ? `${r.violations.length} ${r.eff.severity}` : r.status])} />
            ) : (
              <Text style={s.p}>No team rulesets, project rules or pedigree process rules apply to this design. Only the Manufacturer rules (section 7) were evaluated.</Text>
            )}
            {project.overrides.length > 0 && <Text style={s.p}>Project overrides: {project.overrides.map((o) => `${o.ruleId}${o.enabled === false ? " disabled" : ""}${o.severity ? ` → ${o.severity}` : ""}${o.note ? ` (${o.note})` : ""}`).join("; ")}.</Text>}
          </Section>
        )}
        {on("mfgtest") && (
          <Section title="9 Manufacturing & test">
            <Text style={s.p}>Workmanship: {ped.workmanship}.</Text>
            <Table cols={[{ label: "Inspection / test", w: 2 }, { label: "Sampling", w: 1 }, { label: "Parameters", w: 2.5 }, { label: "Where", w: 0.8 }]} rows={ped.inspections.map((i) => { const t = data.inspections.find((x) => x.id === i.typeId); return [t?.name ?? i.typeId, i.sampling, pdfSafe(Object.entries(i.params).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${t?.params.find((p) => p.key === k)?.label ?? k} ${v}${t?.params.find((p) => p.key === k)?.unit ? " " + t!.params.find((p) => p.key === k)!.unit : ""}`).join(", ") || "—"), t?.inHouse ? "in-house" : "outsourced"]; })} />
            <Text style={s.p}>Parts policy: {[ped.partsPolicy.qplOnly && "QPL/approved parts only", ped.partsPolicy.noAlternates && "no alternates without approval", ped.partsPolicy.authorizedDistributionOnly && "authorized distribution only", ped.partsPolicy.bannedFinishes?.length && `banned shell classes ${ped.partsPolicy.bannedFinishes.join("/")}`, ped.partsPolicy.dateCodeMaxYears && `date codes at most ${ped.partsPolicy.dateCodeMaxYears} years old`].filter(Boolean).join("; ") || "standard"}.</Text>
            <Text style={s.p}>Process: {[ped.process.noSplices && "no splices", ped.process.noPotting && "no potting", ped.process.noManualRework && "no manual rework", ped.process.serializedLabels && "serialized labels", ped.process.doubleBandClamps && "double band clamps", ped.process.bendRadiusMultiple && `bend radius at least ${ped.process.bendRadiusMultiple}× OD`, ped.process.minBraidCoverage && `braid coverage at least ${ped.process.minBraidCoverage}%`].filter(Boolean).join("; ") || "standard"}.</Text>
            <Text style={s.p}>Deliverables: {ped.documentation.join(", ") || "—"}. Markings: {ped.markings.map((m) => m.text).join(", ") || "—"}.</Text>
            <Text style={s.h2}>Pedigree comparison</Text>
            <Table cols={[{ label: "Pedigree", w: 1.2 }, { label: "Workmanship", w: 2 }, { label: "Inspections", w: 3 }]} rows={[...project.pedigreeScheme.pedigrees].sort((a, b) => a.rank - b.rank).map((p) => { const r = resolvePedigree(project.pedigreeScheme, p.id); return [`${p.code} ${p.name}`, r.workmanship, r.inspections.map((i) => `${data.inspections.find((t) => t.id === i.typeId)?.name ?? i.typeId} ${i.sampling}`).join(", ")]; })} />
          </Section>
        )}
        {on("history") && (
          <Section title="10 Revision history">
            <Table cols={[{ label: "Rev", w: 0.4 }, { label: "Status", w: 1 }, { label: "Date", w: 1 }, { label: "Notes", w: 4 }]} rows={project.revisions.map((r) => [r.label, r.frozen ? "frozen" : "working draft", r.frozenAt?.slice(0, 10) ?? "", r.notes || "—"])} />
            <Text style={s.small}>Change summaries between revisions arrive in Phase 2.</Text>
          </Section>
        )}
        {on("appendix") && (
          <Section title="Appendix A — wire list, BOM, checks with no findings, metadata">
            <Table cols={[{ label: "Wire", w: 0.6, mono: true }, { label: "Net", w: 1.5, mono: true }, { label: "From", w: 0.9, mono: true }, { label: "To", w: 0.9, mono: true }, { label: "AWG", w: 0.4 }, { label: "Color", w: 1.6 }, { label: "Length", w: 0.8, align: "right" }]} rows={data.wireRows.map((w) => [w.id, w.net, w.from, w.to, w.gauge, <Swatch key="s" codes={w.colorCode} text={w.color} wire={data.printWire} />, fmtLen(w.lengthMm, u)])} />
            <Text style={s.h2}>BOM</Text>
            <Table cols={[{ label: "#", w: 0.3 }, { label: "Part number", w: 1.8, mono: true }, { label: "Description", w: 3 }, { label: "Qty", w: 0.5, align: "right" }, { label: "UoM", w: 0.4 }, ...(hideQuote ? [] : [{ label: "Ext. (demo)", w: 0.8, align: "right" as const }])]} rows={bom.lines.map((l) => [l.line, l.pn, l.description, l.uom === "ea" ? l.qty : (Math.ceil(l.qty * 1000 - 1e-9) / 1000).toFixed(3), l.uom, ...(hideQuote ? [] : [money(l.extCost)])])} />
            <Text style={s.h2}>Checks with no findings</Text>
            <Text style={s.small}>Each check is named by the problem it looks for; none of these problems were found.</Text>
            <Text style={{ ...s.small, lineHeight: 1.4 }}>{dfm.results.filter((r) => r.status === "pass").map((r) => `${r.eff.rule.id} ${r.eff.rule.title}`).join(" · ")}</Text>
            <Text style={s.h2}>Report metadata</Text>
            <Text style={s.p}>Tool Harness Studio {data.toolVersion} · machine profile {data.profile.version} · catalog {data.cat.version.hash} ({data.cat.version.date}) · rulesets {project.rulesets.map((r) => `${r.id}@${r.version}`).join(", ") || "none"} · pedigree scheme {project.pedigreeScheme.name} v{project.pedigreeScheme.version} · design hash {data.designHash} · generated {data.generatedAt}.</Text>
          </Section>
        )}
      </Page>
    </Document>
  );
}
