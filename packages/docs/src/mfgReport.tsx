import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { DocData } from "./data";
import { C, ExportBanner, fontMono, fontUi, pdfSafe, s, Table } from "./common";
import { DOC_COC, DOC_FAI, DOC_LOT, DOC_MATCERT, DOC_SERIAL, DOC_SOURCE, DOC_TDP, type SimulatedBuild } from "./mfgSim";

/**
 * Example manufacturing report: the record a manufacturer ships with a lot of harnesses (certificate, inspection
 * results, detailed test data, traceability), built from the design, the pedigree the lot was built to and the order.
 * Every page says the data is simulated.
 */

const MAKER = "Example Harness Manufacturing Co.";
const SIM_BANNER = "EXAMPLE — SIMULATED DATA. Not a record of a real build or test.";

function Banner() {
  return (
    <Text fixed style={{ position: "absolute", top: 14, left: 42, right: 42, textAlign: "center", fontSize: 7.5, fontWeight: 600, color: C.warning, letterSpacing: 0.5 }}>
      {SIM_BANNER}
    </Text>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 2 }}>
      <Text style={{ width: 120, fontSize: 8, color: C.text3 }}>{k}</Text>
      <Text style={{ flex: 1, fontSize: 8.5, fontFamily: mono ? fontMono() : fontUi() }}>{v}</Text>
    </View>
  );
}

function Signature({ role, name, date }: { role: string; name: string; date: string }) {
  return (
    <View style={{ width: "31%", marginTop: 18 }}>
      <Text style={{ fontSize: 9, fontFamily: fontUi(), color: C.text2, marginBottom: 2 }}>{name}</Text>
      <View style={{ borderTop: `0.75pt solid ${C.text3}`, paddingTop: 2 }}>
        <Text style={s.small}>
          {role} · {date}
        </Text>
      </View>
    </View>
  );
}

