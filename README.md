# Harness Studio — 2D wire harness design tool (Phase 1)

Browser-based design tool for 38999-class wire harnesses, built from `harness-design-tool-spec.md`.
Phase 1 is a static site: everything needed to **design** is real; pricing, supply and ordering are
**demo data / mockups** and are labelled as such everywhere. Nothing leaves the browser.

## Run

```powershell
pnpm install
pnpm data:build        # validate + compile the flat-file catalog (runs before dev/build)
pnpm dev               # http://localhost:5173
pnpm test              # unit tests (model, tokens, DFM rules, io)
pnpm e2e               # Playwright: core flow + "no outbound design data" check
pnpm --filter @hs/web build
```

Toolchain: Node 24 LTS, pnpm 10 (installed to the user npm prefix; add `%APPDATA%\npm` to PATH).

## Layout

| Path | What |
|---|---|
| `apps/web` | React 18 + Vite app: canvas, pin cards, wire list, right rail (quote / DFM / BOM), dialogs, BOM + Outputs views |
| `packages/model` | Zod schemas, catalog index, command layer (Immer patches → unlimited undo/redo), net→wire sync, routing, lengths, bundle OD, finishing auto-completion, pedigree resolution |
| `packages/dfm` | Rules engine: 47 Manufacturer rules + design rule types, custom visual rules, precedence/stricter-wins, per-pedigree severities/params, waivers, incremental cache, ruleset import/diff |
| `packages/ops` | BOM, operations list (automated vs manual), normalized quote summary |
| `packages/io` | CSV/XLSX/WireViz import + export, part resolution, output package ZIP + SHA-256 manifest |
| `packages/docs` | Drawing and design report (react-pdf) |
| `packages/providers` | `CatalogProvider`, `QuoteProvider`, `OrderProvider`, `ProjectStore` with Phase 1 static/demo implementations |
| `packages/ui-tokens` | Design tokens (single source) + CI checks: WCAG contrast, CVD separation (Machado 2009), wire casing rule |
| `data/catalog/*.csv` | Hand-editable catalog (source of truth). `import-38999-report.md` lists extraction anomalies |
| `data/profile`, `data/library`, `data/demo` | Machine profile (Manufacturer ruleset), inspection catalog, starter rulesets / pedigree schemes / finishing presets, demo pricing |
| `scripts/data-build` | `import-38999.ts` (research → catalog), `seed-catalog.ts` (one-time seed), `index.ts` (validate + compile), `examples.ts` |

## Data status (read this)

* **Insert geometry:** 88 Series III arrangements are available. Only **9-35 is verified**; the rest are
  machine-extracted from MIL-STD-1560C and shown with an **UNREVIEWED** tag (MFG-CMP-005 info check).
  10 arrangements whose extraction was incomplete are excluded. Mixed contact-size layouts were
  assigned by a spacing heuristic where the location tables couldn't be parsed — see the import report.
* **Verified from spec text:** shell sizes, classes/finishes, grommet sealing ranges and gauges (MIL-DTL-38999N Table IV),
  22D/20/23 contact PNs.
* **Seed (verify before production use):** size 16/12 contact PNs, crimp/insertion tooling, wire OD/mass/resistance,
  M27500 code tables, all `HS…` generic finishing parts (backshells, braid, tape, sleeves, clamps, boots, labels, potting),
  accessory PN formats, masses.
* **Demo only:** `data/catalog/supply.csv` and `data/demo/pricing.json` — arbitrary numbers, never real costs.

## Known deviations / deferred

* Coax/twinax/fiber contacts, CEL advanced rules, revision diff, share links, accounts, real ordering: Phase 2 per spec.
* Layer extents are edited numerically (drag handles on the canvas not implemented); labels are positioned by distance.
* PDFs render on the main thread (not in a Web Worker).
* Connectors face left/right only (text stays upright); no arbitrary rotation.
* Mobile read-only viewer not built (tied to share links, Phase 2). Telemetry omitted (would be the only outbound traffic).
* Performance (headless, software-rendered Chromium, 20 connectors / 1,000 wires): pan 60 fps; an edit re-renders in ~80 ms;
  wheel-zoom ~30 fps; DFM round-trip 130–170 ms. Needs confirming on a GPU browser; the spec's fallback is a canvas/WebGL wire layer.
