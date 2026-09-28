import { currentHarness, pasteConnectors, uid, type NetClass } from "@hs/model";
import { dispatch, getProject } from "../store/project";
import { useUi } from "../store/ui";

const MIME = "harness-studio/connectors";
let memory: string | null = null;

/** Copy connectors with their pinouts (as signal names) (§5.4). */
export function copySelection(ids: string[]) {
  const h = currentHarness(getProject());
  const items = h.connectors
    .filter((c) => ids.includes(c.id))
    .map((c) => ({
      pn: c.pn,
      position: c.position,
      rotation: c.rotation,
      backshell: c.backshell,
      pins: Object.fromEntries(
        Object.entries(c.pins)
          .filter(([, p]) => p.netId)
          .map(([cav, p]) => {
            const n = h.nets.find((x) => x.id === p.netId)!;
            return [cav, { name: n.name, cls: n.cls }];
          }),
      ),
    }));
  if (!items.length) return;
  memory = JSON.stringify({ [MIME]: items });
  void navigator.clipboard?.writeText(memory).catch(() => undefined);
  useUi.getState().toast({ kind: "info", text: `Copied ${items.length} connector${items.length > 1 ? "s" : ""}` });
}

export async function pasteClipboard() {
  let text = memory;
  try {
    const t = await navigator.clipboard?.readText();
    if (t) text = t;
  } catch {
    /* permission denied: fall back to in-app memory */
  }
  if (!text) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Tabular text: hand to the import flow (§12 paste)
    if (/\t/.test(text)) useUi.getState().openDialog("import", { text });
    return;
  }
  const items = (parsed as Record<string, unknown>)?.[MIME] as { pn: string; position: { x: number; y: number }; rotation: number; backshell: null; pins: Record<string, { name: string; cls: NetClass }> }[] | undefined;
  if (!items) return;
  const newItems = items.map((it) => ({ ...it, id: uid(), position: { x: it.position.x + 40, y: it.position.y + 140 } }));
  dispatch(pasteConnectors({ items: newItems }));
  useUi.getState().select("connector", newItems.map((i) => i.id));
}
