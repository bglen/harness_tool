import type { RuleInstance } from "./schema";

/** Machine capability profile (served by the backend in Phase 2; a versioned file in Phase 1). */
export interface MachineCapabilities {
  connectorSlashes: string[];
  contactSizes: string[];
  wireGaugeMin: number;
  wireGaugeMax: number;
  maxConnectors: number;
  maxWireLengthMm: number;
  minWireLengthMm: number;
  envelopeMm: number;
  cutResolutionMm: number;
  packingFactor: number;
  breakoutAllowanceMm: number;
  automatedCoverings: string[];
  automatedFinishing: string[];
  supportsSplices: boolean;
  supportsDaisyChain: boolean;
  supportsPotting: boolean;
  labelTypes: string[];
}

export interface MachineProfile {
  version: string;
  name: string;
  capabilities: MachineCapabilities;
  rules: RuleInstance[];
}

export interface InspectionParamDef {
  key: string;
  label: string;
  type: "number" | "enum" | "table" | "string";
  unit?: string;
  options?: string[];
  default?: unknown;
}

export interface InspectionType {
  id: string;
  name: string;
  description: string;
  /** Performed by the manufacturer (vs sent out). */
  inHouse: boolean;
  /** Runs on automated equipment without operator judgment. Independent of inHouse (FIX-07). */
  automated?: boolean;
  samplingOptions: string[];
  params: InspectionParamDef[];
  costPerUnit: number;
  setupCost: number;
  leadDays: number;
}

export interface DemoPricing {
  note: string;
  currency: string;
  materialMarkup: number;
  machineRatePerMin: number;
  manualRatePerMin: number;
  opMinutes: Record<string, number>;
  manualOpMinutes: Record<string, number>;
  setupNre: number;
  setupPerUniqueConnector: number;
  setupPerManualOpType: number;
  quoteValidityDays: number;
  leadTiers: { id: string; name: string; days: number; multiplier: number }[];
  quantityFactors: { qty: number; factor: number }[];
  latencyMs: [number, number];
}
