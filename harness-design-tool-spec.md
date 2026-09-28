# 2D Wire Harness Design Tool — Product & Software Requirements

**Status:** Draft v0.1 · **Owner:** Brian · **Date:** 2026-09-27
**Purpose of this doc:** Hand-off spec for implementation with Claude Code. Sections marked **[DECISION]** are implementation choices made on Brian's behalf; change them freely. Sections marked **[OPEN]** need an answer before or during build.

---

## 1. Product summary

A browser-based tool for designing high-reliability (38999-class) wire harnesses by direct visual construction: pick connectors, define pinouts, connect signals — all on one canvas — while an instant quote, live DFM (design-for-manufacturing) checks and BOM analysis update continuously. The design file is the order, and it is also the input to the automated harness machine's "slicer."

**Target user:** Electrical/hardware engineers fluent in PCB CAD (Altium, KiCad) and instant-quote manufacturing sites (JLCPCB, Xometry, SendCutSend). They expect: keyboard shortcuts, precise numbers with units, a netlist/table view, DRC-style checks, and a price that updates as they design.

**Positioning goals the UI must carry:**
1. **Zero-tutorial** — a first-time user builds a 2-connector harness without reading anything.
2. **Pro credibility** — it should look and feel like serious engineering software (DRC-grade checks, rule IDs, units, weight, revision control), not a toy configurator.
3. **Legible to outsiders** — a screenshot should be understandable by someone who has never seen the tool.
4. **Order-ready** — every design is always one click from an order.

---

## 2. Design principles

1. **Canvas-first, direct manipulation.** The user builds by dragging from pins, clicking labels to edit them, and dragging connectors onto each other. Menus, dropdowns and panels are secondary paths, never the only path.
2. **Connectivity first, geometry second.** The canvas is a *harness diagram*, not a mechanical formboard. Placement is loose and forgiving; what matters is connectors, pins, signals, wires, bundles and segment lengths.
3. **Semantic zoom.** Zoomed out, the harness reads like a physical harness (connectors + bundles with wire counts and lengths). Zoomed in, it reads like a wiring diagram (individual colored wires into individual pins).
4. **Everything is live.** Quote, DFM, BOM, weight and wire list update within ~1 s of any edit. No "Run check" or "Get quote" buttons.
5. **Show the work.** Checks show what passed, not only what failed. Numbers show units and sources. This is where credibility comes from.
6. **Progressive disclosure.** Sensible defaults for everything (wire spec, gauge from contact size, colors, lengths) so a design is quotable immediately; detail is available on click.
7. **One source of truth.** Canvas, wire list table, BOM, drawing and export are all views of the same model; editing any editable view edits the model.

---

## 3. Screen layout **[DECISION]**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◧ Logo  Project name ▾  Rev B ▾  ◆ Flight T2 ▾  ✓ Saved   ↶ ↷  │ Design · BOM · Outputs │  Import  Export  Share  [ Order · $1,284 ▸ ] │
├──────────────────────────────────────────────────────────┬───────────────────┤
│                                                          │ INSTANT QUOTE     │
│                                                          │  qty × lead grid  │
│                    CANVAS                                │  Δ since last edit│
│   (connectors, pin cards, wires, bundles, breakouts)     ├───────────────────┤
│                                                          │ MANUFACTURABILITY │
│                                                          │  ● Ready / 2 err  │
│                                                          │  186 checks ▸     │
│         ┌───────────────────────────┐                    ├───────────────────┤
│         │ ↖  + Connector  ⑂  ✎  ⤢  │  ← floating toolbar │ BOM SNAPSHOT      │
│         └───────────────────────────┘                    │  cost / lead top 3│
├──────────────────────────────────────────────────────────┴───────────────────┤
│ ▲ Wire list (collapsible spreadsheet, synced with canvas)                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2 connectors · 37 wires · 24 nets · 4.8 m wire · est. 212 g · 0 errors · 3 warn │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** project/revision, **pedigree switcher** (§10), save state, undo/redo, view switcher (Design / BOM / Outputs), Import, Export, Share, and the **Order** button (primary color, shows current price for the selected quantity/lead time).
- **Canvas (center):** where ~90% of work happens.
- **Floating canvas toolbar (bottom-center of canvas):** Select, Add Connector, Add Breakout/Splice, Add Note/Label, Zoom-to-fit. Nothing else.
- **Right rail (collapsible, ~320 px):** three stacked cards — Instant Quote (always visible, sticky top), Manufacturability, BOM Snapshot. Each card expands or links to its full view.
- **Bottom drawer:** Wire list spreadsheet, collapsed by default to a single header row; drag to open.
- **Status bar:** live counts, total wire length, estimated weight, DFM tally. Clicking a DFM count opens the DFM card.
- **No left property panel.** Properties are edited in contextual popovers attached to the selected object (see §5.4).

Responsive: minimum supported viewport 1280×720. Below 1280 px the right rail collapses to icons. Mobile = read-only viewer (for share links).

---

## 4. Core concepts & data model

### 4.1 Entities

| Entity | Description | Key fields |
|---|---|---|
| **Project** | Top-level container | id, name, owner, revisions[], units (mm/in), pedigreeSchemeRef, allowedPedigrees[], created/updated |
| **Revision** | Immutable snapshot + working draft | id, label (A, B…), notes, harness, activePedigreeId, frozen flag |
| **Pedigree** | Build class (§10) | id, name, code, rank, color, extends?, workmanship standard, inspections[], parts policy, process constraints, documentation[], markings[] |
| **Harness** | The design | connectors[], nodes[], segments[], nets[], wires[], cables[], shields[], layers[], terminations[], clamps[], boots[], potting[], labels[], hardware[], notes[] |
| **ConnectorInstance** | A placed connector | id, refDes (P1, J2…), partId (DB), position {x,y}, rotation, clocking, backshell {partId, angle, clockingDeg}, accessories[] (caps, lanyards, gaskets, jam nut), pinAssignments[] |
| **PinAssignment** | One cavity of a connector | cavityId, contactPartId (derived default), netId \| null, sealingPlug (auto when empty) |
| **Net** | Electrical signal | id, name (e.g. `+28V_A`), class (power/signal/RF/ground/spare), current? (A), members[] (connector+cavity refs) |
| **Wire** | Physical conductor between two terminations | id, netId, from {connectorId, cavityId \| spliceId}, to {…}, wirePartId, gauge, color code (base + stripes), cableId?, twistGroupId?, shieldId?, routedPath (segmentIds[]), computedLength |
| **Cable** | Multi-conductor cable used as one unit (e.g., M27500 shielded, jacketed) | id, partId, conductor→wire map, shieldId?, jacket, strip-back lengths at each end |
| **Node** | Topology point: connector end, breakout, splice | id, type (connector \| breakout \| splice), position |
| **Segment** | Physical bundle run between two nodes | id, nodeA, nodeB, length (user-set), tolerance, computedBundleOD, label |
| **TwistGroup** | Twisted pair/triple | id, wireIds[], twistRate? |
| **Shield** | Individual shield (wire group or cable) | id, wireIds[] or cableId, material, terminations per end (§6.4) |
| **Layer** | One finishing layer on the bundle: overbraid, tape wrap, sleeve, heat shrink, jacket, conduit | id, type, partId, extents[] {segmentId, start, end} (default whole segment), stackOrder, params (coverage %, overlap %, color…), auto flag |
| **Termination** | How a shield or braid ends at a node | id, targetId (shield/layer), nodeId, method (360° band clamp, EMI ring, solder sleeve to drain pin, floating, fold-back), partIds[], auto flag |
| **Clamp** | Band clamp / strap | id, terminationId or layerId, partId (size), quantity (single/double), tension spec, auto flag |
| **Boot** | Molded or heat-shrink boot or transition | id, nodeId, shape (straight, 90°, Y, T, …), partId, auto flag |
| **Potting** | Potting at a connector rear or splice | id, targetId, compoundPartId, depth or volume, mold/boot partId, cure time |
| **Label** | Marker/sleeve label | id, attachedTo (wire \| segment \| connector \| cable), template text, resolved text, type (sleeve, flag, direct print), position along length, auto flag |
| **Hardware** | Tie-down and support points (documentation) | id, segmentId, position, type (cushion clamp, spot tie, lacing), partId? |

### 4.2 Derivation rules **[DECISION]**
- **Nets are the source of connectivity; wires are derived and then editable.** When a net has 2 members → 1 wire. When a net has ≥3 members → default topology is a **daisy chain** in node order; user can switch to **splice** (star) from the net's context menu. DFM flags multi-member nets because splices/daisy chains affect automation (see §9).
- **Wire routing:** each wire's `routedPath` is the shortest path through the segment graph between its two nodes. If no path exists when a wire is created, a direct segment is auto-created between the two connector nodes.
- **Wire length** = sum of segment lengths on its path + connector termination allowance (per connector part, from DB) + breakout allowances + service loop (global setting, default 0). Rounded up to the machine's cut resolution.
- **Defaults** (all editable, all global in Project Settings):
  - Wire spec: M22759/16 (or DB default), gauge chosen from the contact size (e.g. size 20 contact → 20 AWG; size 22D → 22 AWG).
  - Color: white; optionally auto-assign per net class. Colors follow MIL-STD-681 codes and are rendered accurately (base + stripe).
  - Contact part: derived from connector series + cavity size + gender.
  - Unused cavities: sealing plug auto-added to BOM.
  - Backshell: DB default for series/shell size, or "none."
  - Segment length: 300 mm on creation.

### 4.3 Persistence **[DECISION]**
- Native format: versioned JSON (`.harness.json`) with `schemaVersion`. Validate with Zod on load. Stable UUIDs for all entities (the machine slicer will reference them).
- Autosave: every change debounced 1 s → IndexedDB in the browser. Users can also save/open `.harness.json` files at any time (Ctrl+S downloads, drag a file onto the canvas to open). Cloud saving arrives with accounts in Phase 2 (§15.1). Save state shown in top bar.
- Revisions: user can "Freeze Rev A" (immutable) and continue on Rev B. Diff view between revisions is Phase 2.

---

## 5. Canvas: visual language & interaction

### 5.1 Rendering **[DECISION]**
- **SVG rendered by React**, one `<g>` transform for pan/zoom. Rationale: crisp at any zoom, trivial hit-testing, and the same geometry exports directly to PDF/SVG drawings.
- Performance budget: 60 fps pan/zoom at 50 connectors / 2,000 wires. If profiling misses this, move the wire layer to a `<canvas>`/WebGL layer beneath the SVG and keep SVG for interactive elements. Memoize per-entity components; never re-render the whole scene on a single edit.
- Background: subtle dot grid; snap-to-grid on by default (hold Alt to disable).

### 5.2 Visual representation of parts
Goal: representative of the real thing, calm to look at, readable by a newcomer.

- **Connector** = two linked pieces:
  - **Glyph**: simplified side-profile silhouette distinguishing plug / receptacle (wall-mount, jam-nut, inline) and showing backshell if assigned. Drawn in neutral grey with a thin outline; the mating face points *away* from the bundle.
  - **Pin card**: a compact table attached to the glyph listing cavities — `pin ID | signal name | wire gauge/color swatch`. Rows are the drag handles for connections. Wires attach at the row edge facing the bundle.
  - Header shows `refDes` (bold), part number (monospace), and a small face-view thumbnail of the insert; hover/click the thumbnail to expand an **insert face view** with clickable cavities colored by assignment (assigned / spare / plugged / error).
  - Large connectors: pin card shows used pins by default with a "+ 43 unused" row to expand.
