# Contract: Resolve CSV Projection (`<filename>.csv`)

**Status**: ✅ **CONFIRMED** against DaVinci Resolve on real footage (2026-07-17). Headers, separator, and matching are verified — see research.md §S1-b. One open item: non-ASCII text (F7).
**Path**: `<same folder as video>/<full video filename>.csv` — e.g. `A001_C001.mp4.csv`

Carries whole-video metadata (comments, keywords) into Resolve's Metadata panel. **Cannot carry markers** — that's the known, accepted loss (FR-031); markers go via OTIO.

## Shape (CONFIRMED)

```csv
File Name,Comments,Keywords
A001_C001.mp4,"Good take. Use the wide at the top.","interview, wide, day-2"
```

One data row. Resolve matches to a Media Pool clip by **file name**, which lines up with the filename-identity clarification (FR-021a).

**Verified in Resolve**: headers exactly as above; comments import verbatim; the comma-space separator yields **separate keyword chips**, not one string; matching works with the extension included ("Ignore file extensions when matching" left unchecked).

**Verified NOT to work**: a UTF-8 BOM. Its bytes attach to the first header (`<BOM>File Name`), the match column is not recognised, and the import fails with *"No matching media pool entries were found"* — a message that misleadingly implicates the media pool rather than the encoding. **Never write a BOM** (F7).

## Mapping from canonical

| Canonical | CSV column |
|---|---|
| `identity.filename` | `File Name` — the match key |
| `authored.comments` | `Comments` |
| `authored.keywords` | `Keywords` — joined, sorted |
| `markers[]` | **not carried** (FR-031) |

## Writer contract

- Pure function of canonical. Deterministic: fixed column order, keywords sorted (SC-010).
- Written **before** the canonical `.json` (D9).
- RFC 4180 quoting: quote fields containing commas, quotes, or newlines; escape `"` as `""`. Comments are free text and *will* contain commas and quotes.
- **UTF-8, no BOM** (confirmed — a BOM breaks matching, F7).
- Line ending `\r\n` per RFC 4180 — works.

## D13a: emit `Start TC` / `End TC` (TODO)

Resolve's Metadata Import dialog ships with **"Match using clip start and end Timecode" ticked by default**. Our three-column CSV has no timecode columns, so the import matches nothing and reports *"No matching media pool entries were found"* — which reads as a broken file rather than a checkbox. The user had to untick it manually.

**Decision**: when `source_timecode_frames` is present, also emit `Start TC` and `End TC` (derived from the start timecode and `duration_frames`), so the import succeeds under Resolve's **default** options. Verified achievable: our computed start TC and frame count match Resolve's own `Start TC` / `End TC` / `End Frame` exactly (F4).

Where timecode is absent (null), the columns are omitted and the user must untick the option — document that in-app.

Rationale: any workflow requiring the user to remember a checkbox will fail, and it fails with a message pointing at the wrong thing.

## Open risk: non-ASCII text (F7)

The BOM existed to make non-ASCII survive; it is now removed because it broke matching. **Untested**: comments in Cyrillic, accented, or emoji characters. If they mangle on import, encoding correctness and header matching are in direct conflict and need a third answer — not simply putting the BOM back.

**Test before shipping**: import a comment containing non-Latin text; verify it reads correctly in the Metadata panel.

## Where the fields actually appear (F10)

Comments and Keywords are only visible on the **Media page**, Metadata editor, **Shot & Scene** view. The Edit page's Metadata panel shows *Clip Details* only and has no view selector — the fields are unreachable there, which looks exactly like a failed import. Any user-facing instructions must say this.

## Confirmed by S1

1. ✅ Match column: `File Name` (exact case).
2. ✅ `Comments` and `Keywords` spellings correct.
3. ✅ Keyword separator: comma-space → separate keywords.
4. ✅ Matching uses the extension (`A001_C001.mp4`).
5. ✅ No BOM; `\r\n` endings fine.
6. ⚠️ Keyword *order* is not preserved (F9) — keywords are a set to Resolve. Do not assert order round-trips; our canonical still sorts for determinism.

## Known limitation (by design)

Markers never reach Resolve through this file. That is expected and stated in the spec — CSV has no representation for them. A user importing only the CSV gets comments and keywords, and no markers. OTIO is the marker path.
