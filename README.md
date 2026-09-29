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

* **Insert geometry:** 88 Series III arrangements are available. Only **9-35 is verified**. The rest are
  machine-extracted from MIL-STD-1560C and shown with an **UNREVIEWED** tag. They block a "ready" claim
  (MFG-CMP-005) and are never machine-ready.
  10 arrangements whose extraction was incomplete are excluded. Mixed contact-size layouts were
  assigned by a spacing heuristic where the location tables couldn't be parsed — see the import report.
* **Verified from spec text:** shell sizes, classes/finishes, grommet sealing ranges and gauges (MIL-DTL-38999N Table IV),
  22D/20/23 contact PNs.
* **Seed (verify before production use):** size 16/12 contact PNs, crimp/insertion tooling, wire OD/mass/resistance,
  M27500 code tables, all `HS…` generic finishing parts (backshells, braid, tape, sleeves, clamps, boots, labels, potting),
  accessory PN formats, masses.
* **Demo only:** `data/catalog/supply.csv` and `data/demo/pricing.json` — arbitrary numbers, never real costs.

## Editing bundle branching

With three or more connectors, the canvas shows a one-time tip. The gestures:

* **Branch off a bundle:** drag from the middle of a bundle. Drop on a connector to route that connector through
  the new breakout. Its now-redundant direct bundle is removed, and a message says so.
* **Combine into a trunk:** Shift+click two bundles that leave the same connector, then click **Combine into
  trunk** in the context bar. The trunk length comes out of both branches, so wire lengths are preserved.
* **Re-attach a bundle end:** select a bundle and drag one of its ○ end handles. Drop it on a connector, a
  breakout or another bundle; dropping on a bundle splits it there. The same control is available from the
  keyboard: Length popover → *Bundle ends*.
* **Join breakouts:** drop a breakout onto another breakout, a connector or a bundle.
* **Add a breakout:** press **B** or use the toolbar button, then click a bundle.

Moving things on the schematic never changes physical lengths. Lengths created from defaults, or from where a
branch was dropped, are flagged as `default` until someone enters or confirms them (check `MFG-DOC-005`).

## Review changes (feedback of 2026-09-28)

| Item | What changed |
|---|---|
| FIX-01 frozen revisions | Commands never normalize a frozen revision. A frozen revision's build class can't be switched. Editing the pedigree scheme doesn't touch released revisions. `freezeRevision` stores a typed, versioned `ReleaseSnapshot`: all release inputs, catalog/profile/inspection identities, SHA-256 of the design and inputs, results as released, and hashes of the deterministic outputs. `projectForRevision()` rebuilds documents and analysis from the release inputs. `verifyRelease()` detects tampering. Output packages record whether regenerated outputs still match the release. |
| FIX-02 rule failures | Outcomes are `pass / fail / waived / off / notApplicable / notEvaluated / missingInput / engineError`. A failed evaluation is never a pass. Other failures that can't pass: unknown rule types, missing or invalid numeric params, and unsafe regexes (a safe subset only). A new headline status, **incomplete** ("Needs review before it can be called ready"), lists the blockers. Worker failures show "Checks didn't run". |
| FIX-03 cache | Each cached result records which inputs the evaluation actually read (tracking proxy over harness slices, derived data, project settings). The cache key includes catalog, profile content, resolved pedigree and qty/tier. A test checks cached against fresh results after settings, topology, part, rule, profile and catalog edits. |
| FIX-04 precedence | Nothing is superseded. Every rule is evaluated independently; duplicates only get an informational note. |
| FIX-05 drains/shields | A drain-to-pin termination is a physical conductor (`Termination.drain`) with a contact, a BOM wire line, cut/strip and contact operations. It's never counted as a sealing plug. Individual shields add braid material (category **Shielding**); termination `partPns` go to **Termination hardware**. BOM, operations and the sealing check share one cavity model (`cavityStates`). |
| FIX-06 contacts | `setPinContact` rejects gender or size mismatches (`CommandRejectedError`). The new rule `MFG-ELEC-006` flags mismatches that arrive via files. |
| FIX-07 inspections | Resolved test parameters travel with operations and the quote summary, so changing a limit changes the quote identity. Unknown inspections are kept, flagged `unsupported` and force review. `inHouse` and `automated` are separate fields. |
| FIX-08 QPL | No PN-prefix inference. `data/catalog/qualifications.csv` holds explicit evidence (source, evidence, expiry); a missing record means `unverified`. The file ships **empty**: the owner must supply evidence. |
| FIX-09 coverings | Layer stacks are computed per interval (`segIntervals`). Fittings query the diameter at the actual end. Regression: 1.32 mm core with two disjoint 0.4 mm sleeves gives 2.12 mm. |
| FIX-10 approvals | Unreviewed insert geometry is never machine-ready. Contact tooling has its own `tooling_status` (default `seed`). Seed or unreviewed data used by the design blocks "ready" (`MFG-CMP-005`, `MFG-CMP-007`). The examples therefore show "Needs review" and the quote is an estimate. |
| Async results | Results are accepted only when generation, project and revision match. Results are cleared on project/revision switch. The worker gets the catalog/profile snapshot from the provider-backed services, and its errors are surfaced. |
| Pedigree compare | Each candidate class is resolved to its own construction (`configureForPedigree`: boots, markings, clamps) before its checks, BOM and price. |
| Normalization | Repairs are reported: duplicate or invalid pin memberships, removed customised wires, removed redundant bundles. On open, files get an explicit schema migration (v1→v2), Zod validation and semantic validation (`validateProject`); diagnostics are shown and nothing is changed until the first edit, which reports any repair. Unsupported newer schema versions are refused. |
| Sealing | `MFG-FIN-012` now checks every cavity: unsupported cavities, missing plugs, contacts without a conductor, two conductors in one grommet hole, and signals assigned but unwired. |
| Daisy chains | A 3+ pin net whose pins sit on exactly two connectors, the same count on each, is wired as **parallel** pin-to-pin wires automatically (1st↔1st in cavity order; no splice, no double crimp). Any other 3+ pin net needs a splice or an explicitly confirmed daisy chain (`MFG-CONN-006`). The net popover's *Construction* setting overrides this. |
| Quote | Continuity is priced once. Critical parts are computed per quantity cell. Customer-furnished arrival days push ship dates; unknown arrival is stated as an assumption. Incomplete checks, unreviewed data and unknown inspections force "needs review". |
| BOM | Engineering quantities are unrounded. Purchase quantities round up (`purchaseQty`). The critical path counts only lines whose stock doesn't cover the order. Supply dates are shown as a range (oldest first). Each line has a data status and a qualification status. |
| Persistence | Status shows "Saved on this device" only when the current edit generation is stored. It also covers quota and storage errors, and multi-tab conflicts (BroadcastChannel plus a stored-copy check), with *load theirs / keep mine / download*. It warns before closing with unsaved work. |
| Redaction | Package presets apply `{pricing, supply}` redaction to every file: report sections, BOM columns, DFM supply findings, and the native file's stored quote. |