- **Bundle segment** = thick rounded stroke whose width scales (log) with wire count; overall braid shown as a cross-hatch texture; sleeving/tape as a fill tint. Mid-segment chip shows **length** (editable) and wire count.
- **Wire** (zoomed in) = thin line in its true insulation color (with stripe pattern), running as a ribbon inside the bundle and fanning out to its pin row. Wires that lack contrast against the canvas get a thin casing, and state is never shown by recoloring a wire (§16.4).
- **Twisted pair** = the pair drawn with a periodic twist mark near both ends.
- **Individual shield** = standard ellipse-around-wires symbol near each end, with drain wire shown if present.
- **Breakout** = small filled circle node on the bundle. **Splice** = distinct diamond node with its part number on hover.
- **Labels** = small tag icons on the wire/segment at their position.
- **DFM markers** = a small severity badge pinned to the offending object (red ⨯ error, amber ! warning, blue i info) — icon + color, never color alone.

### 5.3 Semantic zoom levels **[DECISION]**
| Zoom | What's shown |
|---|---|
| **Overview** (< 40%) | Glyphs, refDes, bundles with wire count + length, DFM badges. Pin cards collapsed to a single "37 pins" chip. |
| **Harness** (40–120%) | Pin cards with pin ID + signal name; wires shown as colored ribbon inside bundles. |
| **Detail** (> 120%) | Full pin cards (gauge, color, contact PN), individual wire lines with fan-out, twist/shield symbols, label text. |

### 5.4 Interactions (the whole design loop happens here)

**Adding connectors**
- Empty canvas shows one centered call to action: **"+ Add your first connector"** and, beneath it, "or import a wire list" and "or open an example."
- Double-click empty canvas, press `C`, or use the toolbar → **part picker popover at the cursor** (not a modal):
  - Single search box accepting free text / part numbers (`D38999/26WB35SN`, `38999 13-35 socket`).
  - Below it, **faceted chips**: Series → Shell size → Insert arrangement (with face-view preview) → Contact gender → Keying → Finish → Mount style. Choosing facets builds a valid PN live.
  - Every result shows unit price, stock/lead time, and a **"Machine-ready" badge** if the part is supported by automated assembly.
  - Enter places the connector at the cursor; the pin card opens in edit mode on the first pin.

**Defining the pinout**
- Click a signal-name cell to type. `Enter` moves down, `Tab` moves to the next column (Excel behavior).
- **Paste a column** of names from Excel/an ICD into the pin card; it fills downward from the selected pin.
- Typing a signal name that already exists on another connector **joins that net** and immediately draws a dashed **ratsnest line** (PCB-tool convention) between the pins; see "committing" below.
- Autocomplete from existing net names.
- Click a cavity in the insert face view to jump to that row.

**Connecting**
- **Drag from a pin row to another pin row** → creates/merges a net and creates a wire. Valid targets highlight during drag; invalid targets (occupied cavity, incompatible contact size) are dimmed with a reason on hover.
- **Drag from a pin row to empty canvas** → part picker opens; new connector is placed with the wire landing on the equivalent pin (same pin ID if it exists, else first free).
- **Drag a connector (by its glyph) onto another connector** → popover: **Connect by signal name** / **Pin-for-pin (1→1)** / **Map manually…**. This makes extension cables and adapters a 2-second job.
- **Multi-select pin rows** (Shift/Ctrl-click, or drag-select) and drag the group onto another connector → connects sequentially from the drop pin.
- **Ratsnest lines** (same net, no wire yet) are drawn dashed. Double-click one, or press `R` with connectors selected, to **commit** into wires. Setting "Auto-commit" (default ON) makes this invisible for novice users; pros can turn it off.

**Building the physical structure**
- **Drag from the middle of a bundle** → pulls out a breakout node with a new branch segment; drop onto a connector to route the branch there, or into empty space to create a free breakout.
- Click the **length chip** on any segment to type a length (units follow project setting; accepts `12in`, `300mm`, `1.2m`).
- Drag connectors and breakout nodes freely; layout is cosmetic (except lengths, which are explicit).

**Editing properties — contextual popover [DECISION]**
- Selecting anything shows a **floating context bar** above the selection (Figma-style) with the 3–5 most relevant actions, e.g.:
  - Wire(s): Gauge · Color · Twist · Shield · Label · Delete
  - Connector: Part · Backshell · Accessories · Label · Potting · Rotate · Duplicate · Delete
  - Segment: Length · Covering (layer stack, §6.6) · Label · Tie-downs
  - Net: Rename · Class · Topology (daisy/splice)
- A "More…" item opens a compact property sheet popover for everything else. Right-click shows the same menu. No persistent inspector panel.

**Grouping**
- Select 2–3 wires → **Twist**. Select wires → **Shield** (choose termination). Select segments → **Overall braid**.

**Always available**
- `Ctrl/Cmd+K` command palette for every action (search by name).
- Undo/redo (`Ctrl+Z / Ctrl+Shift+Z`), unlimited within session, command-pattern based.
- Copy/paste connectors with pinouts; duplicate (`Ctrl+D`).
- `F` zoom to fit, `Space`+drag or middle-mouse to pan, scroll to zoom.
- Tooltips on every control show the keyboard shortcut.
- Cross-probing: selecting a row in the wire list selects on canvas and vice versa; clicking a DFM item zooms to the offending object.

### 5.5 Zero-tutorial affordances
- Empty state with a single CTA plus "Open example: 2-connector 38999 jumper."
- **Ghost hints** that appear once and disappear after first successful use: e.g., hovering a pin row the first time shows a small "drag to connect" handle label; after the first connector, a hint reads "Add a second connector, then drag between pins."
- Every icon button has a text tooltip. No hidden gestures without a visible alternative (every gesture has a context-menu equivalent).
- Error prevention over error messages: invalid drop targets are dimmed *during* the drag.
- Inline validation explains *why* and offers a **one-click fix** where possible ("22 AWG too small for size 16 contact → Change to 16 AWG").

---

## 6. Design functionality: building a complete harness

§5 covers *how* the user interacts. This section covers *what* they can build: every element of a finished harness, from connector to label. Each element follows the same pattern:

- **Canvas first:** added and edited from the context bar of the object it belongs to (connector, segment, wire, node). The same actions exist in the right-click menu and command palette.
- **Smart defaults and auto-completion:** the tool adds and sizes dependent parts automatically (e.g., adding an overbraid adds band clamps at each backshell, sized to the computed diameter). Auto-added items show a small "auto" marker and follow design changes. When the user edits one, it becomes "pinned" and is no longer changed automatically; DFM then checks it like any other part.
- **Everything flows downstream:** each element appears in the BOM, generates operations for the quote and machine slicer (§8.2), is checked by DFM (§9.3), and is drawn on the drawing and in the report (§13).

### 6.1 Connectors and accessories
- **Connector:** part picker (§5.4), refDes, plug/receptacle, **clocking** (key orientation) for the drawing.
- **Backshell:** chosen from parts compatible with the connector's series and shell size. Options: straight / 45° / 90°; **angle clocking** (which way a 90° backshell points, shown on the glyph); style (strain relief clamp, EMI/RFI with band-clamp platform, shield-termination ring, potting boot adapter). Filtered by the computed bundle diameter so the cable clamp range fits.
- **Accessories:** dust caps and covers (with or without lanyard), receptacle jam nuts, o-rings/gaskets, grounding rings. Offered as toggles in the connector's context bar, with the compatible part preselected.
- **Unused cavities:** sealing plugs added automatically, or filler contacts if the user or pedigree requires wired spares.

### 6.2 Contacts
- Derived automatically from connector series, cavity size and gender, plus the wire gauge (some contacts are gauge-specific). Shown in the pin card at Detail zoom.
- Override per pin or per selection (e.g., gold-plated vs. standard, or a special contact type). Incompatible choices are dimmed with the reason.
- Crimp tooling (crimp tool, positioner/turret, insertion/removal tool) is derived from the contact and listed in the drawing notes and report. Tooling is not a BOM item.
- **Phase 2:** coax, twinax, triax and fiber contacts with their cable types and termination steps.

### 6.3 Wires and cables
- **Wire picker:** by spec (e.g., M22759/16, /32, /33, /44, /86), gauge, color (base + up to 3 stripes, MIL-STD-681). Pickers show insulation OD, weight per length and current rating. Set on one wire, a selection, a whole net class (e.g., all `power` nets), or as the project default.
- **Twisted pairs/triples** (§5.4) without a jacket.
- **Multi-conductor cables:** placed as a unit (e.g., an M27500 shielded, jacketed twisted pair). A cable picker builds the part number from its parameters (conductor spec, gauge, count, shield type, jacket), similar to the connector picker. Each conductor maps to a net; the cable is drawn as one line with its conductors fanning out near the connector. Jacket and shield strip-back lengths at each end come from defaults and are editable.
- **Drain wires** are part of shields or cables and can be terminated to a pin (§6.4).

### 6.4 Shielding and grounding
This matters a lot to the target audience (EMC-driven designs), so it gets a dedicated visual mode.

- **Individual shields** (wire group or cable shield), with **termination defined separately at each end:**
  - 360° to the backshell (band clamp or EMI ring)
  - Drain or pigtail to a connector pin (solder sleeve or crimp)
  - Floating (folded back and insulated)
  Common presets: "Both ends 360°", "Ground at P1 only", "Drain to pin". The pin receiving a drain is assigned automatically to a ground net the user names.
- **Overall braid (overbraid)** on one or more segments: material (tinned copper, nickel-plated copper, stainless, lightweight metal-clad fiber), optical coverage % (default 85%), and termination at each end (360° band clamp at the backshell platform by default). At a breakout, each branch is braided and the braids are joined at the breakout; the tool shows this as a braid junction and adds the required band clamp or transition part.
- **Shield view** (toolbar toggle, `G`): dims everything except shields, braids, drains and their terminations. Each shield is drawn as a continuous path, and termination points are marked by type (360°, drain-to-pin, floating). This shows the grounding scheme of the whole harness at a glance. Floating or unterminated ends are flagged.
- DFM checks (§9.3): shield without a termination at either end; braid coverage below the pedigree minimum; 360° termination on a backshell without a band-clamp platform; drain pin not on a ground net.

### 6.5 Band clamps
- Added automatically wherever a braid or shield ends in a 360° termination on a band-clamp-platform backshell (single band by default; double band per pedigree or on user request).
- Size chosen from the computed diameter at that point (bundle + layers under the clamp). Tension spec and banding tool are taken from the clamp part data.
- Also available manually, for example to secure a braid junction at a breakout.
- Shown on the canvas as a thin metallic ring at the backshell end of the segment; hovering shows part number and size.

### 6.6 Layers: tape wrap, sleeving, heat shrink, jacketing
Everything wrapped around the bundle is a **layer** with a position in the stack.

- **Layer stack editor:** selecting a segment and choosing **Covering** opens a popover that shows the stack from inside out (e.g., *wires → PTFE tape → overbraid → heat-shrink jacket*), with a small cross-section icon and the outside diameter after each layer. Layers are added from a palette and reordered by dragging.
- **Layer types:**
  - Tape wrap: PTFE, polyimide (Kapton), fiberglass, self-fusing silicone; overlap % (default 50%) and wrap direction.
  - Expandable braided sleeving: PET, Nomex, fiberglass.
  - Heat shrink sleeving/jacket: shrink ratio chosen so the recovered size fits the diameter underneath.
  - Convoluted tubing / conduit.
  - Overbraid (§6.4) is also a layer, so its position in the stack is explicit.
