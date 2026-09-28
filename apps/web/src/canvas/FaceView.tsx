import type { Arrangement, ConnectorInstance, Harness, Severity } from "@hs/model";

/** Insert face view (mating face). Cavities colored by assignment: assigned / spare (plugged) / error; labelled with IDs. */
export function FaceView({
  arrangement,
  gender,
  size = 220,
  connector,
  h,
  onCavity,
  errors,
  showIds = true,
}: {
  arrangement: Arrangement;
  gender: "pin" | "socket";
  size?: number;
  connector?: ConnectorInstance;
  h?: Harness;
  onCavity?: (id: string) => void;
  errors?: Set<string>;
  showIds?: boolean;
}) {
  const cavs = arrangement.cavities;
  const R = Math.max(...cavs.map((c) => Math.hypot(c.x, c.y)), 1);
  const pad = 14;
  const r = size / 2;
  const s = (r - pad) / (R + 1.4);
  const mir = gender === "socket" ? -1 : 1;
  const minSpacing = Math.min(
    ...cavs.flatMap((a, i) => cavs.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
    R,
  );
  const cavR = (sz: string) => Math.max(2.2, Math.min((minSpacing * s) / 2 - 0.8, ({ "23": 0.45, "22D": 0.5, "20": 0.65, "16": 0.9, "12": 1.3, "10": 1.6, "8": 2.4 }[sz] ?? 0.6) * s));
  const netClass = (id: string) => {
    const nid = connector?.pins[id]?.netId;
    return nid ? h?.nets.find((n) => n.id === nid) : undefined;
  };
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} role="img" aria-label={`Insert ${arrangement.id} face view (${gender} side)`}>
      <circle r={r - 2} fill="var(--bg-surface-1)" stroke="var(--border-control)" strokeWidth={1.5} />
      {/* master key at top (12 o'clock) */}
      <rect x={-5} y={-r + 2} width={10} height={9} rx={2} fill="var(--border-control)" />
      {cavs.map((c) => {
        const x = c.x * s * mir;
        const y = -c.y * s;
        const net = netClass(c.id);
        const err = errors?.has(c.id);
        const rr = cavR(c.size);
        const fill = err ? "var(--status-error)" : net ? "var(--text-primary)" : "transparent";
        return (
          <g key={c.id} onClick={() => onCavity?.(c.id)} style={{ cursor: onCavity ? "pointer" : undefined }}>
            <title>{`${c.id} (size ${c.size})${net ? `: ${net.name}` : c.special ? ": coax/twinax" : ": spare (sealing plug)"}`}</title>
            <circle cx={x} cy={y} r={rr} fill={fill} stroke={c.special ? "var(--status-info)" : "var(--text-tertiary)"} strokeWidth={1} strokeDasharray={c.special ? "2 1.5" : undefined} />
            {showIds && rr >= 4.5 && (
              <text x={x} y={y + 3} fontSize={Math.min(9, rr * 1.1)} textAnchor="middle" className="mono" fill={net ? "var(--bg-surface-1)" : "var(--text-secondary)"} pointerEvents="none">
                {c.id}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function FaceLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-2xs text-text-secondary">
      <span className="flex items-center gap-1">
        <svg width={10} height={10}>
          <circle cx={5} cy={5} r={4} fill="var(--text-primary)" />
        </svg>
        assigned
      </span>
      <span className="flex items-center gap-1">
        <svg width={10} height={10}>
          <circle cx={5} cy={5} r={4} fill="none" stroke="var(--text-tertiary)" />
        </svg>
        spare (plugged)
      </span>
      <span className="flex items-center gap-1">
        <svg width={10} height={10}>
          <circle cx={5} cy={5} r={4} fill="var(--status-error)" />
        </svg>
        error
      </span>
    </div>
  );
}

export type { Severity };
