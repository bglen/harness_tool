import { BLOCK_LABELS, resolveDrawingTokens, type DrawingTemplate, type TemplateBlock } from "@hs/model";
import { GitBranch, Image as ImageIcon, Network } from "lucide-react";

/** Everything the on-sheet previews need from the project (computed once when the editor opens). */
export interface PreviewCtx {
  tokens: Record<string, string>;
  notes: string[];
  revisions: string[][];
  connectors: string[];
}

// Paper colors: the sheet is always drawn as white paper, whatever the app theme.
const INK = "#16181D";
const INK2 = "#4A515C";
const INK3 = "#8A919C";
const RULE = "#E1E4E8";
const FILL = "#F4F5F7";

const TABLE_COLS: Partial<Record<TemplateBlock["kind"], string[]>> = {
  connectorTables: ["Pin", "Signal", "Wire", "AWG", "Color", "Contact"],
  wireList: ["Wire", "Net", "From", "To", "AWG", "Spec", "Color", "Len"],
  bom: ["Line", "Part number", "Description", "Qty", "UoM", "Refs"],
  labels: ["Text", "Location", "Label stock"],
  revisionBlock: ["REV", "DESCRIPTION", "DATE", "STATUS"],
};

function Heading({ b, s }: { b: TemplateBlock; s: number }) {
  if (!b.title) return null;
  return <div style={{ fontSize: Math.max(7, b.fontSize + 1) * s, fontWeight: 600, letterSpacing: 0.4 * s, color: INK, whiteSpace: "nowrap", overflow: "hidden", lineHeight: 1.3 }}>{b.title}</div>;
}

