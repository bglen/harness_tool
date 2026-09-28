import { currentHarness, type Point } from "@hs/model";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";
import { ACTIONS, type ActionCtx } from "../lib/actions";
import { nodePos, type ConnLayout } from "../lib/geometry";
import { Icon } from "../ui/icons";
import { Floating, Kbd, MenuItem, Tip } from "../ui/primitives";

/** Figma-style floating context bar above the selection with the 3–5 most relevant actions (§5.4). */
export function ContextBar({ layouts }: { layouts: Map<string, ConnLayout> }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const { selection: sel, viewport: vp } = ui;
  if (!sel.kind || !sel.ids.length || ui.editing || ui.picker) return null;
  // Anchor point above the selection (canvas coords)
  const pts: Point[] = [];
  for (const id of sel.ids) {
    if (sel.kind === "connector") {
      const L = layouts.get(id);
      if (L) pts.push({ x: L.card.x + L.card.w / 2, y: L.card.y });
    } else if (sel.kind === "segment") {
      const s = h.segments.find((x) => x.id === id);
      if (s) {
        const a = nodePos(h, s.a);
        const b = nodePos(h, s.b);
        pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 30 });
      }
    } else if (sel.kind === "node") {
      const n = h.nodes.find((x) => x.id === id);
      if (n) pts.push({ x: n.position.x, y: n.position.y - 16 });
    } else if (sel.kind === "wire") {
      const w = h.wires.find((x) => x.id === id);
      const e = w && [w.from, w.to].find((x) => x.kind === "pin");
      if (e && e.kind === "pin") {
        const L = layouts.get(e.connectorId);
        const r = L?.rowByCavity.get(e.cavityId);
        if (L && r) pts.push({ x: L.attachX + L.facing * 40, y: r.y - 12 });
      }
    } else if (sel.kind === "net") {
      const n = h.nets.find((x) => x.id === id);
      for (const m of n?.members ?? []) {
        const L = layouts.get(m.connectorId);
        const r = L?.rowByCavity.get(m.cavityId);
        if (L && r) pts.push({ x: L.card.x + L.card.w / 2, y: r.top - 4 });
      }
    } else if (sel.kind === "splice") {
      const s = h.splices.find((x) => x.id === id);
      if (s) {
        const p = nodePos(h, s.nodeId);
        pts.push({ x: p.x + 16, y: p.y });
      }
    } else if (sel.kind === "pin") {
      const [cid, cav] = id.split(":");
      const L = layouts.get(cid!);
      const r = L?.rowByCavity.get(cav!);
      if (L && r) pts.push({ x: L.card.x + L.card.w / 2, y: r.top });
    }
  }
  if (!pts.length) return null;
  const top = Math.min(...pts.map((p) => p.y));
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const sx = cx * vp.k + vp.x;
  const sy = top * vp.k + vp.y - 44;
  const r = document.getElementById("hs-canvas")?.getBoundingClientRect();
  const anchor = { x: (r?.left ?? 0) + sx, y: (r?.top ?? 0) + sy + 44 };
  const ctx: ActionCtx = { kind: sel.kind, ids: sel.ids, h, anchor };
  let actions = ACTIONS.filter((a) => a.bar?.includes(sel.kind!) && (!a.when || a.when(ctx)));
  if (sel.kind === "pin") actions = [];
  const title =
    sel.kind === "connector" && sel.ids.length === 1
      ? h.connectors.find((c) => c.id === sel.ids[0])?.refDes
      : sel.kind === "net" && sel.ids.length === 1
        ? h.nets.find((n) => n.id === sel.ids[0])?.name
        : `${sel.ids.length} ${sel.kind}${sel.ids.length > 1 ? "s" : ""}`;
  if (sy < 4 || sx < 0 || !r || sx > r.width) return null;
  return (
    <div className="pop-in absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-card border border-border-subtle bg-bg-surface-2 p-1 shadow-lg" style={{ left: sx, top: Math.max(6, sy) }} role="toolbar" aria-label="Selection actions" onPointerDown={(e) => e.stopPropagation()}>
      <span className="mono max-w-[140px] truncate px-2 text-xs text-text-secondary">{title}</span>
      {sel.kind === "pin" && <span className="px-1 text-xs text-text-tertiary">Drag pins onto another connector to connect in order · double-click to name</span>}
      {actions.map((a) => (
        <Tip key={a.id} label={a.label} shortcut={a.shortcut}>
          <button className={`flex h-7 items-center gap-1 rounded-control px-2 text-xs hover:bg-bg-hover ${a.danger ? "text-status-error" : "text-text-primary"}`} onClick={(e) => a.run({ ...ctx, anchor: { x: e.clientX, y: e.clientY + 16 } })}>
            <Icon name={a.icon} size={14} />
            {a.id !== "delete" && a.id !== "cMore" && <span>{a.label}</span>}
          </button>
        </Tip>
      ))}
    </div>
  );
}

/** Right-click menu: same actions as the context bar plus more (§5.4). */
export function ContextMenu() {
  const ui = useUi();
  const project = useProject((s) => s.project);
  if (!ui.contextMenu || !project) return null;
  const h = currentHarness(project);
  const { selection: sel } = ui;
  const ctx: ActionCtx = { kind: sel.kind, ids: sel.ids, h, anchor: ui.contextMenu.screen };
  const items = sel.kind ? ACTIONS.filter((a) => (a.menu?.includes(sel.kind!) || a.bar?.includes(sel.kind!)) && (!a.when || a.when(ctx))) : ACTIONS.filter((a) => ["addConnector", "addNote", "paste", "commit", "finish", "zoomFit", "shieldView", "import"].includes(a.id));
  const uniq = [...new Map(items.map((a) => [a.id, a])).values()];
  return (
    <Floating x={ui.contextMenu.screen.x} y={ui.contextMenu.screen.y} onClose={() => ui.openContextMenu(null)} className="w-60 p-1">
      {uniq.map((a) => (
        <MenuItem
          key={a.id}
          icon={<Icon name={a.icon} size={14} />}
          label={a.label}
          shortcut={a.shortcut}
          danger={a.danger}
          onClick={() => {
            ui.openContextMenu(null);
            a.run(ctx);
          }}
        />
      ))}
      {!uniq.length && <div className="px-2 py-1 text-xs text-text-tertiary">No actions</div>}
      <div className="mt-1 border-t border-border-subtle px-2 pt-1 text-2xs text-text-tertiary">
        <Kbd>Ctrl+K</Kbd> for all commands
      </div>
    </Floating>
  );
}
