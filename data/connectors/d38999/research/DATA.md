# Dimension database and source review

The generator reads UTF-8 CSV files with headers through `d38999/database.py`.
Source values, assumptions, and unreviewed extraction have separate locations.
Values marked `verified` reflect the source review recorded in the original
session; they have not been validated against a manufacturer's CAD model.

## Production tables

| File in `data/` | Purpose |
| --- | --- |
| `connector_styles.csv` | Slash-sheet identity, series, mounting style, shell coverage, PIN schema, CAD status. |
| `classes.csv` | Class code, material, finish, environmental/hermetic classification, source notes. |
| `shell_sizes.csv` | A-H/J shell code to numeric shell size. |
| `contact_styles.csv` | Contact code to gender and type. Contacts themselves are not generated. |
| `polarization.csv` | Minor-key angles by shell-size group and polarization. |
| `series_iii_interface.csv` | Shell mating-interface diameters from MIL-DTL-38999N Figure 3. |
| `coupling_threads.csv` | Internal/external diameter limits, pitch, lead, three starts. |
| `metric_threads.csv` | External metric thread diameter limits for mounting and rear accessory threads. |
| `accessory_interface.csv` | Rear interface dimensions by shell size from Figure 10. |
| `slash24.csv` | Jam-nut receptacle envelope, mounting features, O-ring reference sizes. |
| `slash25.csv` | Hermetic solder-mount receptacle dimensions; reserved for a future builder. |
| `slash26.csv` | Straight-plug and coupling-nut envelopes, including composite reference values. |
| `jam_nuts.csv` | /28 mounting nut envelope and thread designation; bore currently simplified. |
| `common_dimensions.csv` | Shared axial locations, key widths, cavity profiles, and other source dimensions. |
| `contact_cavities.csv` | Source dimensions for front insert cavity/barrier features. |
| `insert_arrangements.csv` | Reviewed arrangement manifest, count, sizes, series applicability. |
| `insert_coordinates.csv` | Individual contact-center coordinates and review status. |
| `tolerances.csv` | Preserved tolerances for nominal dimensions; not a tolerance-analysis engine. |
| `model_choices.csv` | Explicit construction assumptions, numerical clearances, preview settings. |
| `geometry_gaps.csv` | Missing, unimplemented, or ambiguous geometry and next actions. |

CSV unit fields are authoritative. Most shell dimensions are millimeters;
coupling thread and insert-coordinate tables include inches. Conversion uses the
exact factor 25.4 mm/in. `_min`/`_max` pairs generally use their midpoint in the
comparison model. `_nom` uses the stated nominal; envelope-only maxima use the
maximum. `common_dimensions.csv` selects nominal first, then a two-limit
midpoint, then the sole provided limit. No tolerance stack-up is performed.
See the Python builder when tracing which extracted dimensions are actually used;
extraction of a value does not imply the corresponding feature is implemented.

The thread builder places straight flanks using the selected pitch diameter and
flank angle. Lead must equal pitch times start count. The angular thread phase and
Boolean overlap are explicit choices. Threads have no root fillets or controlled
runouts. A threaded option does not yet add the mounting nut's internal thread.

## Sources and review boundary

`research/source_inventory.csv` identifies each local PDF and its SHA-256 hash.
The main sources are the supplied MIL-DTL-38999N and MIL-STD-1560C Change 3,
plus the dimensional slash sheets in `research/specs/`. The /24 and /25 titles
and size tables were rechecked in the preceding session after the correct PDFs
were supplied. Their data are distinct; slash numbers are never used as shell
sizes.

`research/extracted_tables_unreviewed.csv`,
`research/insert_coordinates_unreviewed.csv`, and `research/insert_index.csv`
are machine-extracted candidates. They may contain missing signs, duplicates,
incomplete contact-size assignments, or tables that require visual interpretation.
They are not fallback data for generation. Page references in production tables
distinguish PDF and printed pages where necessary; otherwise consult the named
figure as well as the page.

## Add a reviewed arrangement

1. Locate its figure in MIL-STD-1560C. Verify applicable series, shell size,
   contact count, contact sizes, coordinate signs/units, and viewing direction
   against the drawing, including any continuation pages.
2. Add one manifest row to `insert_arrangements.csv` and one row per contact to
   `insert_coordinates.csv`, with source/page references and `status=verified`.
   Coordinates follow the pin mating-face view; the builder mirrors the socket.
3. Keep contact IDs unique and the coordinate count equal to the manifest count.
   The current insert builder accepts only uniform 22D arrangements; mixed sizes
   require code and cavity/grommet data changes before use.
4. Generate both genders, review their face views and envelopes, and verify the
   STEP round-trip. Compare to manufacturer CAD where available.

Use a copied data directory with `--data` for experimental changes. Each model's
JSON records hashes for all CSVs, but hashes alone cannot reconstruct overwritten
data, so preserve the corresponding data directory for reproducibility.
