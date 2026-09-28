import { buildD38999, parseD38999, normalizePn, arrangementId, type D38999Parts } from "./pn38999";

/** Shapes of the compiled catalog bundle produced by `pnpm data:build` (§15.4). All lengths mm, masses g, currents A. */

export type Lifecycle = "active" | "nrnd" | "obsolete" | "inactive";
export type DataStatus = "verified" | "unreviewed" | "seed";

export interface ConnectorStyle {
  slash: string;
  series: string;
  kind: "plug" | "receptacle";
  mount: string; // "straight" | "wall flange" | "jam nut"
  description: string;
  terminationAllowanceMm: number;
  machineReady: boolean;
  fixturePrefix: string;
  lifecycle: Lifecycle;
  massBySize: Record<string, number>; // g, by shell size
}

export interface Finish {
  code: string;
  material: string;
  finish: string;
  conductive: boolean;
  hermetic: boolean;
  tempMaxC: number;
  cadmium: boolean;
  lifecycle: Lifecycle;
  notes: string;
}

export interface Cavity {
  id: string;
  x: number; // mm, pin mating-face view
  y: number;
  size: string; // "22D" | "20" | "16" | "12" | "10" | "8" | "23"
  /** Coax/twinax cavity (Phase 2): no crimp contact in the Phase 1 catalog. */
  special?: boolean;
}

export interface ContactSize {
  size: string;
  sealingMinMm: number;
  sealingMaxMm: number;
  gauges: number[];
  currentA: number;
  source: string;
}

export interface Arrangement {
  id: string; // "11-35"
  shellSize: number;
  insert: string;
  contactCount: number;
  sizes: Record<string, number>;
  serviceRating: string;
  status: DataStatus;
  inactive: boolean;
  source: string;
  cavities: Cavity[];
  special?: string;
  notes?: string;
}

export interface ShellSize {
  code: string;
  size: number;
  accessoryIdMm: number; // rear accessory bore (used for backshell clamp limits)
  shellOdMm: number;
  accessoryThread: string;
}

export interface ContactPart {
  pn: string;
  size: string;
  gender: "pin" | "socket";
  gaugeMin: number; // AWG (numerically larger = thinner)
  gaugeMax: number;
  plating: string;
  crimpTool: string;
  positioner: string;
  insertionTool: string;
  removalTool: string;
  machineInsertable: boolean;
  currentA: number;
  status: DataStatus;
}

export interface SealingPlug {
  pn: string;
  size: string;
  color: string;
}

export interface WireSpec {
  spec: string; // "M22759/16"
  gauge: number;
  pn: string; // "M22759/16-22-9" colors appended at BOM time
  odMm: number;
  massGPerM: number;
  ohmPerKm: number;
  currentA: number;
  tempC: number;
  insulation: string;
  conductor: string;
  machineReady: boolean;
  status: DataStatus;
}

export interface CableOption {
  wireCode: string; // M27500 wire designation
  spec: string; // underlying M22759 spec
  gauges: number[];
}

export interface CableShieldOption {
  code: string;
  material: string;
  coverage: number;
  thicknessMm: number;
}

export interface CableJacketOption {
  code: string;
  material: string;
  thicknessMm: number;
}

export interface BackshellPart {
  pn: string;
  description: string;
  shellSizes: number[];
  angle: 0 | 45 | 90;
  style: "strainRelief" | "emiBand" | "shieldRing" | "pottingBoot";
  clampMinMm: number;
  clampMaxMm: number;
  bandPlatform: boolean;
  massG: number;
  lengthMm: number;
  machineReady: boolean;
  status: DataStatus;
}

export interface AccessoryPart {
  pn: string;
  kind: "dustCap" | "jamNut" | "oRing" | "gasket" | "groundingRing" | "sealingPlug";
  description: string;
  shellSizes: number[];
  forKind: "plug" | "receptacle" | "any";
  lanyard: boolean;
  massG: number;
}

export type LayerType = "tape" | "sleeve" | "heatShrink" | "jacket" | "conduit" | "overbraid";