export function MfgReportDocument({ data, sim }: { data: DocData; sim: SimulatedBuild }) {
  const { project, rev } = data;
  const { order, ped } = sim;
  const reportNo = `MR-${order.workOrder}`;
  const has = (d: string) => sim.docs.includes(d);
  const pageStyle = { padding: 42, paddingTop: 34, paddingBottom: 48, fontFamily: fontUi(), fontSize: 8.5, color: C.text };
  const footer = (
    <View fixed style={{ position: "absolute", bottom: 18, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={s.small}>
        {MAKER} · {reportNo} · {project.partNumber} Rev {rev.label} · {ped.code} · PO {order.po}
      </Text>
      <Text style={s.small} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
  const serialRange = sim.serials.length > 1 ? `${sim.serials[0]!.serial} – ${sim.serials[sim.serials.length - 1]!.serial}` : sim.serials[0]!.serial;
  const qa = sim.serials[0]!.inspector;
  return (
    <Document title={`${reportNo} Manufacturing Report (example)`} author={MAKER} creator="Harness Studio" producer="Harness Studio">
      <Page size="LETTER" style={pageStyle}>
        <Banner />
        <ExportBanner text={project.titleBlock.exportControl} />
        {footer}
        <View style={{ height: 6, backgroundColor: data.pedigreeColor, marginBottom: 18 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={s.caps}>{MAKER}</Text>
            <Text style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>Manufacturing & Test Report</Text>
            <Text style={{ fontSize: 11, marginTop: 4, fontFamily: fontMono() }}>{reportNo}</Text>
          </View>
          <View style={{ border: `1.5pt solid ${C.pass}`, padding: 8, alignItems: "center", width: 130 }}>
            <Text style={{ fontSize: 14, fontWeight: 600, color: C.pass }}>LOT ACCEPTED</Text>
            <Text style={s.small}>{sim.inspections.length} inspections passed</Text>
          </View>
        </View>
        <Text style={s.h2}>Product</Text>
        <KV k="Part number" v={`${project.partNumber} Rev ${rev.label}`} mono />
        <KV k="Description" v={project.titleBlock.title || project.name} />
        <KV k="Drawing" v={`${project.titleBlock.drawingNumber || project.partNumber} Rev ${rev.label} · design hash ${data.designHash}`} mono />
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={{ width: 120, fontSize: 8, color: C.text3 }}>Built to pedigree</Text>
          <View style={{ width: 7, height: 7, backgroundColor: data.pedigreeColor, marginRight: 4, transform: "rotate(45deg)" }} />
          <Text style={{ fontSize: 8.5, fontWeight: 600 }}>
            {ped.name} ({ped.code})
          </Text>
        </View>
        <KV k="Workmanship" v={ped.workmanship || "IPC/WHMA-A-620"} />
        <Text style={s.h2}>Order</Text>
        <KV k="Customer" v={order.customer} />
        <KV k="Customer PO" v={order.po} mono />
        <KV k="Work order" v={order.workOrder} mono />
        <KV k="Quantity" v={`${order.qty} (serials ${serialRange})`} />
        <KV k="Final test completed" v={order.buildDate} />
        <Text style={s.h2}>Documents in this package</Text>
        {[DOC_COC, "Inspection summary", ...(sim.testDataPackage ? [DOC_TDP] : []), ...[DOC_FAI, DOC_MATCERT, DOC_LOT, DOC_SERIAL, DOC_SOURCE].filter(has), "Test equipment and calibration"].map((d) => (
          <Text key={d} style={{ fontSize: 8.5, marginBottom: 1.5 }}>
            •  {d}
            {d === DOC_TDP && !ped.documentation.includes(DOC_TDP) ? "  (requested on the order)" : ""}
          </Text>
        ))}
        {!sim.testDataPackage && (
          <Text style={{ ...s.p, marginTop: 4 }}>
            The {ped.code} pedigree doesn't call for a test data package, so this report lists results by inspection. The manufacturer keeps the measured values and supplies them on request (or add "{DOC_TDP}" to the order).
          </Text>
        )}

        <View break>
          <Text style={s.h1}>Certificate of Conformance</Text>
          <Text style={{ ...s.p, fontSize: 9.5, color: C.text, lineHeight: 1.5 }}>
            {MAKER} certifies that the {order.qty} harness{order.qty === 1 ? "" : "es"} listed below, part number {project.partNumber} Rev {rev.label}, were manufactured, inspected and tested in accordance with drawing {project.titleBlock.drawingNumber || project.partNumber} Rev {rev.label}, the {ped.name} ({ped.code}) pedigree requirements and customer purchase order {order.po}, and conform in all respects to those requirements. Workmanship meets {ped.workmanship || "IPC/WHMA-A-620"}. Records supporting this certification are on file and available for review.
          </Text>
          <Table
            cols={[{ label: "Serial", w: 1, mono: true }, { label: "Completed", w: 1 }, { label: "Assembled by", w: 1.2 }, { label: "Inspected by", w: 1.2 }, { label: "Tested by", w: 1.2 }, { label: "Status", w: 0.8 }]}
            rows={sim.serials.map((x) => [x.serial, x.built, x.assembler, x.inspector, x.tester, "Accepted"])}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Signature role="Quality Assurance" name={qa} date={order.buildDate} />
            <Signature role="Production" name={sim.serials[0]!.assembler} date={order.buildDate} />
            {has(DOC_SOURCE) ? <Signature role="Customer source inspection" name="(customer QA representative)" date={order.buildDate} /> : <View style={{ width: "31%" }} />}
          </View>
        </View>

        <View break>
          <Text style={s.h1}>Inspection summary</Text>
          <Text style={s.p}>Inspections required by the {ped.code} pedigree, with the sampling and limits it sets.</Text>
          <Table
            fontSize={7.5}
            cols={[{ label: "Inspection", w: 1.1 }, { label: "Sampling", w: 0.9 }, { label: "Acceptance criterion", w: 2.6 }, { label: "Units / samples tested", w: 1.6 }, { label: "Result", w: 0.5 }]}
            rows={sim.inspections.map((r) => [r.name, r.sampling, pdfSafe(r.criterion), r.tested, r.result])}
          />
          {!sim.inspections.length && <Text style={s.p}>This pedigree specifies no inspections.</Text>}
        </View>
      </Page>

      {sim.testDataPackage && (
        <Page size="LETTER" style={pageStyle} wrap>
          <Banner />
          <ExportBanner text={project.titleBlock.exportControl} />
          {footer}
          <Text style={s.h1}>Test data package</Text>
          {sim.inspections.map((r, i) => (
            <View key={r.typeId} break={i > 0}>
              <Text style={s.h2}>
                {i + 1}. {r.name}
              </Text>
              <KV k="Sampling" v={`${r.sampling}: ${r.tested}`} />
              <KV k="Criterion" v={pdfSafe(r.criterion)} />
              {r.equipment && <KV k="Equipment" v={r.equipment} />}
              {r.sections.map((sec) => (
                <View key={sec.title}>
                  <Text style={s.h3}>{sec.title}</Text>
                  <Table cols={sec.table.cols} rows={sec.table.rows} fontSize={6.8} />
                </View>
              ))}
              <Text style={{ fontSize: 8, fontWeight: 600, color: C.pass, marginTop: 4 }}>Result: {r.result}</Text>
            </View>
          ))}
        </Page>
      )}

      {(has(DOC_FAI) || has(DOC_MATCERT) || has(DOC_LOT) || has(DOC_SERIAL)) && (
        <Page size="LETTER" style={pageStyle} wrap>
          <Banner />
          <ExportBanner text={project.titleBlock.exportControl} />
          {footer}
          {has(DOC_FAI) && (
            <View>
              <Text style={s.h1}>AS9102 First Article Inspection (summary)</Text>
              <KV k="Form 1: part" v={`${project.partNumber} Rev ${rev.label}, FAI serial ${sim.serials[0]!.serial}, full FAI`} />
              <KV k="Form 2: materials" v={`${sim.lots.length} BOM lines, certifications on file (see below)`} />
              <KV k="Form 3: characteristics" v={`${sim.inspections.find((r) => r.typeId === "dimensional")?.sections[0]?.table.rows.length ?? 0} dimensional characteristics + ${sim.inspections.length} inspection results, all conforming`} />
              <KV k="FAI result" v="Accepted, no nonconformances" />
            </View>
          )}
          {(has(DOC_MATCERT) || has(DOC_LOT)) && (
            <View break={has(DOC_FAI)}>
              <Text style={s.h1}>{has(DOC_MATCERT) && has(DOC_LOT) ? "Material certifications and lot traceability" : has(DOC_MATCERT) ? "Material certifications" : "Lot traceability"}</Text>
              <Table
                fontSize={6.8}
                cols={[{ label: "#", w: 0.3, align: "right" }, { label: "Part number", w: 1.5, mono: true }, { label: "Description", w: 2.4 }, { label: "Qty (lot)", w: 0.8, align: "right" }, ...(has(DOC_LOT) ? [{ label: "Lot", w: 0.8, mono: true }, { label: "Date code", w: 0.7, mono: true }] : []), ...(has(DOC_MATCERT) ? [{ label: "Supplier cert", w: 0.9, mono: true }] : [])]}
                rows={sim.lots.map((l) => [String(l.line), l.pn, l.description, l.qty, ...(has(DOC_LOT) ? [l.lot, l.dateCode] : []), ...(has(DOC_MATCERT) ? [l.cert] : [])])}
              />
            </View>
          )}
          {has(DOC_SERIAL) && (
            <View break={has(DOC_FAI) || has(DOC_MATCERT) || has(DOC_LOT)}>
              <Text style={s.h1}>Serial traceability</Text>
              <Text style={s.p}>Each serial is traceable to the material lots above, its operators and its test records.</Text>
              <Table
                cols={[{ label: "Serial", w: 1, mono: true }, { label: "Completed", w: 0.9 }, { label: "Assembler", w: 1 }, { label: "Inspector", w: 1 }, { label: "Tester", w: 1 }, { label: "Test records", w: 1.6, mono: true }]}
                rows={sim.serials.map((x) => [x.serial, x.built, x.assembler, x.inspector, x.tester, `TR-${x.serial}`])}
              />
            </View>
          )}
        </Page>
      )}

      <Page size="LETTER" style={pageStyle}>
        <Banner />
        <ExportBanner text={project.titleBlock.exportControl} />
        {footer}
        <Text style={s.h1}>Test equipment and calibration</Text>
        {sim.equipment.length ? (
          <Table cols={[{ label: "Equipment", w: 2 }, { label: "Asset ID", w: 1, mono: true }, { label: "Calibration due", w: 1 }, { label: "Status", w: 0.8 }]} rows={sim.equipment.map((e) => [e.name, e.id, e.calDue, "In calibration"])} />
        ) : (
          <Text style={s.p}>No instrumented tests were required.</Text>
        )}
        <Text style={s.h2}>Release</Text>
        <Text style={s.p}>
          The lot has passed every inspection the {ped.code} pedigree and purchase order {order.po} require and is released for shipment.
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Signature role="Quality Assurance release" name={qa} date={order.buildDate} />
          <View style={{ width: "31%" }} />
          <View style={{ width: "31%" }} />
        </View>
        <Text style={{ ...s.small, marginTop: 30 }}>
          Generated by Harness Studio from the design and pedigree as an example of the record a manufacturer returns with a lot. Names, serials, lots, measurements and equipment are simulated.
        </Text>
      </Page>
    </Document>
  );
}