- **Extents:** a layer covers the whole segment by default. Dragging handles along the segment limits it to part of the length (e.g., an abrasion sleeve where the harness passes through a panel). Extents can also be typed as distances from either node.
- **Multiple segments:** selecting several segments and adding a layer applies it to all of them, merged into one continuous layer through breakouts where that is physically possible.
- **On the canvas:** layers change the bundle's look subtly: tape and sleeving as a fill tint, braid as a cross-hatch, jacket as an outer stroke. Partial extents show start and end ticks. Clicking the bundle's diameter chip opens the stack.

### 6.7 Boots and transitions
- **Backshell boots:** heat-shrink or molded boots (straight or angled) at the connector end, covering the backshell adapter and the start of the bundle. Size chosen from backshell and bundle diameters.
- **Breakout transitions:** Y, T and multi-leg shapes at breakouts, sized to each leg.
- Suggested automatically when a layer (e.g., a jacket) ends at a backshell or breakout. Pedigrees can require them.

### 6.8 Labels and marking
- **Label types:** printed heat-shrink sleeve markers (wires or bundle), flag labels, adhesive wrap-around labels, and direct marking on the insulation (laser or inkjet), if supported.
- **Placement:** at a set distance from a connector or breakout (default 50 mm from the backshell end), or anywhere along a segment by dragging.
- **Templates:** label text uses fields, e.g., `{refDes}`, `{wireId}`, `{harnessPN}-{rev}`, `{serial}`, `{pedigreeMarking}`. The resolved text shows on the canvas; overlong text is flagged against the label's printable length.
- **Labeling rules (one click):**
  - Every connector end labeled with its refDes (default on)
  - Every wire labeled with its ID at both ends
  - Harness ID label near P1
  - Pedigree markings (e.g., NOT FOR FLIGHT tag, §10.1)
  Rules produce auto labels, which the user can pin or delete individually.

