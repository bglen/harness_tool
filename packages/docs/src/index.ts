import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { DrawingDocument } from "./drawing";
import { ReportDocument, type SectionId } from "./report";
import type { DocData } from "./data";

export * from "./data";
export { registerFonts } from "./common";
export { REPORT_SECTIONS, autoSummary, type SectionId } from "./report";
export { drawingNotes } from "./drawing";

export async function renderDrawingPdf(data: DocData): Promise<Blob> {
  return pdf(createElement(DrawingDocument, { data }) as never).toBlob();
}

export async function renderReportPdf(data: DocData, opts: { sections?: Partial<Record<SectionId, boolean>>; hideQuote?: boolean } = {}): Promise<Blob> {
  return pdf(createElement(ReportDocument, { data, ...opts }) as never).toBlob();
}