export interface LayerPart {
  pn: string;
  type: LayerType;
  material: string;
  description: string;
  minDiaMm: number; // smallest diameter it fits (recovered / contracted)
  maxDiaMm: number; // largest (expanded / supplied)
  thicknessMm: number; // wall / wrap / braid thickness contributed per side
  massGPerM: number; // at mid size
  coverageOptions?: number[];
  shrinkRatio?: number;
  machineReady: boolean;
  status: DataStatus;
}

export interface ClampPart {
  pn: string;
  description: string;
  minDiaMm: number;
  maxDiaMm: number;
  tensionSpec: string;
  tool: string;
  massG: number;
}

export interface BootPart {
  pn: string;
  shape: "straight" | "90" | "Y" | "T" | "multi";
  description: string;
  minDiaMm: number;
  maxDiaMm: number;
  massG: number;
}

export interface LabelPart {
  pn: string;
  type: "sleeve" | "flag" | "wrap" | "direct";
  description: string;
  minDiaMm: number;
  maxDiaMm: number;
  printableLengthMm: number;
  charsPerMm: number;
}

export interface SplicePart {
  pn: string;
  type: "solderSleeve" | "crimp" | "ultrasonic";
  description: string;
  gaugeMin: number;
  gaugeMax: number;
  maxWires: number;
  massG: number;
}

export interface PottingPart {
  pn: string;
  kind: "compound" | "mold";
  description: string;
  cureHours: number;
  densityGPerCc?: number;
  shellSizes?: number[];
}

export interface HardwarePart {
  pn: string;
  type: "cushionClamp" | "spotTie" | "lacing";
  description: string;
  minDiaMm: number;
  maxDiaMm: number;
}

export interface Alternate {
  pn: string; // pattern (supports * wildcard)
  alternate: string;
  relationship: string;
}

export interface SupplyRow {
  pattern: string; // PN or prefix* pattern
  breaks: { qty: number; price: number }[];
  stock: number;
  leadDays: number;
  lifecycle: Lifecycle;
  asOf: string;
}

export interface CatalogBundle {
  version: { hash: string; date: string };
  connectorStyles: ConnectorStyle[];
  finishes: Finish[];
  shellSizes: ShellSize[];
  arrangements: Arrangement[];
  contactSizes: ContactSize[];
  contacts: ContactPart[];
  sealingPlugs: SealingPlug[];
  wires: WireSpec[];
  cableWireCodes: CableOption[];
  cableShields: CableShieldOption[];
  cableJackets: CableJacketOption[];
  backshells: BackshellPart[];
  accessories: AccessoryPart[];
  layers: LayerPart[];
  clamps: ClampPart[];
  boots: BootPart[];
  labels: LabelPart[];
  splices: SplicePart[];
  potting: PottingPart[];
  hardware: HardwarePart[];
  alternates: Alternate[];
  supply: SupplyRow[];
}

/** A resolved connector part (built from the PN + style + arrangement). */
export interface ConnectorPart extends D38999Parts {
  pn: string;
  key: string;
  manufacturer: string;
  series: string;
  kind: "plug" | "receptacle";
  mount: string;
  gender: "pin" | "socket";
  style: ConnectorStyle;
  finishInfo: Finish;
  arrangement: Arrangement;
  shell: ShellSize;
  description: string;
  machineReady: boolean;
  fixtureId: string;
  massG: number;
  lifecycle: Lifecycle;
}

const GENDER_BY_STYLE: Record<string, "pin" | "socket"> = { P: "pin", S: "socket", H: "pin", J: "socket", R: "pin", M: "socket", G: "pin", U: "socket", A: "pin", B: "socket", X: "pin", Z: "socket", C: "pin", D: "socket" };

/** Synchronous lookups over a loaded catalog bundle. Used by derivations, DFM and UI. */
export class CatalogIndex {
  readonly styles = new Map<string, ConnectorStyle>();
  readonly finishes = new Map<string, Finish>();
  readonly arrangements = new Map<string, Arrangement>();
  readonly shells = new Map<number, ShellSize>();
  readonly contactsByPn = new Map<string, ContactPart>();
  readonly wiresByKey = new Map<string, WireSpec>();
  readonly partsByPn = new Map<string, { kind: string; part: unknown }>();
  private connectorCache = new Map<string, ConnectorPart | null>();