### 6.9 Potting and sealing
- **Connector potting:** at the rear of a connector (inside a potting boot or backshell), with compound (e.g., polyurethane, epoxy, silicone), depth or computed volume, and the mold/boot part. Cure time is added to the lead time, and the operations model marks it as a manual step unless the machine profile supports it.
- **Splice potting / encapsulation** (§6.10).
- Environmental sealing: grommet seal verification (wire OD vs. the connector's sealing range) and sealing plugs in empty cavities, checked automatically.
- Because potting makes rework impossible, the tool asks for confirmation when potting is added, and pedigrees can require or forbid it.
- On the canvas, a potted connector's glyph gets a solid fill at the rear and a "P" badge.

### 6.10 Splices
- For nets with 3 or more members set to splice topology (§4.2): the splice becomes a node on a segment, with type (solder sleeve, crimp splice, ultrasonic), environmental cover (heat shrink or potting) and position along the segment.
- Splices are flagged by DFM as manual operations unless the machine profile supports them, and pedigrees can restrict their use (e.g., no splices at T1).

### 6.11 Support hardware and tie-downs
- **Tie-down points:** cushion clamps (e.g., MS21919-type), spot ties or lacing positions along a segment. Documented on the drawing with position and part number. Clamps are customer-installed, so they are shown on the drawing but are optional BOM items.
- **Spot ties / lacing:** a default spacing rule per segment (e.g., every 150 mm), shown on the drawing and counted as an operation.

### 6.12 Bundle diameter and physical checks **[DECISION]**
- The tool computes bundle diameter for each segment and at each point where layers change: `D_bundle = k · √(Σ dᵢ²)`, where dᵢ are the wire and cable ODs, and k (default 1.2, from the machine profile) accounts for packing. Each layer then adds 2 × its thickness.
- This diameter drives: backshell clamp range, braid and sleeve size, heat shrink recovered size, band clamp size, boot size, bend radius (a multiple of OD, set per pedigree) and weight.
- Shown as a chip on each segment next to the length (e.g., `⌀ 8.4 mm`). Hover shows the per-layer breakdown.

### 6.13 Finishing presets
- **"Finish harness"** action (toolbar and command palette) applies a **finishing preset** to the whole harness, or to a selection, in one click. Example: *overbraid all segments + 360° band clamps at every backshell + PTFE tape under braid + connector labels + wire ID labels*. The result is shown as a preview before applying, with the price change.
- Starter presets: `Unshielded, labeled`, `Overbraided`, `Overbraided + jacketed`. Users can save their own presets and share them in the same file as rulesets and pedigrees (§9.5.5).
- Pedigrees can name a required preset (e.g., Flight requires overbraid + labels), which DFM checks.

### 6.14 Phasing
Phase 1 is the full design tool (§18), so all of §6 is in Phase 1 except coax/twinax/triax/fiber contacts, which come in Phase 2.

The machine profile (§9.4) still marks which finishing items the machine can build automatically (initially backshells, overbraid, band clamps, tape wrap and labels). Everything else can be designed but is flagged by DFM as a manual operation.

---

## 7. Wire list (bottom drawer)

- Spreadsheet view of all wires: `Wire ID | Net | From (RefDes-Pin) | To (RefDes-Pin) | Gauge | Spec | Color | Length | Twist | Shield | Label`.
- **Fully editable** and bidirectional with canvas. Paste multi-row data from Excel directly in (acts as a fast import).
- Sort, filter, group by connector or net. Column visibility saved per user.
- Virtualized rendering (thousands of rows).
- Also offers a **Net view** tab (nets with member pins) and a **Connector view** tab (pinout tables per connector).

---

## 8. Instant quote

> **Phase 1:** the quote card is fully built and behaves exactly as described here, but prices come from demo rates computed in the browser (§18.2).

### 8.1 Display **[DECISION]**
- A **price matrix**: rows = lead time tiers, columns = quantity breaks. Default columns: 1 · 5 · 10 · 25 · 100 (user can edit/add a custom quantity). Default rows: **Standard**, **Expedited**, **Rush** — tier names, day counts and multipliers come from the backend.
- Each cell shows **unit price** (large) and **total** (small). Clicking a cell selects it; the selection drives the Order button label.
- Header shows **estimated ship date** for the selected cell, computed from lead time *and* component availability.
- **Change indicator**: after each edit, show delta vs. previous quote for the selected cell ("▲ $8.20/unit — added overall braid"), fading after a few seconds. Engineers love seeing the cost of a decision immediately.
- **Quote states:** `Updating…` (skeleton shimmer, keep old numbers visible dimmed) → `Instant quote` → `Needs review` (DFM errors or non-stock parts → price shown as estimate, Order becomes "Request quote") → `Unavailable` (with reason).
- "Price breakdown" expander: materials, machine time, manual operations (if any), inspection & test (itemized from the active pedigree, §10.5), setup/NRE (one-time), each with its amount. Show that NRE is amortized across quantity.
- The quote card header names the pedigree being quoted.
- Weight and total wire length shown alongside (aerospace users care).

### 8.2 Mechanics **[DECISION]**
- Quote is computed **server-side** (pricing model stays private). Client sends a normalized, pricing-relevant summary of the harness (BOM + operations list + DFM result hash), not the full design, on a 500 ms debounce after edits.
- Response target: < 1.5 s p95. Cancel in-flight requests on new edits (latest wins).
- Cache by design hash so undo/redo re-shows prices instantly.
- Operations model: the backend derives machine operations (connector placements, contacts inserted, wires cut/stripped/laid, braid, clamps, tape, labels, tests), **inspections required by the active pedigree** (§10.3), and any **manual operations** (splices, potting, non-automatable parts). The same derivation later feeds the machine slicer. Keep this in a shared package.

---

## 9. Live DFM (Manufacturability)

### 9.1 Presentation
- The right-rail card has **two separate headlines**, because they answer different questions. Both are evaluated against the **active pedigree** (§10), which is named on the card ("Checked against Flight T2"):
  - **Manufacturability** ("can we build it?"), from Manufacturer rules only: `● Ready for automated build` (green) / `● Buildable with manual steps` (amber) / `● Not buildable` (red), plus `186 checks · 0 errors · 3 warnings · 2 info`.
  - **Design rules** ("does it meet *your* standard?"), from team and project rules (§9.5): `✓ 42 checks passed` or `2 errors · 1 warning`, with the names of the active rulesets.
- Expanded view (drawer or full panel): checks grouped by category, each row showing **rule ID** (e.g. `MFG-MECH-004`, `TEAM-EMC-002`), a **source tag** (Manufacturer / Team ruleset name / Project), a short name, severity, affected objects count, and status. Can be filtered by source. **Passed checks are listed too** (collapsed by default under "183 passed"). This is a deliberate credibility signal.
- Clicking a rule shows: what it checks, why it matters (1–2 sentences), the threshold value and its source (machine capability profile / spec), affected objects (click to zoom), and one-click fix if available.
- Canvas badges on offending objects (§5.2). Hovering a badge shows the message; clicking opens the rule.
- Users can **waive** Manufacturer warnings (not errors) with a note. They can waive their own design-rule errors or warnings with a note, unless the ruleset is enforced (§9.5.5). Waivers are recorded in the design and on the drawing.

### 9.2 Severity model
- **Error**: for Manufacturer rules, the design cannot be built as designed (or cannot be built automatically at all), and Order becomes "Request quote." For design rules, it means a violation of the engineer's own standard (ordering behavior is covered in §9.5.5).
- **Warning** — buildable but adds manual operations, cost, lead time or risk.
- **Info** — best-practice suggestions.

### 9.3 Starter Manufacturer rule set (extend over time)
| Category | Examples |
|---|---|
| **Connectivity** | Net with a single member (dangling); pin with a signal name but no wire; same pin assigned twice; wire endpoints on the same connector (loopback) → info; floating shields |
| **Electrical** | Gauge vs. contact size compatibility; gauge vs. estimated current for power-class nets (if current is given); twisted pair members on different connectors' non-adjacent pins → info |
| **Mechanical** | Bundle diameter vs. backshell cable-clamp range; segment length below minimum; breakout spacing below minimum; minimum bend radius vs. bundle diameter; total wire length exceeds machine max; overall braid on a segment shorter than min |
| **Machine capability** | Connector series/part not supported for automated placement; contact type not supported for automated insertion; number of connectors exceeds build limit; harness envelope exceeds machine working area; splices/daisy-chains requiring manual operations; unsupported covering type |
| **Components** | Obsolete/NRND parts; out of stock; lead time beyond selected quote tier; missing backshell where one is required by series |
| **Documentation** | Missing refDes; duplicate refDes; unnamed nets; labels exceeding printable length |
| **Finishing** | Braid, sleeve, heat shrink or boot size vs. diameter underneath; band clamp size vs. diameter; 360° termination on a backshell without a band-clamp platform; shield or braid with an unterminated end; layer stack order not buildable (e.g., jacket under braid); partial extents overlapping illegally; wire OD outside the connector grommet sealing range; potting or splices requiring manual operations; finishing items not supported by the machine profile |

### 9.4 Engine **[DECISION]**
- A single engine evaluates every rule source. It lives in a shared TypeScript package (`packages/dfm`), runs **client-side** in a Web Worker for instant feedback, and re-runs **server-side** as the authoritative check at order time.
- Two kinds of rule implementation:
  - **Built-in rule types** are pure functions `(harness, params, context) → Violation[]` written in code. Examples: `gauge_vs_contact_size`, `bundle_od_vs_clamp_range`, `min_segment_length`, `pin_adjacency`. Each type declares a typed parameter schema.
  - **Rule instances** are *data*: a built-in type (or a custom expression, §9.5.3) plus parameter values, severity, scope, message and ID. All rulesets, including the Manufacturer profile, are lists of rule instances. The manufacturer uses exactly the same format that engineers do.
- `context` includes component data and the **machine capability profile** (served by the backend, versioned). Thresholds live in rule instance parameters, not in code. Machine upgrades and user edits therefore change limits without code changes.
- Incremental re-evaluation: rule types declare which entity types they depend on, and only affected rules re-run. Target < 100 ms for a typical edit, including user rules.
- Each rule instance has: id, source, category, severity, title, description, rationale, params, scope filter, optional `severityByPedigree` / `paramsByPedigree` maps (§10.4), and an optional `fix` (built-in types only).
- **Resolution order** for a rule's effective severity and params: rule base → pedigree override (following pedigree inheritance) → project override → stricter-wins against the Manufacturer layer.

### 9.5 Design rules & rulesets (user- and team-defined)

Engineers bring their own design standards: company EMC practice, derating policy, program-specific requirements. The tool treats these as first-class **rulesets** that are viewed, edited, shared and applied the same way as the Manufacturer rules.

#### 9.5.1 Rule layers and precedence **[DECISION]**
| Layer | Owner | Editable by user | Purpose |
|---|---|---|---|
| **Manufacturer** | Us (machine capability profile) | View only | Can we build it, and can we build it automatically |
| **Team / library rulesets** | An engineer or team | Yes (by owner/editors) | Company or program standards, shared across projects |
| **Project rules** | The project | Yes | One-off rules and overrides for this design |

- A project can apply **multiple** team rulesets plus its own project rules. The Manufacturer layer is always applied and cannot be removed.
- **User rules can add or tighten, never loosen, Manufacturer rules.** Example: a team may require min segment length 50 mm when the machine allows 25 mm, but not the reverse. If a user rule would be looser, the editor shows "Manufacturer limit is stricter (25 mm → 50 mm). This rule has no effect below that."
- Rule ID namespaces prevent collisions: `MFG-…`, `<RULESET-PREFIX>-…` (the prefix is set per ruleset, e.g. `ACME-EMC-003`), `PRJ-…`.
- Where two user rulesets define the same rule type on the same scope, the **stricter** value wins and both are shown as sources.
- A project can disable a team rule or downgrade its severity, unless that ruleset is enforced (§9.5.5). The override is recorded with a note.

#### 9.5.2 Built-in rule types users can configure
Every Manufacturer rule type is also available to users with their own parameters. On top of those, the starter library of design-oriented types includes:
- **Gauge minimums by net class** (e.g., power ≥ 18 AWG) and **derating** (current vs. gauge vs. bundle size, table-driven, e.g., per an AS50881-style derating table the user enters).
- **Required shielding / twisting** for nets matching a class or name pattern (e.g., `^CAN_` must be a twisted pair; `RF_*` must be individually shielded).
- **Pin adjacency / separation**: nets of class A must not be in cavities adjacent to class B on the insert face (uses cavity coordinates from the DB). Useful for EMC and for hipot/creepage reasons.
- **Segregation**: classes that must not share a bundle segment, such as noisy power and sensitive analog.
- **Spare pin policy**: minimum % spare cavities per connector, and whether spares must be sealed or wired.
- **Allowed parts lists**: connector series, finishes, wire specs and colors that are allowed or banned (e.g., cadmium finishes banned).
- **Naming conventions**: regex on net names, refDes, wire IDs and labels.
- **Required labels**: every wire, every segment end, or every connector must carry a label.
- **Color coding**: net class or name pattern → required wire color.
- **CVD-confusable colors**: flags wires on the same connector or in the same bundle whose colors are easily confused by color-vision-deficient technicians (§16.5).
- **Max lengths / weights**: per segment, per wire, or total harness weight budget.
- **Connector keying/uniqueness**: no two connectors with the same shell size and insert arrangement may share the same keying (prevents cross-mating). This is a common aerospace rule.

#### 9.5.3 Custom rules (beyond the built-in types) **[DECISION]**
- A **visual rule builder**: *For each* [wire | net | connector | pin | segment | shield] *where* [filter conditions] *require* [condition]. Filters and conditions are chosen from dropdowns of model properties (class, name matches, gauge, length, connector series, …). This produces a declarative JSON rule and covers most needs without code.
- An **advanced mode** accepts an expression in a sandboxed, side-effect-free expression language (**CEL** recommended; a JSONLogic fallback is acceptable) evaluated against a documented read-only view of the model. Expressions are type-checked on save, with inline errors.
- **No arbitrary JavaScript.** Rulesets are shared and imported between users, so executing code from them would be a security hole. The engine enforces time and memory limits per rule; a rule that exceeds them is disabled with an error shown.

#### 9.5.4 Rules manager UI
- Opened from the DFM card ("Rules ▸"), the command palette ("Manage rules"), or from any violation ("Edit this rule").
- **Left:** a tree of the active layers: Manufacturer (lock icon), each applied team ruleset (with version), and Project rules. There is also an "Add ruleset" button (library / import / new).
- **Center:** a table of rules with ID, title, type, scope, severity, enabled toggle, and **current result on this design** (✓ / count of violations). A toggle switches to the **pedigree matrix view** (§10.4).
- **Detail pane:** the parameter form or rule builder, message text and rationale field, plus a **live preview** ("This rule currently flags 3 objects", with click-to-highlight on canvas) that updates while the user edits.
- Manufacturer rules are shown read-only with their parameters visible. Transparency about limits is a credibility feature. A user can **"Duplicate as project rule"** to make a stricter copy.
- Bulk actions: enable/disable, change severity, move between project and ruleset (promote a project rule into the team ruleset).
- Everything needs to be discoverable without docs: rule types have plain-language descriptions and an example in the "Add rule" picker.

#### 9.5.5 Sharing, versioning, enforcement
- **Export/import** a ruleset as `.harnessrules.json` (versioned schema with `schemaVersion`, ruleset id, name, prefix, version, author, description, changelog, rules[]). YAML export (for teams that keep rules in git) comes with the Phase 3 team features.
- Import is validated with Zod. It shows a **diff/preview** before applying: new rules, changed parameters, and rules that fail validation or reference unknown rule types. Imported rulesets can never contain executable code, only data and CEL expressions.
- **Team library** (cloud, signed-in users): rulesets live in a team workspace. Owners/editors publish **versions** (semver). Projects pin a version and get an "Update available (v1.3 → v1.4)" prompt with a diff of what changed and how it affects this design's results.
- **Enforcement flag** (set by the ruleset owner): an enforced ruleset cannot be disabled or downgraded at project level, and its errors must be resolved or formally waived (with a named approver, Phase 3) before ordering.
- **Ordering behavior:** errors from non-enforced design rules do not block ordering. The order review step lists them and requires a one-click acknowledgment. Manufacturer rule behavior is unchanged (§9.2).
- **Reproducibility:** each frozen revision snapshots the exact ruleset versions and results used. The drawing notes list the applied rulesets and versions plus any waivers, so a reviewer can see which standard the design was checked against.

---

## 10. Pedigrees (build classes)

Companies build the same harness to different standards depending on use: development units, critical non-flight hardware (GSE, test sets), and flight hardware at several criticality tiers (e.g., T3 → T1). A **pedigree** captures everything that changes between those builds. The engineer designs once, switches pedigree with one click, and the tool guarantees that checks, quote, documents and the order all match the selected pedigree.

### 10.1 What a pedigree defines **[DECISION]**
| Aspect | Examples |
|---|---|
| **Identity** | Name (`Flight T1`), short code (`T1`), rank (order from least to most stringent), color, description. |
| **Rule behavior** | Severity per rule: off / info / warning / error. Optional parameter overrides per rule (e.g., derating factor 0.8 at Dev, 0.5 at T1; spare pins ≥ 0% at Dev, ≥ 10% at T1). Extra rulesets that apply only at this pedigree. |
| **Required inspections & tests** | Chosen from the inspection catalog (§10.3), each with parameters and sampling. |
| **Workmanship standard** | e.g., IPC/WHMA-A-620 Class 2, Class 3, Class 3 with space addendum; NASA-STD-8739.4. |
| **Parts & materials policy** | QPL/approved-parts only, no alternates without approval, restricted finishes, authorized-distribution-only sourcing (counterfeit avoidance), date-code age limits. |
| **Process constraints** | e.g., splices not allowed, manual rework not allowed, serialized labels required. |
| **Documentation & certification** | CoC, AS9102 FAI, material certs, traceability level (lot vs. serial), test data package, customer source-inspection hold points. |
| **Marking** | Required harness markings, e.g., a red "NOT FOR FLIGHT" tag on Dev units, or a serialized "FLIGHT" identification label. These are added to the BOM and labels automatically. |

- **Inheritance:** a pedigree can extend another (`Flight T1` extends `Flight T2`) and list only its differences. The editor shows the resolved result.
- **Monotonicity check:** the editor warns (does not block) when a higher-ranked pedigree is looser than a lower one on any rule or inspection ("T1 allows splices but T2 does not. Intended?").
- **Manufacturer precedence still applies** (§9.5.1): a pedigree can only tighten Manufacturer rules. If a pedigree requires an inspection we don't offer in-house, the quote goes to Needs review, or shows the outsourced cost and lead time if the backend supports that.

### 10.2 Switching and comparing
- **Pedigree switcher** in the top bar next to the revision: a colored pill (`◆ Flight T2 ▾`). Choosing another pedigree re-runs DFM, quote, BOM (markings/labels) and outputs instantly. Switching is undoable and recorded in the revision history.
- **Hover preview** on each item in the switcher menu shows the impact before switching: "Flight T1: +3 errors, +5 warnings · adds X-ray 10%, pull test 100% · +$42/unit · +4 days".
- **Compare pedigrees** view (from the switcher or command palette): a side-by-side table with one column per pedigree and rows for DFM errors/warnings, unit price at the selected quantity, ship date, required inspections, and documentation. This answers "what does it take to make this flight-worthy?" at a glance, and it is a strong pro-tool moment.
- The canvas shows the active pedigree as a thin colored band along the top edge of the canvas, and in the status bar. DFM badges on the canvas always reflect the active pedigree.
- The DFM card headline states the pedigree it checked against ("Checked against Flight T2"). Rule rows that change severity across pedigrees show that, e.g., "Error at T2 · warning at T3".

### 10.3 Inspection & test catalog
A catalog provided by the backend lists every inspection we can perform, with its parameters, whether it is done in-house or outsourced, and its cost/lead-time effect. Pedigrees select from it.

| Inspection / test | Parameters |
|---|---|
| Continuity | Always on, 100%. Max resistance. |
| Hipot / DWV | Voltage (AC/DC), dwell time, max leakage, test pairs (all-to-all, all-to-shell). |
| Insulation resistance | Test voltage, minimum resistance. |
| Crimp pull force | Sampling (100%, per-lot sample of *n*, first/last article), minimum force table by gauge (user-editable, defaults from the chosen standard). |
| Contact retention | Sampling, test force. |
| X-ray / CT | Sampling %, targets (contact seating, backshell, splices). |
| Crimp cross-section | Frequency (per setup, per lot). |
| Visual inspection | Magnification, acceptance class. |
| Dimensional | Segment length and breakout location tolerances. |
| Shield / bond resistance | Max resistance from shield to backshell/shell (mΩ). |

Inspections become operations in the operations model (§8.2), so they are priced in the quote and later drive inspection steps in the machine slicer.

### 10.4 Pedigree-aware rules
- Each rule instance carries an optional `severityByPedigree` map and `paramsByPedigree` map. Where no entry exists, the rule's base severity and params apply.
- The Rules manager (§9.5.4) gets a **matrix view**: rows are rules, columns are pedigrees, and each cell is a severity chip that cycles off → info → warning → error on click. Parameter overrides show as a small dot that opens the value editor. This makes a whole company standard reviewable on one screen.
- The rule detail pane's live preview shows results per pedigree ("flags 0 at Dev, 3 at T1").

### 10.5 Ordering at the right pedigree
- The quote uses the active pedigree by default. The quote card shows the pedigree name, and the price breakdown includes an "Inspection & test" line itemizing its requirements.
- The design has an **active pedigree**, which drives checks, drawing and report. An order can include lines at other pedigrees (e.g., 5 Dev units + 2 Flight T2 units). Each line is checked against its own pedigree before it can be ordered.
- **Requirements are locked to the pedigree.** In the order flow, inspections, tests, documentation and markings are pre-filled from the pedigree and cannot be removed; the user can add extra requirements. This is what guarantees a harness is never ordered under the wrong pedigree.
- The order review step states the pedigree prominently and asks for explicit confirmation when ordering below the project's highest previously ordered pedigree ("This revision was last ordered at Flight T2. You are ordering at Dev. Units will be tagged NOT FOR FLIGHT.").
- A team ruleset can set **allowed pedigrees** for a project (e.g., this program requires ≥ T2), enforced like other enforced rules (§9.5.5).

### 10.6 Definition, sharing and records
- A set of pedigrees is a **pedigree scheme**. Schemes are stored in the same `.harnessrules.json` file as a team ruleset (a `pedigrees[]` section), so rules and their per-pedigree severities travel together. A scheme can also be exported alone. It uses the same import preview, versioning, team library and enforcement as rulesets (§9.5.5).
- **Starter templates** are provided and fully editable: `Standard` (single pedigree, the default for new users), `Dev / Critical non-flight / Flight`, and `Dev / Critical non-flight / Flight T3 / T2 / T1`. For zero-tutorial use, a new project starts with `Standard` and the switcher offers "Define pedigrees…" at the bottom.
- Pedigrees are edited in a **Pedigree editor** (from the switcher, or the Rules manager): a list of pedigrees on the left, and tabs for Rules (matrix), Inspections, Parts policy, Process, Documentation and Marking on the right.
- Each frozen revision and each order records the pedigree scheme version and the resolved pedigree definition used.
- **Outputs:** the drawing title block has a Pedigree field, and the drawing notes list the pedigree's workmanship standard, required inspections and markings. The design report cover and executive summary show the pedigree, and report section 9 (Manufacturing & test) is generated from it. Output packages include the pedigree definition file.

---

## 11. BOM analysis (full view)

- **Auto-generated BOM** from the model: connectors, contacts, sealing plugs, backshells, accessories (dust caps, strain reliefs), wire (by spec/gauge/color, in length), braid, band clamps, tape/sleeving, labels, splices.
- Table columns: `Line | Part number | Description | Qty | UoM | Unit cost | Ext. cost | Stock | Lead time | Machine-ready | Alternates`.
- **Cost view:** stacked bar or treemap of cost by category; top 5 cost drivers highlighted.
- **Lead time view:** ranked list of parts by lead time, with the **critical-path part** called out ("D38999/24… is setting ship date: 6 weeks"). Show how ship date would change if it were replaced.
- **Alternates:** one-click swap to DB-listed alternates (e.g., different finish or equivalent series) with price/lead/compatibility delta shown before confirming. Swapping updates the design (with undo).
- **Customer-furnished parts** toggle per line (price excludes it; lead time depends on customer delivery date).
- Right-rail **BOM Snapshot** card shows total material cost, part count, and the top lead-time driver, with a link to this view.

---

## 12. Import

| Source | Phase | Notes |
|---|---|---|
| CSV / XLSX wire list | 1 | Column-mapping step with auto-detection (From/To connector, pin, signal, gauge, color, length). Remember mappings per user. |
| Paste from clipboard | 1 | Paste tabular text on canvas or in wire list → same mapping flow. |
| Native `.harness.json` | 1 | Full fidelity. |
| WireViz YAML | 1 | Popular open-source harness format; good for credibility with engineers. |
| Netlists (KiCad, Altium, OrCAD) | 2 | Extract connector-to-connector interconnect nets from a board or system-level schematic. |
| KBL (VDA 4964) / VEC | 3 | Automotive/industry standard XML; for users of Capital / E3.series. |
| Design rulesets `.harnessrules.json` | 1 | See §9.5.5. Preview/diff before applying. |

**Part resolution step (all imports):** imported connector PNs are matched to the component DB (exact → normalized → fuzzy). A review screen lists unmatched/ambiguous parts with suggested matches and lets the user pick or use the part picker. Unknown wire specs map to the default with a warning.

Imported connectors are auto-laid out left-to-right in a clean arrangement, with segments auto-created from connectivity (star topology from a central breakout when > 2 connectors), then the user adjusts.

---

## 13. Outputs: drawing, design report, output package & export

The **Outputs** view (top-bar view switcher: Design · BOM · Outputs) has three sub-tabs: **Drawing**, **Report**, and **Package**. All three are generated live from the model; none of them is a separate document to maintain.

### 13.1 Drawing
- The **Drawing** sub-tab renders a print-ready document from the model:
  1. Harness diagram (from canvas geometry, cleaned: grid off, badges off), with segment lengths and tolerances.
  2. Connector tables: per connector, pinout with signal, wire ID, gauge, color, contact PN.
  3. Wire list.
  4. BOM.
  5. Notes: default notes (workmanship standard from the active pedigree), required inspections, tests and markings from the pedigree, user notes, applied design rulesets with versions, and DFM/design-rule waivers.
  6. Title block: company, title, drawing number, revision, **pedigree**, date, drawn/checked/approved, sheet X of Y, units, tolerances.
- Sheet sizes: ANSI B/D, ISO A3/A1. Auto-pagination for tables.
- User can edit title block fields and notes in this view; nothing else (diagram changes happen in Design).

### 13.2 Design report
A human-readable PDF that explains the design to someone who didn't build it: a program manager, a reviewer at a design review, a customer's quality engineer, or the engineer themself six months later. The drawing says *what to build*; the report says *what this is, what it costs, when it arrives, and why it's right*.

**Principles**
- **Readable top-down.** Page 1 alone should answer "what is it, is it buildable, what does it cost, when can I have it." Each later section adds depth for readers who want it.
- **Every number has a unit and a source.** Examples: "as of 2026-09-27 19:40 PDT" for pricing/stock, "per MFG profile v3.2" for limits, "per ACME-EMC v1.4" for design rules.
- **Visual first.** Diagrams, connector face views and small charts carry the narrative; tables back them up.
- **Same visual language as the app** (§16), print-optimized (§16.8): light theme, CMYK-safe wire colors, wire color codes printed next to swatches for grayscale printing.

**Contents** **[DECISION]** (sections can be toggled off; see presets in §13.3)

| # | Section | Contents |
|---|---|---|
| 0 | **Cover** | Title, customer PN, revision, **pedigree** (with its color band), date, author, company; export-control marking in the header/footer of every page if the project is flagged (e.g., ITAR/EAR banner text); report ID and design hash. |
| 1 | **Executive summary** (1 page) | Harness overview image. Key metrics: connectors, wires, nets, total wire length, est. weight, max bundle OD. Manufacturability status and design-rules status (the same two headlines as §9.1). Quote snapshot for the selected qty/lead with validity date. Est. ship date and the critical-path part. Open issues count. |
| 2 | **Design overview** | Full harness diagram; topology table of segments (from/to node, length, wire count, bundle OD, coverings); breakouts and splices; design notes. |
| 3 | **Connectors** | One block per connector: PN, description, series/shell/insert/keying/finish; **insert face view** with cavities colored by net class plus legend; pinout table; backshell, accessories, sealing plugs; mating-connector PN reference. |
| 4 | **Engineering details** | Nets grouped by class. Wire spec/gauge summary. Twisted pairs and shields with termination method. Bundle OD per segment vs. backshell clamp range, and bend radius. **Weight breakdown** by category and segment. If net currents are given: **derating and voltage-drop table** per power net, computed from the wire spec's resistance per length and the routed length. Materials/finish compliance flags (RoHS/REACH, cadmium, restricted materials if data exists). |
| 5 | **Components & supply chain** | BOM summary with cost by category chart. **Lead-time analysis**: parts ranked by lead time, critical path called out, stock status, lifecycle status (obsolete/NRND flags), suggested alternates with their price/lead delta. Customer-furnished items. |
| 6 | **Quote** | Full price matrix at generation time, price breakdown (materials, machine time, manual ops, test, NRE), quote validity, and assumptions. Marked "Estimate. Final price on order confirmation" when the quote state is Needs review. |
| 7 | **Manufacturability (DFM) report** | Summary by category. Every violation with rule ID, severity, affected objects (with a small diagram callout where useful), message and rationale. Waivers with note, author and date. Operations summary: automated vs. manual operations, with the reasons for any manual steps. |
| 8 | **Design rules report** | Applied rulesets with versions and enforcement status. Results per rule, violations, overrides and waivers. |
| 9 | **Manufacturing & test** | Generated from the active pedigree (§10): workmanship standard; every required inspection and test with its parameters and sampling (continuity, hipot/IR voltages and limits, pull force table, X-ray rate, etc.); parts/process constraints; inspection and certification deliverables (CoC, FAI, traceability); required markings. Optional appendix: the pedigree comparison table (§10.2). |
| 10 | **Revision history** | Revision list with notes. From Phase 2: a change summary vs. the previous revision (connectivity, parts, cost and lead-time deltas). |
| A | **Appendices** | Full wire list; full BOM; list of all passed checks (compact); report metadata (tool version, MFG profile version, ruleset versions, component data timestamp, design hash). |

**Behavior**
- The **Report** sub-tab shows a live, paginated preview with a section outline on the left; clicking a section jumps to it. The user can edit only free-text fields (summary paragraph, design notes, review comments) and toggle sections.
- An **auto-generated summary paragraph** at the top of section 1 is filled from model facts (e.g., "Two-connector 38999 Series III harness, 37 wires across 24 nets, 1.2 m, overall braid, ready for automated build"). It is editable, and it is template-based rather than LLM-generated by default, so it is deterministic.
- Report generation never blocks on DFM errors. Errors are simply reported, and the cover shows a clear status stamp ("DFM: 2 errors — not ready for automated build").
- Pricing and stock in the report are frozen at generation time and labeled with the timestamp.

### 13.3 Output package
- **"Generate output package"** is the primary action in the Package sub-tab. It is also in the Export menu and the command palette.
- A dialog offers **presets** with checkboxes to adjust:
  - **Full release** (default): drawing, design report, BOM, wire list, pinouts, native design file, applied rulesets, DFM results, manifest.
  - **Design review**: design report + drawing (PDFs only).
  - **Fabrication**: drawing, BOM, wire list, native design file (no pricing).
  - **Customer handoff**: drawing, report with the quote section hidden, native file.
- Output is a **ZIP** with a predictable structure and names:
  ```
  <PN>_Rev<R>_<YYYYMMDD>/
    <PN>_Rev<R>_Drawing.pdf
    <PN>_Rev<R>_Design_Report.pdf
    <PN>_Rev<R>_BOM.xlsx            (+ .csv)
    <PN>_Rev<R>_WireList.csv
    <PN>_Rev<R>_Pinouts.csv
    <PN>_Rev<R>_DFM_Results.csv
    design/<PN>_Rev<R>.harness.json
    rules/<ruleset-id>_v<ver>.harnessrules.json   (includes the pedigree scheme)
    manifest.json                   (file list, SHA-256 per file, design hash, pedigree, tool + profile + ruleset versions, generated-at, generated-by)
  ```
- **Tied to revisions:** generating from a frozen revision is deterministic, meaning the same inputs give the same files, apart from the timestamped pricing/stock snapshot, which is stored. The package is saved with the revision and can be re-downloaded later. Generating from an unfrozen draft stamps every PDF page with **"DRAFT — not released"**.
- **Automatic generation:** a Full release package is generated when a revision is frozen and when an order is placed, and it is attached to the order record (§14.2).
- Individual files can still be exported on their own (§13.4).

### 13.4 Export formats
| Format | Phase |
|---|---|
| PDF drawing | 1 |
| Output package ZIP + manifest | 1 |
| CSV / XLSX: wire list, BOM, pinouts | 1 |
| Native `.harness.json` | 1 |
| SVG / PNG of canvas | 1 |
| DXF of drawing | 2 |
| WireViz YAML | 1 |
| KBL | 3 |
| Design rulesets `.harnessrules.json` (YAML in Phase 3) | 1 |
| DFM / design-rule results CSV (standalone) | 1 |
| Design report, all sections | 1 (pricing and supply sections show demo data, §18.2) |
| Revision change summary in report (section 10) | 2 |

### 13.5 Share (Phase 2)
- **Share link** (read-only viewer, optional expiry, optional password). Viewer shows canvas, wire list and drawing — ideal for "show someone who's never used the tool." Respect export-control flags (§14.3): ITAR-flagged designs cannot be shared publicly.

---

## 14. Ordering

> **Phase 1:** the Order button and the full order flow are built as a clickable mockup, so the design-to-order experience can be demonstrated. Nothing is submitted: the last step explains that ordering is coming soon and offers to download the output package (§18.2). Real ordering, payment and compliance handling arrive in Phase 2.

### 14.1 Order button **[DECISION]**
- Always visible, top-right, primary color: **"Order · $1,284"** reflecting the selected quote cell. Secondary text on hover: "10 units · Standard · ships Oct 9."
- States: `Order` (instant quote, 0 errors) / `Request quote` (needs review) / disabled with reason (e.g., empty design).
- A second, lower-emphasis nudge appears in the DFM card when readiness turns green: "Ready for automated build — order now."

### 14.2 Order flow
1. **Review:** thumbnail of the design, **pedigree** (stated prominently, with the lower-pedigree confirmation from §10.5 when it applies), quote cell (changeable), DFM summary, waived warnings, ship date. Additional order lines at other pedigrees can be added here, each with its own check status.
2. **Details:** quantity, lead tier, customer PN/revision, special requirements (free text), attach customer spec/ICD. **Inspections, tests, documentation and markings are pre-filled from the pedigree and locked**; the user can add extras (e.g., extra hipot, source inspection) but not remove pedigree requirements.
3. **Compliance:** export-control classification (EAR99 / ITAR / unknown), CUI acknowledgment; US-person attestation if ITAR.
4. **Payment:** card checkout or **submit PO / request invoice**, shipping address.
5. **Confirmation:** order number. The exact frozen revision is attached to the order (auto-freezes the revision), and its Full release output package (§13.3) is generated, attached to the order record and emailed as a download link.

### 14.3 Accounts & data handling
- **Phase 1: no accounts and no uploads.** Designs live only in the user's browser and in files they save. Phase 1 makes no export-control or ITAR compliance claims and should say so on the site; since nothing leaves the user's machine, no controlled data is received.
- **Phase 2:** accounts, cloud projects, order history and share links, hosted in US-only infrastructure suitable for export-controlled data; per-project export-control flag; encryption at rest; audit log of access for flagged projects. **[OPEN]** Target compliance level (NIST 800-171 / CMMC).
- **Phase 3:** organizations: team workspaces, roles and permissions, SSO.

---

## 15. Data layer: component catalog and reference data

### 15.1 Approach by phase **[DECISION]**
- **Phase 1: flat files, no database.** All reference data the tool needs (components, machine capability profile, inspection catalog, starter rulesets/pedigrees/finishing presets) lives as files in the website repository. Files are hand-editable (CSV for tables, JSON/YAML for nested config), version-controlled in git, and validated and compiled at build time. User designs stay in the browser (IndexedDB) and in `.harness.json` files the user saves and opens.
- **Phase 2: database.** Once the data needs are fully understood, move to Postgres with the same schemas, and add the live services that make the tool commercial: real quoting, live supply data, ordering, accounts, cloud projects and share links.
- **The UI never reads files directly.** All data access goes through a `CatalogProvider` interface (§15.5). Phase 1 implements it over the compiled static files; Phase 2 swaps in an API-backed implementation. No UI or rules-engine code changes at the migration.

**Phase 1 needs no server at all.** It is a static site: catalog files, the app, and in-browser generation of quotes (demo pricing, §18.2), PDFs and packages (§17). It can be hosted anywhere static, or run locally.

### 15.2 Directory structure (Phase 1)
```
data/
  catalog/
    connectors.csv          one row per connector PN
    connector_cavities.csv  one row per cavity: connector PN, cavity ID, contact size, x/y on face
    contacts.csv
    connector_contacts.csv  compatibility: connector series/size ↔ contact PN
    backshells.csv
    connector_backshells.csv compatibility
    accessories.csv         dust caps, jam nuts, gaskets, grounding rings, sealing plugs
    wires.csv               spec, gauge, OD, colors, weight/length, resistance/length, current rating
    cables.csv              multi-conductor cables (M27500 etc.)
    layers.csv              braid, tape, sleeving, heat shrink, jacket, conduit: type, size range, thickness, weight/length
    clamps.csv              band clamps: size range, tension spec
    boots.csv               boots and transitions: shape, size ranges
    labels.csv              label stock: type, size range, printable length
    splices.csv
    potting.csv             compounds and molds: cure time, volume
    hardware.csv            cushion clamps, ties, lacing
    alternates.csv          PN ↔ alternate PN, relationship
    supply.csv              PN, price breaks, stock, lead time, lifecycle, as-of date (public estimate only)
  profile/
    machine-profile.json    Manufacturer ruleset + capability limits (versioned)
    inspections.json        inspection catalog
  library/
    rulesets/*.harnessrules.json   starter rulesets and pedigree schemes
    presets/*.json                 finishing presets
  examples/*.harness.json          example designs for the empty state
```
- Relational split (separate compatibility and cavity files) keeps every file a simple flat table that opens cleanly in Excel, and maps 1:1 to database tables in Phase 2.
- IDs are part numbers, normalized (uppercase, no spaces) in a separate key column; the display PN keeps the manufacturer's formatting.
- Each file has a header comment row with schema version and units (all lengths in mm, masses in g, currents in A, prices in USD).

### 15.3 Required data
Adapt names to the actual source data. Minimum fields:
- **Connector:** PN, manufacturer, series, shell size, insert arrangement, gender, mount style, keying, finish, cavities (id, contact size, x/y on face), compatible contacts and backshells, grommet sealing range (wire OD min/max), termination allowance, machine-ready flag, jig/fixture ID (for the machine), lifecycle status.
- **Contact:** PN, size, gender, gauge range, crimp type, plating, crimp tool / positioner / insertion tool, machine-insertable flag.
- **Wire:** spec, gauge, OD, available colors/stripes, weight per length, resistance per length, current rating, temperature rating.
- **Cable:** PN structure (spec, conductor count and gauge, shield, jacket), OD, conductor colors, weight per length.
- **Backshell:** PN, compatible series/shell sizes, angle, style, cable clamp min/max diameter, band-clamp platform (yes/no), shield termination type.
- **Layers:** type, material, size range (min/max diameter it fits, or recovered/expanded sizes for heat shrink and sleeving), wall/wrap thickness, braid coverage options, weight per length.
- **Band clamps, boots, labels, splices, potting, hardware:** size ranges and the parameters listed in §6.
- **Supply (all parts):** price breaks, stock, lead time, lifecycle, as-of date.

### 15.4 Build-time validation and compilation
- A script (`pnpm data:build`) runs before every build and in CI:
  1. Parses each CSV with a Zod schema per file. Wrong types, units or missing required fields fail with file, row and column.
  2. Checks references: every compatibility row points to existing parts, every connector has cavities, every alternate exists, no duplicate PNs.
  3. Compiles to **JSON bundles** split by family (e.g., `catalog/38999-III.json`) so the browser loads only what it needs, plus a small **search index** (MiniSearch or FlexSearch) for the part picker.
  4. Writes a catalog version (content hash + date) that designs record, so reports can say which catalog data they used.
- A validation failure blocks the deploy, which prevents a bad CSV edit from breaking the live tool.
- Data size is not a concern at this stage: even tens of thousands of rows compile to a few MB, lazy-loaded by family.

### 15.5 Access interface
```ts
interface CatalogProvider {
  searchParts(query: string, facets: FacetFilter): Promise<SearchResult>
  getParts(pns: string[]): Promise<Part[]>
  compatible(pn: string, relation: 'contacts' | 'backshells' | 'accessories'): Promise<Part[]>
  alternates(pn: string): Promise<Part[]>
  supply(pns: string[]): Promise<SupplyInfo[]>
  machineProfile(): Promise<MachineProfile>
  inspectionCatalog(): Promise<InspectionType[]>
  library(): Promise<LibraryIndex>          // starter rulesets, pedigrees, presets
  catalogVersion(): string
}
```
- Phase 1: `StaticCatalogProvider` fetches the compiled bundles and caches them in the browser.
- Phase 2: `ApiCatalogProvider` calls the tRPC endpoints listed in §15.7.
- The DFM engine, quote summary and all UI use only this interface.

### 15.6 Pricing and supply data
- Anything in a static site's directory can be downloaded by anyone. In Phase 1 that is fine, because pricing and supply are **demo data** (§18.2): `data/demo/pricing.json` holds placeholder rates and `supply.csv` holds plausible stock and lead times. **Never put real margins, machine rates or supplier costs in these files.**
- In Phase 2, the real pricing model and cost data live only on the server behind `quote.compute` (§8.2); the client sends the design summary and receives the price matrix. Because Phase 1 already calls the quote through the same provider interface, only the provider changes.

### 15.7 Phase 2 database and API
- Same schemas as the Phase 1 files, moved into Postgres. The CSVs can then be retired, or kept as the import format for bulk catalog updates.
- API (tRPC):
  - `parts.search(query, facets)` → paginated results with facet counts
  - `parts.get(ids[])`, `parts.compatible(pn, relation)`, `parts.alternates(pn)`, `parts.supply(pns[])`
  - `capability.profile()` → machine capability profile (versioned)
  - `quote.compute(summary)` → price matrix + breakdown + ship dates
  - `dfm.validate(harness, rulesetRefs)` → authoritative server check against Manufacturer + applied rulesets
  - `rulesets.list / get / create / update / publishVersion / import / export` → team and personal ruleset library (incl. pedigree schemes and finishing presets)
  - `rules.types()` → catalog of built-in rule types with parameter schemas (drives the rule builder UI)
  - `inspections.catalog()` → available inspections/tests with parameter schemas, in-house vs. outsourced, cost/lead-time effect
  - `projects.*` → CRUD, revisions, share links
  - `orders.create(...)`
- Live supplier feeds for stock and lead time replace the snapshot file.

---

## 16. Visual design system **[DECISION]**

### 16.1 Goals
The tool should look **professional, modern, calm and precise**: closer to Linear, Figma or a modern IDE than to legacy CAD. Four rules drive every visual decision:

1. **The harness is the only colorful thing on screen.** UI chrome is neutral grey. Saturated color is reserved for wires, status (error/warning/pass) and one accent for interaction. This makes the design itself stand out and keeps long sessions easy on the eyes.
2. **Wire colors are always shown as their real colors.** A red wire next to a green wire is drawn red and green. The UI never recolors a wire to show state (selection, errors, hover). State is shown with outlines, badges and dimming of *other* objects instead.
3. **Color is never the only signal.** Every status has an icon shape and text, and every wire color can be shown as a text code. The tool works fully for users with color vision deficiency (CVD), who are roughly 1 in 12 men, including many technicians and inspectors.
4. **Dark by default, light as an option.** Dark mode is the default for new users; Light and System are available.

### 16.2 Themes
- **Settings:** Dark (default) / Light / System. Toggle in the user menu and the command palette ("Toggle theme"). Share-link viewers default to dark and have their own toggle.
- **Dark mode is built for long sessions:** no pure black (glare and smearing on OLED) and no pure white text (halation). Surfaces get *lighter* as they elevate, instead of relying on shadows. Large saturated fills are avoided; the Order button is the only large accent-colored element.
- **Light mode** is a true peer, not an afterthought, and is also the basis for print (§16.8).
- The canvas is slightly darker than the surrounding panels in dark mode (slightly lighter in light mode), so attention goes to the harness.

### 16.3 Color tokens
All colors are **design tokens** (CSS custom properties), defined in three tiers: primitives → semantic tokens (below) → component tokens. Components use semantic tokens only; hard-coded hex values are not allowed outside the token file. The values below are starting points that have been checked for contrast and CVD separation (§16.5). Adjust freely, but CI re-runs those checks.

**Neutrals and accent**

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `bg.canvas` | `#0E1014` | `#FAFAFB` | Canvas background |
| `bg.app` | `#121418` | `#F4F5F7` | App frame, top bar |
| `bg.surface-1` | `#171A1F` | `#FFFFFF` | Right rail, drawers |
| `bg.surface-2` | `#1E2228` | `#FFFFFF` + border/shadow | Cards, popovers, pin cards |
| `bg.hover` | `#262B32` | `#EEF0F3` | Hover/pressed rows |
| `border.subtle` | `#2A2F37` | `#E1E4E8` | Dividers (decorative only) |
| `border.control` | `#66707E` | `#8A919C` | Input and control outlines (≥ 3:1) |
| `canvas.grid` | `#232830` | `#DCE0E5` | Dot grid |
| `text.primary` | `#E6E8EB` | `#16181D` | Body text, values |
| `text.secondary` | `#A6ADB8` | `#4A515C` | Labels, secondary info |
| `text.tertiary` | `#8A93A0` | `#646C79` | Hints, placeholders (still ≥ 4.5:1) |
| `accent` | `#3CC7DB` | `#0B7F92` | Selection, focus, links, primary buttons |
| `accent.on` | `#062429` | `#FFFFFF` | Text on accent fills |

The accent is **cyan** on purpose: MIL-STD-681 has no cyan wire color, so a selection halo can never be confused with a wire.

**Status**

| Status | Dark | Light | Icon (always shown) |
|---|---|---|---|
| Error | `#FF5C7A` (crimson) | `#C4234F` | ⨯ in an octagon |
| Warning | `#F5B83D` (amber) | `#8F5B00` | ! in a triangle |
| Pass | `#7BCB5A` (green) | `#3F7F1F` | ✓ in a circle |
| Info | `text.secondary` | `text.secondary` | i in a circle |

- Error is a *crimson* (red shifted toward magenta) rather than an orange-red. This keeps it clearly different from amber for red-green CVD users. With a pure red, error and warning collapsed to nearly the same color under deuteranopia in testing.
- Info is deliberately neutral grey rather than a blue, so it doesn't compete with the accent or with blue wires.

**Pedigree colors** (§10): chosen from a curated set of 8 hues pre-checked for CVD separation. They are always displayed with the pedigree's text code (`T1`, `DEV`), never as color alone.

**Charts** (BOM cost, lead time): categorical palette based on Okabe–Ito (a palette designed for CVD), at most 6 categories plus "Other", with direct labels on the chart instead of a color-only legend.

### 16.4 Wire color rendering
Wires use the **MIL-STD-681** color codes. Each color has a per-theme value tuned to look like the real insulation on that background.

| Code | Color | Dark theme | Light theme | Casing needed |
|---|---|---|---|---|
| 0 | Black | `#1C1D20` | `#1C1D20` | Dark theme |
| 1 | Brown | `#8C5A2E` | `#7A4A1F` | — |
| 2 | Red | `#E8352F` | `#D02A24` | — |
| 3 | Orange | `#F58A24` | `#E27712` | Light theme |
| 4 | Yellow | `#F5D311` | `#E6C200` | Light theme |
| 5 | Green | `#2EAD52` | `#228C3E` | — |
| 6 | Blue | `#3B7BF0` | `#1F5CCB` | — |
| 7 | Violet | `#9457DB` | `#7A3CC2` | — |
| 8 | Gray | `#9AA0A8` | `#8A9098` | — |
| 9 | White | `#F4F4F2` | `#FFFFFF` | Light theme |

- **Casing rule:** any wire whose fill is below 3:1 contrast against the canvas gets a thin contrasting casing (like roads on a map): `#C9CED6` in dark mode and `#3A414B` in light mode. The rule is computed, not hard-coded, so it also covers custom colors.
- **Striped wires** (e.g., white with blue and red stripes) are drawn as the base color with repeating stripe bands along the wire. On pin cards and in tables, the swatch is split to show base and stripes.
- **Bundles** are neutral grey, so colored wires inside them stay readable. Overall braid is shown as a subtle cross-hatch in a lighter neutral.
- **State never changes wire color:**
  - *Selected*: accent-colored halo around the wire plus a slightly thicker stroke.
  - *Hover*: thin accent outline.
  - *Error/warning*: status badge pinned to the wire, plus a dashed status-colored halo.
  - *Focus mode* (e.g., highlighting a net): everything else is dimmed to ~25% opacity; the highlighted wires keep their true color.

### 16.5 Color vision deficiency support
- **Redundant encoding everywhere:** statuses use shape + icon + text; pedigrees use color + code; charts use direct labels; the Order button and primary actions use text, not color alone.
- **Wire color codes as text:**
  - Pin card swatches always show the code next to the swatch (`2 RED`, `9-6-2 WHT/BLU/RED`).
  - Hover tooltips on any wire show the full color name and code.
  - At Detail zoom, small color-code labels appear along each wire near both ends.
  - Setting **"Wire color labels"**: Detail zoom only (default) / Always / Hover only. Turning on **Colorblind assist** in Settings sets this to Always.
- **Color vision preview:** View menu → "Simulate color vision" (protanopia, deuteranopia, tritanopia, achromatopsia) applies a filter over the canvas. This lets engineers check how a harness will look to technicians and inspectors.
- **Optional design rule** (§9.5.2): flag wires on the same connector or in the same bundle whose colors are easily confused under CVD (e.g., red/green, brown/green) and that have no other distinguishing feature such as stripes or labels. Off by default; teams can enable it.
- **Validation:** the token set was checked with the Machado (2009) CVD simulation at full severity. The minimum color difference (CIELAB ΔE) between error and warning is 27 or more in both themes for protan, deutan and tritan simulation. Red and green wires drop to about ΔE 20 under deuteranopia, which is why wire color labels exist.

### 16.6 Typography
- **UI font: Inter**, with tabular figures (`font-feature-settings: "tnum"`) wherever numbers align (prices, lengths, tables) and the alternates that make capital I, lowercase l and 1 distinct.
- **Data font: JetBrains Mono**, used for part numbers, pin IDs, net names, wire IDs, rule IDs, and numbers with units. It has a dotted zero and clearly different 0/O, 1/l/I, 5/S and 8/B, which matters when reading `D38999/26WB35SN` or pin `A1` vs `AI`.
- **Scale:** 11 / 12 / 13 / 14 / 16 / 20 / 24 px. Base UI text is 13 px; tables and pin cards 12–13 px; section headings 16 px; the price in the Order button and quote card uses 20–24 px.
- **Weights:** 400, 500 and 600 only. No light weights (they look thin and grey on dark backgrounds).
- Small uppercase labels (11 px, letter-spacing +0.04em) for card titles such as INSTANT QUOTE.
- **Units:** always shown, with a thin space before the unit (`300 mm`, `20 AWG`, `212 g`, `$1,284`). Consistent unit abbreviations throughout.
- Fonts are self-hosted (no third-party font CDN), which also suits the export-control requirements (§14.3).

### 16.7 Shape, density, motion and icons
- **Spacing:** 4 px grid. **Corner radius:** 6 px for controls, 8 px for cards and popovers, 4 px for chips. 1 px borders.
- **Density:** compact but not cramped. Row height 28 px in tables and pin cards, 32 px for controls.
- **Icons:** Lucide, 1.5 px stroke, 16 px in dense UI and 20 px in toolbars. One icon family only.
- **Focus:** visible 2 px accent focus ring on every interactive element, for keyboard users.
- **Motion:** 120–180 ms ease-out for popovers and panels; price changes briefly animate their digits. Respect `prefers-reduced-motion`. No decorative animation.
- **Pro cues:** rule IDs, units, revision and pedigree labels, keyboard shortcuts in tooltips, status bar metrics, check counts. No consumer-style illustrations, emoji or playful copy.

### 16.8 Print and export
- Drawings and reports always use the **light theme** and a **print wire palette** (slightly darker, CMYK-safe versions of the light values) regardless of the on-screen theme.
- Wire color codes are printed next to every swatch, so documents work in grayscale and for CVD readers.
- PDFs embed the same Inter and JetBrains Mono fonts.

### 16.9 Implementation
- Tokens live in `packages/ui-tokens` as a single source (JSON), compiled to CSS variables, a Tailwind theme, and a TypeScript map for SVG rendering. The same tokens feed `packages/docs` (print).
- Theme switching changes a `data-theme` attribute on the root element; no reload.
- **CI checks** on the token file:
  - WCAG 2.2 contrast: body text ≥ 4.5:1 (primary text targets 7:1), UI controls and graphics ≥ 3:1.
  - CVD separation: status colors and pedigree colors keep a minimum ΔE under simulated protan/deutan/tritan vision.
  - Wire casing rule is applied wherever needed.

  A failing check blocks the merge, so later palette tweaks can't quietly break accessibility.
- Accessibility baseline: WCAG 2.2 AA, full keyboard operation of pin cards, wire list and menus, and screen-reader labels on canvas objects (e.g., "Wire W12, net CAN_H, 22 AWG, white with blue stripe, P1 pin 4 to J2 pin 7").

---

## 17. Technical architecture **[DECISION]**

- **Monorepo** (pnpm workspaces + Turborepo):
  - `apps/web` — React 18 + TypeScript + Vite. Tailwind + Radix primitives for popovers/menus. TanStack Table (virtualized) for wire list/BOM.
  - `packages/ui-tokens` — color, type and spacing tokens with contrast/CVD checks in CI (§16.9).
  - `packages/model` — TypeScript types + Zod schemas for the harness; command objects for all mutations (enables undo/redo, autosave diffs, and future collaboration); derived selectors (wire lengths, BOM, operations list).
  - `packages/dfm` — rules engine, built-in rule types, ruleset and pedigree schemas (Zod), layering/precedence and pedigree resolution (inheritance, per-pedigree severities/params), CEL evaluator wrapper (e.g., `@marcbachmann/cel-js` or equivalent; evaluate options at build time). Runs in a browser Web Worker and on the server.
  - `packages/ops` — derives manufacturing operations from a harness (shared by quote engine and, later, the machine slicer).
  - `packages/io` — importers/exporters (CSV/XLSX, WireViz, JSON), output package assembly and manifest.
  - `packages/docs` — the drawing and design report, built with **`@react-pdf/renderer`**. It produces real PDF files **in the browser** (in a Web Worker) in Phase 1, so the output package ZIP (built with JSZip) can include them without a server. The same code runs in Node for server-side generation in Phase 2. It supports running headers/footers (export-control banners), page numbers and table pagination. The harness diagram and charts are drawn as vector SVG from the same geometry the canvas uses. The Outputs tab previews these exact PDFs, so preview and download always match. **[DECISION, spike first]:** confirm early that react-pdf handles the drawing sheet layout; if not, fall back to Paged.js with the browser's print-to-PDF for Phase 1 and server-side Chromium in Phase 2.
  - `packages/providers` — interfaces for everything that becomes a live service later (`CatalogProvider`, `SupplyProvider`, `QuoteProvider`, `OrderProvider`, `ProjectStore`), with Phase 1 static/demo implementations (§18.2).
  - `data/` + `scripts/data-build` — flat-file catalog and demo data, with the validation/compile step (§15.2, §15.4).
  - `services/api` — **Phase 2:** Node + tRPC; Postgres for catalog, projects, orders and accounts; real quote engine; ordering and payment; server-side authoritative DFM. Implements the same provider interfaces (§15.5).
- **State:** Zustand store holding the harness; all changes go through `applyCommand()`; Immer for immutable updates; undo stack of inverse commands.
- **Workers:** DFM and wire-length/BOM derivation in a Web Worker so the canvas never stutters. The worker also evaluates the other pedigrees at low priority, so the switcher hover preview and Compare pedigrees view (§10.2) are instant. `quote.compute` accepts a list of pedigrees and returns one price matrix per pedigree.
- **Testing:** unit tests for model commands, every DFM rule (fixtures of passing/failing harnesses), importers; Playwright E2E for the core flow ("add 2 connectors → connect 3 pins → see quote → order").
- **Telemetry** (privacy-friendly and anonymous in Phase 1, with no design data sent): instrument time-to-first-wire, time-to-first-quote, import success rate, and funnel from design → order. These measure the "no tutorial" goal.

---

## 18. Phased roadmap

### 18.1 Phases
| Phase | Goal | Used by | Backend |
|---|---|---|---|
| **1. Design tool (functional mockup)** | A complete tool for designing a harness end to end, with drawings, reports and packages. Commercial features (pricing, supply, ordering) are present and behave realistically, but run on demo data. | Brian, internal design work, demos to prospects and design partners | None: static site, flat-file data (§15) |
| **2. Commercial launch** | Customers design and order through the tool. | Customers | Database, API, ordering, compliant hosting |
| **3. Organizations** | Support engineering teams at customer companies. | Customer teams | Adds workspaces, roles, shared libraries |

### 18.2 Phase 1: what is real and what is mocked
Everything needed to **design** a harness is real. Everything needed to **sell** a harness is mocked, but built to the final UI so demos look and feel like the finished product.

| Area | Phase 1 | Becomes real in |
|---|---|---|
| Canvas, connectors, pinouts, wires, cables, twisted pairs (§5, §6) | Real | — |
| Branching: breakouts, N connectors, splices, routing | Real | — |
| All finishing: backshells, shields, overbraid, band clamps, layers, boots, labels, potting, hardware (§6) | Real (coax/fiber contacts in Phase 2) | — |
| Wire list, BOM structure, bundle diameter, weight, lengths | Real | — |
| DFM engine and Manufacturer profile (from file) | Real | Server-side authoritative check in 2 |
| Design rules: Rules manager, project rules, rule builder, ruleset import/export as files, waivers | Real | CEL advanced mode in 2; team library in 3 |
| Pedigrees: definitions, switching, compare, per-pedigree severities, inspection requirements | Real | Shared schemes and enforcement in 3 |
| Revisions (local freeze), save/open, autosave | Real (in browser and files) | Cloud projects in 2 |
| Import / export, drawing, design report, output package | Real | — |
| **Instant quote** | **Demo:** computed in the browser from the real operations list × demo rates, so prices move sensibly with every design change. Full UI: matrix, deltas, states (including "Needs review"), breakdown, simulated 300–800 ms latency. | 2 |
| **Stock, lead time, lifecycle, ship date** | **Demo:** from `supply.csv` with plausible values; critical-path and alternates analysis works on this data. | 2 |
| **Ordering** | **Clickable mockup** of the whole flow (§14.2), including locked pedigree requirements and compliance/payment steps with inactive fields. The last step says ordering is coming soon and offers to download the output package and contact us. **Nothing is submitted.** | 2 |
| **Share links, accounts** | Buttons shown disabled with a "Coming soon" tooltip. | 2 |
| **Team libraries, roles, enforcement** | Not shown. | 3 |

**Demo labeling:** whenever a price, stock level or ship date is shown in Phase 1 (quote card, BOM, Order button, report), a small **"Demo data"** tag appears next to it, and PDFs carry "Demo pricing — not a quotation" in the footer of pages with prices. It is subtle but always present, so no prospect mistakes a demo number for a quote.

**Implementation:** each mocked area sits behind the provider interfaces in `packages/providers` (§17): `DemoQuoteProvider`, `DemoSupplyProvider`, `DemoOrderProvider`, `LocalProjectStore`. Phase 2 replaces them with API-backed providers; UI code does not change. The demo providers must not contain real margins or supplier costs (§15.6).

### 18.3 Phase 1 build order (suggested milestones for Claude Code)
1. **Core model and canvas:** data model and commands (§4), connector picker from the flat-file catalog, pin cards, drag-to-connect, 2-connector harness with one segment, wire list, save/open/autosave, undo/redo, themes and tokens (§16).
2. **Topology:** breakouts, N connectors, routing, segment lengths, bundle diameter.
3. **Finishing:** everything in §6, with auto-completion and finishing presets.
4. **Checks:** DFM engine and Manufacturer profile, then design rules and the Rules manager, then pedigrees.
5. **Commercial mockups:** demo quote, BOM analysis with demo supply, order flow mockup.
6. **Outputs:** drawing, design report, output package.
7. **Import/export and polish:** CSV/XLSX/WireViz import with part resolution, exports, zero-tutorial affordances, accessibility pass.

### 18.4 Phase 2: commercial launch
- Postgres database and API (§15.7); catalog moves from files to the database
- Real quote engine with private pricing; live supply data
- Ordering, payment (hosted checkout or PO), order records and confirmations
- Server-side authoritative DFM at order time
- Accounts, cloud projects, order history, share links
- Hosting and data handling suitable for export-controlled designs (§14.3)
- CEL advanced rules, revision diff and change summary, netlist import, DXF export, coax/twinax/fiber contacts
- Hand-off of the operations list to the machine slicer

### 18.5 Phase 3: organizations
- Team workspaces, roles and permissions, SSO
- **Team libraries:** versioned rulesets, pedigree schemes and finishing presets with publishing, update prompts, enforcement flag and allowed pedigrees per project
- Named-approver waivers, comments and review workflow
- YAML ruleset export for teams that keep rules in git
- Saved templates/blocks (e.g., a standard power pigtail)
- Customer co-branding on drawings and reports
- KBL/VEC import/export; public API for customers' own tooling

---

## 19. Acceptance criteria (Phase 1)

1. A new user, with no instructions, can create a 2-connector 38999 jumper with 10 named signals, overbraid and labels, and reach the order review step in **under 5 minutes** (validate with 5 hallway tests).
2. **Full design capability:** three real harnesses Brian has built or specified before (including at least one with 4+ connectors, breakouts, individual shields, overbraid with band clamps, and labels) can be designed completely in the tool, pass DFM, and produce a drawing that matches the original intent.
3. Every design action in §5.4 can be performed on the canvas without opening a side panel.
4. Demo quote updates within **1.5 s** of the last edit (including simulated latency); DFM within **200 ms**.
5. Canvas holds 60 fps at 20 connectors / 1,000 wires; no dropped frames during drag-to-connect.
6. A printed PDF drawing is understandable by an engineer who has never seen the tool (review with 2 people).
7. Importing a 100-row CSV wire list with standard headers requires no manual column mapping.
8. Undo/redo works for every mutation.
9. A generated design report lets a reviewer who has never seen the tool state the harness's purpose, status, cost and ship date from **page 1 alone** (validate with 2 people). Every price/stock figure carries an as-of timestamp and the demo label.
10. The output package for a frozen revision regenerates byte-identical CSV/JSON files, and its manifest hashes verify.
11. Switching pedigree updates DFM within **200 ms** and the demo quote within **1.5 s**; the switcher's hover preview is shown without a visible delay.
12. In the order mockup, pedigree requirements cannot be removed, and no step sends design data off the user's machine (verified by an E2E test that fails on any outbound request carrying design data).
13. Every screen passes WCAG 2.2 AA in both themes, and every status, pedigree and wire color can be identified without color (checked with the color vision simulation in §16.5 and with at least one CVD tester).

---

## 20. Open questions [OPEN]

1. **Component data**: what format is the existing component data in today, and can it be exported to the Phase 1 CSV layout (§15.2)? Does it already hold cavity face coordinates, grommet sealing ranges and machine-ready flags?
2. **Pricing model**: which inputs drive price (ops count, wire length, machine minutes)? Are lead tiers fixed day counts?
3. **Scope of connector families** at launch — 38999 Series III only, or also Series I/II, Micro-D, circular commercial (M12, etc.)?
4. **Units default**: inches or mm for US aerospace customers? (Suggest: inches default, per-project toggle.)
5. **Export control (Phase 2)**: will ITAR-controlled designs be accepted at commercial launch? This drives hosting, share-link policy and the compliance level.
6. **Workmanship standard** to reference by default on drawings (IPC/WHMA-A-620 Class 3, NASA-STD-8739.4, customer spec).
7. **Testing** included in base price: continuity only, or continuity + hipot + insulation resistance?
8. **Brand/product name** for the tool.
9. **Manufacturer rule transparency:** is it OK to show every machine limit (envelope, max length, supported parts) to users? The spec assumes yes, since it builds trust, but some limits may be competitively sensitive.
10. **Report branding:** our branding only, or allow the customer's logo and company name on the report and drawing title block (useful when they pass it up their own chain)? The spec assumes our branding in Phase 1 and customer co-branding later.
11. **Demo pricing realism:** should the Phase 1 demo rates be rough estimates of real pricing (more convincing in demos, but numbers may be remembered), or clearly arbitrary?
12. **Inspection capability:** which inspections will be in-house at launch (continuity and hipot through the machine jigs are planned; what about pull test, X-ray, cross-section)? Outsourced ones need cost and lead-time data for the quote.
13. **Starter pedigree templates:** should the default `Dev / Critical non-flight / Flight T3–T1` template carry pre-filled inspection sets, or start empty so customers fill in their own company definitions? The spec assumes light defaults, clearly labeled as editable examples.
14. **Phase 1 audience:** internal only, or a public demo on the website? A public demo may want an interest/waitlist form at the end of the order mockup, which needs a third-party form service (the only outside request Phase 1 would make, and it would carry contact details only, never design data).
15. **Phase 2 hosting:** which provider for the commercial launch? Accepting export-controlled designs points to a US-only/GovCloud-type setup (see question 5).