Machine profile is now **3.3** (4 new rules: `MFG-CONN-006`, `MFG-ELEC-006`, `MFG-CMP-007`, `MFG-DOC-005`; `MFG-CMP-005` and `MFG-FIN-012` raised to warning). Tests: `packages/io/src/regressions.test.ts` (FIX-01 to FIX-10 and the items above) and `packages/providers/src/quote.test.ts`. Dev aids: `scripts/check-examples.ts` and `scripts/bench-dfm.ts` (1,000 wires in Node: 73 ms cold, 20–38 ms cached).

### Owner decisions still open (represented as unknowns, not invented)

* **Approved launch parts and processes:** `qualifications.csv` is empty and all seed data stays flagged. Nothing will reach "ready" until reviewed data is marked `verified`, including contact `tooling_status`.
* **Engineering limits and test procedures:** the profile limits and inspection defaults are demo values. The default drain pigtail length (75 mm) is flagged for confirmation.
* **Measurement and clocking conventions; release and waiver roles:** `ReleaseSnapshot.approvals` exists but nothing fills it automatically.
* **Allowed cloud data classes:** Phase 1 still uploads nothing.
* **Which rules require human review:** today these are the `review` rule types plus severity/`manual` flags.

### Not done from the review (P1/P2)

* An explicit conductor model: wires are still derived from nets; removals of customised wires are reported rather than prevented.
* Locked routes/waypoints; net-merge and paste previews; a resizable inspector; a full table workspace.
* Structured test plans; per-field provenance beyond the row and tooling status; typed alternate relationships; snapshots of historical catalog data (a release stores catalog identity and results, not the catalog itself).
* Server-side authority and commercial state machines (P2).

## Known deviations / deferred

* Coax/twinax/fiber contacts, CEL advanced rules, revision diff, share links, accounts, real ordering: Phase 2 per spec.
* Layer extents are edited numerically (drag handles on the canvas not implemented); labels are positioned by distance.
* PDFs render on the main thread (not in a Web Worker).
* Connectors face left/right only (text stays upright); no arbitrary rotation.
* Mobile read-only viewer not built (tied to share links, Phase 2). Telemetry omitted (would be the only outbound traffic).
* Performance (headless, software-rendered Chromium, 20 connectors / 1,000 wires): pan 60 fps; an edit re-renders in ~80 ms;
  wheel-zoom ~30 fps; DFM round-trip 130–170 ms. Needs confirming on a GPU browser; the spec's fallback is a canvas/WebGL wire layer.
  The spec's other workload (50 connectors / 2,000 wires) and reference hardware aren't benchmarked yet.