  constructor(readonly bundle: CatalogBundle) {
    for (const s of bundle.connectorStyles) this.styles.set(s.slash, s);
    for (const f of bundle.finishes) this.finishes.set(f.code, f);
    for (const a of bundle.arrangements) this.arrangements.set(a.id, a);
    for (const s of bundle.shellSizes) this.shells.set(s.size, s);
    for (const c of bundle.contacts) {
      this.contactsByPn.set(c.pn, c);
      this.partsByPn.set(normalizePn(c.pn), { kind: "contact", part: c });
    }
    for (const w of bundle.wires) this.wiresByKey.set(`${w.spec}|${w.gauge}`, w);
    const reg = (kind: string, arr: { pn: string }[]) => arr.forEach((p) => this.partsByPn.set(normalizePn(p.pn), { kind, part: p }));
    reg("backshell", bundle.backshells);
    reg("accessory", bundle.accessories);
    reg("layer", bundle.layers);
    reg("clamp", bundle.clamps);
    reg("boot", bundle.boots);
    reg("label", bundle.labels);
    reg("splice", bundle.splices);
    reg("potting", bundle.potting);
    reg("hardware", bundle.hardware);
    reg("sealingPlug", bundle.sealingPlugs);
  }

  get version() {
    return this.bundle.version;
  }

  connector(pn: string): ConnectorPart | null {
    const key = normalizePn(pn);
    if (this.connectorCache.has(key)) return this.connectorCache.get(key)!;
    const p = parseD38999(key);
    let part: ConnectorPart | null = null;
    if (p) {
      const style = this.styles.get(p.slash);
      const fin = this.finishes.get(p.finish);
      const arr = this.arrangements.get(arrangementId(p.shellSize, p.insert));
      const shell = this.shells.get(p.shellSize);
      const gender = GENDER_BY_STYLE[p.contactStyle];
      if (style && fin && arr && shell && gender) {
        const built = buildD38999(p);
        part = {
          ...p,
          pn: built,
          key: normalizePn(built),
          manufacturer: "MIL-DTL-38999 (QPL)",
          series: `38999 ${style.series}`,
          kind: style.kind,
          mount: style.mount,
          gender,
          style,
          finishInfo: fin,
          arrangement: arr,
          shell,
          description: `${style.description}, shell ${p.shellSize}, insert ${arr.id} (${arr.contactCount}× ${Object.keys(arr.sizes).join("/")}), ${gender}s, ${fin.material} ${fin.finish}, key ${p.keying}`,
          machineReady: style.machineReady && !arr.inactive && !arr.special && Object.keys(arr.sizes).every((s) => ["22D", "20", "16", "12"].includes(s)),
          fixtureId: `${style.fixturePrefix}-${p.shellSize}`,
          massG: style.massBySize[String(p.shellSize)] ?? 20,
          lifecycle: fin.lifecycle !== "active" ? fin.lifecycle : arr.inactive ? "inactive" : style.lifecycle,
        };
      }
    }
    this.connectorCache.set(key, part);
    return part;
  }

  private cavityMaps = new Map<string, Map<string, Cavity>>();
  cavity(pn: string, cavityId: string): Cavity | undefined {
    const part = this.connector(pn);
    if (!part) return undefined;
    let m = this.cavityMaps.get(part.arrangement.id);
    if (!m) this.cavityMaps.set(part.arrangement.id, (m = new Map(part.arrangement.cavities.map((c) => [c.id, c]))));
    return m.get(cavityId);
  }

  wire(spec: string, gauge: number): WireSpec | undefined {
    return this.wiresByKey.get(`${spec}|${gauge}`);
  }

  wireSpecs(): string[] {
    return [...new Set(this.bundle.wires.map((w) => w.spec))];
  }

  gaugesFor(spec: string): number[] {
    return this.bundle.wires.filter((w) => w.spec === spec).map((w) => w.gauge).sort((a, b) => b - a);
  }

  /** Default contact for a cavity size + gender (+ optional gauge). */
  contactFor(size: string, gender: "pin" | "socket", gauge?: number): ContactPart | undefined {
    const c = this.bundle.contacts.filter((x) => x.size === size && x.gender === gender);
    if (gauge != null) {
      const fit = c.find((x) => gauge <= x.gaugeMin && gauge >= x.gaugeMax);
      if (fit) return fit;
    }
    return c[0];
  }

