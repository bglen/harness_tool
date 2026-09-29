import { useEffect, useRef, useState } from "react";
import { addConnector, arrangementId, buildD38999, connectPins, currentHarness, formatMoney, KEYINGS, parseD38999, setConnectorPart, uid } from "@hs/model";
import type { ConnectorSearchHit, FacetFilter, SearchResult } from "@hs/providers";
import { Check, Search } from "lucide-react";
import { dispatch, getProject } from "../store/project";
import { useUi } from "../store/ui";
import { svc } from "../lib/services";
import { Chip, cx, DemoTag, Floating, Kbd } from "../ui/primitives";
import { FaceView } from "../canvas/FaceView";
import { CARD_W, FAN } from "../lib/geometry";

const SLASH_LABEL: Record<string, string> = { "26": "/26 plug", "20": "/20 wall-mount rcpt", "24": "/24 jam-nut rcpt" };
const FINISHES = ["W", "Z", "F", "G", "M", "J", "T", "K", "S", "C"];

export function PartPicker() {
  const ui = useUi();
  const picker = ui.picker!;
  const { cat, catalog } = svc();
  const replacing = picker.mode === "replace" ? currentHarness(getProject()).connectors.find((c) => c.id === picker.connectorId) : undefined;
  const initial = replacing ? parseD38999(replacing.pn) : null;
  const [q, setQ] = useState("");
  const [f, setF] = useState<FacetFilter>(() =>
    initial ? { slash: initial.slash, shellSize: initial.shellSize, arrangement: arrangementId(initial.shellSize, initial.insert), gender: ["P", "H", "R", "G"].includes(initial.contactStyle) ? "pin" : "socket", keying: initial.keying, finish: initial.finish } : {},
  );
  const [res, setRes] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // A connector dragged out from a pin gets the mating gender by default
  useEffect(() => {
    if (picker.mode === "fromPin" && picker.fromPins?.[0]) {
      const src = currentHarness(getProject()).connectors.find((c) => c.id === picker.fromPins![0]!.connectorId);
      const part = src && cat.connector(src.pn);
      if (part) setF((x) => ({ ...x, gender: part.gender === "pin" ? "socket" : "pin", shellSize: part.shellSize, arrangement: part.arrangement.id, slash: part.kind === "plug" ? "20" : "26" }));
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    void catalog.searchParts(q, f).then((r) => {
      if (alive) {
        setRes(r);
        setActive(0);
      }
    });
    return () => {
      alive = false;
    };
  }, [q, f, catalog]);

  const eff: FacetFilter = { ...res?.inferred, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) };
  const hits = res?.hits ?? [];
  const cur = hits[active];

  // Each hit is a complete PN variant (contacts/key/finish are never silently defaulted).
  const pnFor = (hit: ConnectorSearchHit) => hit.pn;

  const place = (hit: ConnectorSearchHit) => {
    const pn = pnFor(hit);
    const part = cat.connector(pn);
    if (!part) return;
    const h = currentHarness(getProject());
    if (picker.mode === "replace" && picker.connectorId) {
      dispatch(setConnectorPart({ id: picker.connectorId, pn }));
      ui.openPicker(null);
      return;
    }
    const id = uid();
    const rotation = h.connectors.length && picker.canvas.x > Math.max(...h.connectors.map((c) => c.position.x)) ? 180 : 0;
    // Centre the pin card on the click point: the anchor is the bundle attach point beside the card.
    const offset = FAN + CARD_W / 2;
    const ax = picker.canvas.x + (rotation === 0 ? offset : -offset);
    const cmds = [addConnector({ id, pn, position: { x: Math.round(ax / 10) * 10, y: Math.round(picker.canvas.y / 10) * 10 }, rotation })];
    if (picker.mode === "fromPin" && picker.fromPins?.length) {
      const cavs = part.arrangement.cavities.filter((c) => !c.special);
      const used = new Set<string>();
      const pairs = picker.fromPins.map((fp) => {
        let target = cavs.find((c) => c.id === fp.cavityId && !used.has(c.id));
        if (!target) target = cavs.find((c) => !used.has(c.id));
        used.add(target!.id);
        return { a: fp, b: { connectorId: id, cavityId: target!.id } };
      });
      dispatch([...cmds, connectPins({ pairs })], `Add ${pn} and connect`);
    } else {
      dispatch(cmds, `Add connector ${pn}`);
      // Pin card opens in edit mode on the first pin (§5.4)
      const first = part.arrangement.cavities.find((c) => !c.special);
      if (first) setTimeout(() => ui.setEditing({ connectorId: id, cavityId: first.id, col: "signal" }), 30);
    }
    ui.select("connector", [id]);
    ui.openPicker(null);
  };

  const set = (k: keyof FacetFilter, v: unknown) => setF((x) => ({ ...x, [k]: x[k] === v ? undefined : v }));
  const arr = cur ? cat.arrangements.get(cur.arrangement) : undefined;

  return (
    <Floating
      x={picker.centered ? picker.screen.x : picker.screen.x + 8}
      y={picker.centered ? picker.screen.y : picker.screen.y + 8}
      align={picker.centered ? "middle" : "start"}
      title={picker.mode === "replace" ? "Change connector" : "Add connector"}
      onClose={() => ui.openPicker(null)}
      width={760}
      className="flex max-h-[80vh] flex-col"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Search size={16} className="text-text-tertiary" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search part number or text: D38999/26WB35SN, 38999 13-35 socket…"
          className="mono h-8 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:font-ui placeholder:text-text-tertiary"
          aria-label="Search connectors"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (setActive((a) => Math.min(a + 1, hits.length - 1)), e.preventDefault());
            if (e.key === "ArrowUp") (setActive((a) => Math.max(a - 1, 0)), e.preventDefault());
            if (e.key === "Enter" && cur) place(cur);
            if (e.key === "Escape") ui.openPicker(null);
          }}
        />
        <span className="text-2xs text-text-tertiary">
          <Kbd>↑↓</Kbd> <Kbd>Enter</Kbd> {picker.mode === "replace" ? "replace" : "place"}
        </span>
      </div>
      {/* facet chips: Series → Shell → Insert → Gender → Keying → Finish (§5.4) */}
      <div className="flex flex-col gap-1.5 border-b border-border-subtle px-3 py-2 text-xs">
        <FacetRow label="Series III">
          {Object.entries(SLASH_LABEL).map(([k, l]) => (
            <FacetChip key={k} on={eff.slash === k} onClick={() => set("slash", k)}>
              {l}
            </FacetChip>
          ))}
        </FacetRow>
        <FacetRow label="Shell">
          {(res?.facets.shellSize ?? []).map((s) => (
            <FacetChip key={s} on={eff.shellSize === s} onClick={() => set("shellSize", s)}>
              {s}
            </FacetChip>
          ))}
        </FacetRow>
        <FacetRow label="Insert">
          <div className="flex max-h-[52px] flex-wrap gap-1 overflow-auto scroll-thin">
            {(res?.facets.arrangement ?? []).map((a) => {
              const A = cat.arrangements.get(a);
              return (
                <FacetChip key={a} on={eff.arrangement === a} onClick={() => set("arrangement", a)} title={A ? `${A.contactCount} contacts, size ${Object.entries(A.sizes).map(([s, n]) => `${n}×${s}`).join(" + ")}${A.inactive ? ", inactive for new design" : ""}${A.status !== "verified" ? ", unreviewed geometry" : ""}` : a}>
                  <span className={A?.inactive ? "line-through opacity-60" : undefined}>{a}</span>
                </FacetChip>
              );
            })}
          </div>
        </FacetRow>
        <div className="flex flex-wrap gap-4">
          <FacetRow label="Contacts">
            {(["socket", "pin"] as const).map((g) => (
              <FacetChip key={g} on={eff.gender === g} onClick={() => set("gender", g)}>
                {g === "pin" ? "Pins (P)" : "Sockets (S)"}
              </FacetChip>
            ))}
          </FacetRow>
          <FacetRow label="Key">
            {KEYINGS.map((k) => (
              <FacetChip key={k} on={eff.keying === k} onClick={() => set("keying", k)}>
                {k}
              </FacetChip>
            ))}
          </FacetRow>
          <FacetRow label="Finish">
            {FINISHES.map((k) => {
              const fin = cat.finishes.get(k);
              if (!fin) return null;
              return (
                <FacetChip key={k} on={eff.finish === k} onClick={() => set("finish", k)} title={`${fin.material}, ${fin.finish}${fin.cadmium ? " (cadmium)" : ""}${fin.lifecycle !== "active" ? ` (${fin.lifecycle})` : ""}`}>
                  <span className={fin.lifecycle !== "active" ? "line-through opacity-60" : undefined}>{k}</span>
                </FacetChip>
              );
            })}
          </FacetRow>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-h-0 flex-1 overflow-auto" role="listbox" aria-label="Connector results">
          {hits.map((hit, i) => {
            const pn = pnFor(hit);
            const part = cat.connector(pn);
            const sup = cat.supply(pn);
            return (
              <button
                key={hit.pn}
                role="option"
                aria-selected={i === active}
                className={cx("flex w-full items-center gap-3 border-b border-border-subtle px-3 py-1.5 text-left", i === active ? "bg-bg-hover" : "hover:bg-bg-hover")}
                onMouseEnter={() => setActive(i)}
                onClick={() => place(hit)}
              >
                <div className="min-w-0 flex-1">
                  <div className="mono text-sm text-text-primary">{pn}</div>
                  <div className="truncate text-2xs text-text-secondary">
                    {part?.style.description} · shell {hit.shellSize} · {hit.arrangement} · {hit.count}× {hit.sizes.replace(/ /g, "/")} · {hit.gender}s · key {hit.keying} · class {hit.finish}
                  </div>
                </div>
                {hit.status !== "verified" && <Chip title="Cavity coordinates are machine-extracted from MIL-STD-1560C and not yet reviewed">Unreviewed geometry</Chip>}
                {part?.machineReady && (
                  <Chip className="border-status-pass text-status-pass" title="Supported by automated assembly">
                    <Check size={10} /> Machine-ready
                  </Chip>
                )}
                <div className="w-28 text-right">
                  <div className="tnum text-sm">{sup ? formatMoney(sup.breaks[0]!.price) : "—"}</div>
                  <div className="text-2xs text-text-tertiary">{sup ? (sup.stock > 0 ? `${sup.stock} in stock` : `${sup.leadDays} d lead`) : "no data"}</div>
                </div>
              </button>
            );
          })}
          {!hits.length && <div className="p-6 text-center text-sm text-text-tertiary">No matching connectors. Clear a facet or try another search.</div>}
        </div>
        <div className="w-60 border-l border-border-subtle p-3">
          {cur && arr ? (
            <div className="flex flex-col items-center gap-2">
              <FaceView arrangement={arr} gender={cur.gender} size={190} showIds />
              <div className="text-center text-xs text-text-secondary">
                Insert {arr.id} · {arr.contactCount} contacts
                <br />
                {Object.entries(arr.sizes)
                  .map(([s, n]) => `${n} × size ${s}`)
                  .join(", ")}
                {arr.special && <div className="text-status-warning">{arr.special}</div>}
                {arr.inactive && <div className="text-status-warning">Inactive for new design</div>}
              </div>
              <div className="flex items-center gap-1">
                <DemoTag />
              </div>
            </div>
          ) : (
            <div className="text-xs text-text-tertiary">Hover a result to preview the insert face.</div>
          )}
        </div>
      </div>
    </Floating>
  );
}

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 pt-0.5 text-2xs uppercase tracking-wide text-text-tertiary">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FacetChip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button title={title} onClick={onClick} aria-pressed={on} className={cx("mono rounded-chip border px-1.5 py-0.5 text-2xs", on ? "border-accent bg-bg-hover text-text-primary" : "border-border-subtle text-text-secondary hover:border-border-control")}>
      {children}
    </button>
  );
}