function TableMock({ b, s, rows, colsLabel }: { b: TemplateBlock; s: number; rows: string[][] | number; colsLabel: string[] }) {
  const fs = b.fontSize * s;
  const n = typeof rows === "number" ? rows : rows.length;
  return (
    <div style={{ fontSize: fs, color: INK, lineHeight: 1.25 }}>
      <div style={{ display: "flex", background: FILL, borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}`, fontWeight: 600, color: INK2 }}>
        {colsLabel.map((c) => (
          <div key={c} style={{ flex: 1, padding: `${s}px ${2 * s}px`, whiteSpace: "nowrap", overflow: "hidden" }}>
            {c}
          </div>
        ))}
      </div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: "flex", borderBottom: `1px solid ${RULE}`, height: (b.fontSize * 1.25 + 3) * s, alignItems: "center" }}>
          {typeof rows === "number"
            ? colsLabel.map((c, j) => <div key={c} style={{ flex: 1, padding: `0 ${2 * s}px` }}><div style={{ height: fs * 0.45, width: `${45 + ((i * 7 + j * 13) % 40)}%`, background: "#D7DBE0", borderRadius: 1 }} /></div>)
            : rows[i]!.map((c, j) => (
                <div key={j} style={{ flex: 1, padding: `0 ${2 * s}px`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c}
                </div>
              ))}
        </div>
      ))}
    </div>
  );
}

/** What a block will roughly look like on the sheet. `s` is screen px per point. */
export function BlockPreview({ b, s, ctx, template, selectedCell, onCell }: { b: TemplateBlock; s: number; ctx: PreviewCtx; template: DrawingTemplate; selectedCell: string | null; onCell?: (cellId: string) => void }) {
  const frame = b.frame ? `1px solid ${INK}` : undefined;
  switch (b.kind) {
    case "titleBlock": {
      const total = b.rows.reduce((a, r) => a + r.height, 0) || 1;
      return (
        <div style={{ width: "100%", height: "100%", border: `${Math.max(1, s)}px solid ${INK}`, background: "#fff", display: "flex", flexDirection: "column" }}>
          {b.rows.map((r, ri) => (
            <div key={r.id} style={{ flex: r.height / total, display: "flex", borderTop: ri ? `1px solid ${INK}` : undefined, minHeight: 0 }}>
              {r.cells.map((c, ci) => (
                <div
                  key={c.id}
                  data-cell={c.id}
                  // Selects the cell; the press still reaches the block, so the title block drags from any cell.
                  onPointerDown={() => onCell?.(c.id)}
                  style={{ flex: c.flex, minWidth: 0, padding: 2.5 * s, borderLeft: ci ? `1px solid ${INK}` : undefined, overflow: "hidden", outline: selectedCell === c.id ? "2px solid var(--accent)" : undefined, outlineOffset: -2, cursor: onCell ? "pointer" : undefined }}
                >
                  {c.label && <div style={{ fontSize: 5.5 * s, color: INK3, lineHeight: 1.15, whiteSpace: "nowrap" }}>{c.label}</div>}
                  {resolveDrawingTokens(c.value, ctx.tokens)
                    .split("\n")
                    .map((line, li) => (
                      <div key={li} className={c.mono ? "mono" : undefined} style={{ fontSize: (li ? Math.max(5, c.size - 1) : c.size) * s, fontWeight: c.bold && !li ? 600 : 400, color: INK, lineHeight: 1.2, whiteSpace: "nowrap" }}>
                        {line || " "}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    case "logo":
      return (
        <div style={{ width: "100%", height: "100%", border: frame, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 * s, boxSizing: "border-box" }}>
          {template.logo ? (
            <img src={template.logo.dataUrl} alt="Company logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} draggable={false} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: INK3, fontSize: Math.max(9, 7 * s), textAlign: "center", border: `1px dashed ${INK3}`, width: "100%", height: "100%", justifyContent: "center" }}>
              <ImageIcon size={Math.max(12, 14 * s)} />
              Logo
            </div>
          )}
        </div>
      );
    case "text":
      return (
        <div style={{ width: "100%", height: "100%", border: frame, padding: b.frame ? 3 * s : 0, boxSizing: "border-box", fontSize: b.fontSize * s, fontWeight: b.bold ? 600 : 400, textAlign: b.align, color: INK, whiteSpace: "pre-wrap", lineHeight: 1.25, overflow: "hidden" }}>
          {resolveDrawingTokens(b.text, ctx.tokens) || <span style={{ color: INK3 }}>Empty text</span>}
        </div>
      );
    case "bundleView":
    case "schematicView": {
      const Icon = b.kind === "bundleView" ? GitBranch : Network;
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
          <Heading b={b} s={s} />
          <div
            style={{
              flex: 1,
              border: frame ?? `1px dashed ${INK3}`,
              backgroundImage: `repeating-linear-gradient(45deg, transparent 0 ${8 * s}px, ${FILL} ${8 * s}px ${9 * s}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: INK2,
              fontSize: Math.max(10, 9 * s),
            }}
          >
            <Icon size={Math.max(16, 22 * s)} />
            {BLOCK_LABELS[b.kind]}
            <span style={{ fontSize: Math.max(9, 6.5 * s), color: INK3 }}>Generated from the design, scaled to fit</span>
          </div>
        </div>
      );
    }
    case "notes":
      return (
        <div style={{ width: "100%", height: "100%", overflow: "hidden", border: frame }}>
          <Heading b={b} s={s} />
          <div style={{ columnCount: b.columns, columnGap: 10 * s, fontSize: b.fontSize * s, color: INK, lineHeight: 1.35 }}>
            {ctx.notes.map((n, i) => (
              <div key={i} style={{ display: "flex", gap: 2 * s, marginBottom: 2 * s, breakInside: "avoid" }}>
                <span style={{ width: b.fontSize * 2 * s, flexShrink: 0 }}>{i + 1}.</span>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "revisionBlock":
      return (
        <div style={{ width: "100%", height: "100%", overflow: "hidden", border: frame }}>
          <Heading b={b} s={s} />
          <TableMock b={b} s={s} rows={ctx.revisions} colsLabel={TABLE_COLS.revisionBlock!} />
        </div>
      );
    default: {
      const cols = TABLE_COLS[b.kind] ?? [];
      return (
        <div style={{ width: "100%", height: "100%", overflow: "hidden", border: frame, display: "flex", flexDirection: "column" }}>
          <Heading b={b} s={s} />
          <div style={{ flex: 1, display: "flex", gap: 10 * s, minHeight: 0 }}>
            {Array.from({ length: b.columns }, (_, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                {b.kind === "connectorTables" && <div style={{ fontSize: (b.fontSize + 0.5) * s, fontWeight: 600, color: INK, padding: `${3 * s}px 0 ${1 * s}px` }}>{ctx.connectors[i] ?? ctx.connectors[0] ?? "J1"} — …</div>}
                <TableMock b={b} s={s} rows={40} colsLabel={cols} />
              </div>
            ))}
          </div>
        </div>
      );
    }
  }
}