  sealingPlug(size: string): SealingPlug | undefined {
    return this.bundle.sealingPlugs.find((s) => s.size === size);
  }

  contactSize(size: string): ContactSize | undefined {
    return this.bundle.contactSizes.find((s) => s.size === size);
  }

  backshellsFor(shellSize: number): BackshellPart[] {
    return this.bundle.backshells.filter((b) => b.shellSizes.includes(shellSize));
  }

  backshell(pn: string): BackshellPart | undefined {
    return this.bundle.backshells.find((b) => normalizePn(b.pn) === normalizePn(pn));
  }

  accessoriesFor(shellSize: number, kind: "plug" | "receptacle"): AccessoryPart[] {
    return this.bundle.accessories.filter((a) => a.shellSizes.includes(shellSize) && (a.forKind === "any" || a.forKind === kind));
  }

  layer(pn: string): LayerPart | undefined {
    return this.bundle.layers.find((l) => l.pn === pn);
  }

  /** Smallest part of a layer type/material that fits over a diameter. */
  layerFor(type: LayerType, material: string | undefined, diaMm: number): LayerPart | undefined {
    return this.bundle.layers
      .filter((l) => l.type === type && (!material || l.material === material) && diaMm >= l.minDiaMm && diaMm <= l.maxDiaMm)
      .sort((a, b) => a.maxDiaMm - b.maxDiaMm)[0];
  }

  clampFor(diaMm: number): ClampPart | undefined {
    return this.bundle.clamps.filter((c) => diaMm >= c.minDiaMm && diaMm <= c.maxDiaMm).sort((a, b) => a.maxDiaMm - b.maxDiaMm)[0];
  }

  clamp(pn: string) {
    return this.bundle.clamps.find((c) => c.pn === pn);
  }

  bootFor(shape: BootPart["shape"], diaMm: number): BootPart | undefined {
    return this.bundle.boots.filter((b) => b.shape === shape && diaMm >= b.minDiaMm && diaMm <= b.maxDiaMm).sort((a, b) => a.maxDiaMm - b.maxDiaMm)[0];
  }

  boot(pn: string) {
    return this.bundle.boots.find((b) => b.pn === pn);
  }

  labelFor(type: LabelPart["type"], diaMm: number): LabelPart | undefined {
    return this.bundle.labels.filter((l) => l.type === type && diaMm >= l.minDiaMm && diaMm <= l.maxDiaMm).sort((a, b) => a.maxDiaMm - b.maxDiaMm)[0];
  }

  label(pn: string) {
    return this.bundle.labels.find((l) => l.pn === pn);
  }

  spliceFor(type: SplicePart["type"], gauge: number, wires: number): SplicePart | undefined {
    return this.bundle.splices.find((s) => s.type === type && gauge <= s.gaugeMin && gauge >= s.gaugeMax && wires <= s.maxWires) ?? this.bundle.splices.find((s) => s.type === type);
  }

  splice(pn: string) {
    return this.bundle.splices.find((s) => s.pn === pn);
  }

  potting(pn: string) {
    return this.bundle.potting.find((p) => p.pn === pn);
  }

  hardwareFor(type: HardwarePart["type"], diaMm: number) {
    return this.bundle.hardware.filter((h) => h.type === type && diaMm >= h.minDiaMm && diaMm <= h.maxDiaMm).sort((a, b) => a.maxDiaMm - b.maxDiaMm)[0];
  }

  /** Price/stock info for any PN (demo data, pattern matched). */
  supply(pn: string): SupplyRow | undefined {
    const key = normalizePn(pn);
    let best: SupplyRow | undefined;
    let bestLen = -1;
    for (const s of this.bundle.supply) {
      const pat = normalizePn(s.pattern);
      if (pat.endsWith("*")) {
        const pre = pat.slice(0, -1);
        if (key.startsWith(pre) && pre.length > bestLen) {
          best = s;
          bestLen = pre.length;
        }
      } else if (pat === key) return s;
    }
    return best;
  }

  alternates(pn: string): Alternate[] {
    const key = normalizePn(pn);
    return this.bundle.alternates.filter((a) => {
      const pat = normalizePn(a.pn);
      return pat.endsWith("*") ? key.startsWith(pat.slice(0, -1)) : pat === key;
    });
  }
}
