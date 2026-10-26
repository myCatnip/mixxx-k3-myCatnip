## Dump format check

Valid JS, paste-ready. Multi-line with trailing commas, nested blocks (offScheme/coScheme/beat) inline where compact. One thing that doesn't match the docs: the outer line is `XoneK3.SCHEMES.NAME = {...};` — that doesn't paste **inside** `Object.assign(XoneK3.SCHEMES, {...})` because it's a statement, not a property. Options: paste after the block, or rename to `NAME: {...},`. Cheapest fix is the doc: paste **after** the Object.assign block. That's what the LAB.md below says.

Colours are dumped with `[r, g, b, brightness]` including brightness even when it's the default — no default-elision on the array itself, only on scheme-level fields. That's fine; paste re-parses cleanly.

---

## `docs/LAB.md` — full file

```markdown
# colorLab

Build LED colour ramps on the hardware. Dump them as JavaScript.

colorLab doesn't play music. It's a scheme editor. Load it, build
a ramp, dump it, paste into `xone-k3-cat-schemes.js`, switch back
to Cat.

## Quickstart

1. Load the colorLab preset in Preferences → Controllers.
2. Edit mode is where you start. Turn the preview knob
   (`knob0_0`). If the preview LED (button under it) shows white,
   the knob hasn't reported yet — keep turning.
3. Press a segment button to select it. Turn the RGB encoders
   (`encoder0..2`) or the brightness encoder (`encoder3`) to set
   its colour.
4. Press another segment. Repeat.
5. Shift + `press0` to dump. The scheme prints to the console.
6. Copy the printed block into `xone-k3-cat-schemes.js`,
   **after** the existing `Object.assign(XoneK3.SCHEMES, {...})`
   block. The dumped line is a full statement
   (`XoneK3.SCHEMES.NAME = {...};`), not a property — it goes
   outside the `Object.assign`, not inside it.
7. Reload Cat.

**Preview doesn't touch the edit buffer.** Shift + `pressR`
loads the preview into edit. `layer` returns to edit unchanged.

## The model

```
       edit                   slots[0..15]           SCHEMES
   working buffer           saved schemes          named schemes
   { colors: [...] }        { colors: [...] }      { ... }
        │                         │                      │
        └─────────┬───────────────┴──────────────────────┘
                  │
            previewSource
        'edit' | 0..15 | registry name
                  │
                  ▼
             previewing
        (bool — strip shows previewSource
         instead of edit buffer)
                  │
                  ▼
        What the LED strip paints
```

- **edit** — the working buffer. Starts as one black stop.
- **slot 0** — pre-populated at boot with `labDefault`, a single
  black stop. Its LED is green because of its index, not its
  contents.
- **slots[0..15]** — saved schemes. 0/1/2/3 are on/off/co/co-off.
  4..11 user saves. 12..15 auto-bake outputs.
- **previewSource** — `'edit'`, a slot index, or a registry
  scheme name.
- **previewing** — true when the strip is showing a previewed
  scheme.

## Modes

The layer button swaps between two modes.

```
                ┌─── colorLab (EDIT) ───┐
                │                        │
   layer button │   previewSource        │  layer button
      ──────────►   'edit' | 0..15 |     ◄──────────
                │   registry name        │
                │                        │
                │   previewing  bool     │
                │   saveArmed   bool     │
                └─────────┬──────────────┘
                          │
                          │ layer button
                          ▼
                ┌─── slots (SLOTS) ─────┐
                │                        │
                │   grid = 16 slot cells │
                │   preview LED tracks   │
                │   previewSource        │
                └─────────┬──────────────┘
                          │
                          │ pressL
                          ▼
                    back to EDIT
```

Preview flow:

```
   press slot N    →   previewSource = N
   shift + encL    →   previewSource = registry name
                       (scrolls; stays in current mode)
   shift + pressR  →   load preview into edit
   press slot,     →   save preview into that slot,
   saveArmed true      load into edit, exit to edit mode
```

### EDIT

The bottom half edits the edit buffer. Segment selection, RGB
knobs, faders, marker, ratio, beat.

### SLOTS

The bottom grid becomes 16 slot cells. The top strip keeps
showing the preview scheme; only the bottom cells swap.

```
grid0_0..grid0_3   slots 0,1,2,3       (on / off / co / co-off)
grid1_0..grid1_3   slots 4,5,6,7       (saves)
grid2_0..grid2_3   slots 8,9,10,11     (saves)
grid3_0..grid3_3   slots 12,13,14,15   (auto-bake outputs)
```

Cell colours:

```
0        green      (on)
1        red        (off)
2        white      (co)
3        soft blue  (co-off)
4..11    yellow     (saves)
12       green      (source bake)
13       blue       (structural bake)
14       cyan       (sampled bake)
15       magenta    (wire bake)

previewed   bright
populated   dim
empty       dark
```

Rebinding `labSlotPress, [5]` to a different cell moves slot 5's
LED there.

### Slots-mode buttons

| | |
|---|---|
| Grid press | Preview that slot. Grid stays visible. |
| `pressR` | Toggle arm. |
| Grid press, armed | Save preview into that slot, load into edit, exit to edit. |
| `pressL` | Exit to edit. Edit unchanged. |
| Shift + `pressR` | Load preview into edit, exit to edit. |
| Shift + `encoderL` | Scroll registry schemes. |
| `layer` | Exit to edit. |

If the preview cannot resolve — bad registry name, unpopulated
slot, anything that makes `_previewScheme()` return null — the
arm is cleared and the press falls through to a normal preview.
The slot is not written.

Overwriting a populated slot dumps the old contents to the
console as a backup. Saving over the current preview skips the
backup.

After a successful save you're in edit mode with the saved
content loaded.

## Preview sources

- **edit** — the working buffer. Only source that permits edits.
- **a slot index** — set by pressing a slot cell.
- **a registry scheme name** — set by scrolling with
  shift + `encoderL`.

Auto-bake runs when the preview lands on `'edit'` or slots 0..11.
Skipped for slots 12..15 (bake outputs) and for registry schemes.

## Editing

**Edits only take effect in edit mode.** With a preview showing,
the first edit attempt is a no-op and prints a warn-once:

```
[k3] preview is preview-only — shift+pressR loads the preview
     into edit before edits take effect
```

### Selecting a stop

Each segment LED is a stop. Press it to select.

Pressing a cell beyond the current array **extends** the array
to that index. New cells are black **gaps** — they exist in the
array but aren't marked as real stops. The cell you pressed
*is* marked real, even if you leave it black.

The gap-vs-real distinction drives fill and delete (below).

**Shift + press** deletes the cell:

- **Real stop** → cascade. The stop and every gap cell between
  its real neighbours are removed, so the neighbours become
  adjacent.
- **Gap** → splice just that cell. Subsequent cells shift down
  by one. No cascade.

Cell 0 can't be deleted. Selection jumps to cell 0 after any
delete.

### Real stops vs gaps

Every cell is either a **real stop** (you pressed it, or it's
non-black) or a **gap** (extension cell you haven't pressed).

- Fill anchors on real stops. Gaps are what fill paints.
- Editing a gap with non-black makes it real automatically.
- Saving to a slot, baking, or loading a scheme collapses all
  gaps into real stops. A pasted scheme from `cat-schemes.js`
  has no gap state — everything is fully set. Gap state exists
  only during the current edit session.

### Black is a colour

Black `(0, 0, 0)` is a first-class stop. A cell can be
black-and-real (an intentional black you pressed) or
black-and-gap (an extension cell).

**Hold shift** and every real black stop lights white at
brightness 50 — findable for shift+press deletion. Gaps stay
black, so the highlighted cells are exactly what you can delete.

The highlight is edit-mode only. Previewing a scheme that has
black stops won't light them white even with shift held — it's
an editing aid, not a scheme property.

### Changing a stop

With a stop selected:

- **Stepped edit** — RGB encoders and brightness encoder
  increment by ±1.
- **Absolute edit** — faders set R, G, B, brightness directly.

If the marker is selected, the same controls edit the marker
colour and brightness.

### Preview

A preview LED samples the ramp at a sweep position you control
with a knob.

The button under the preview LED toggles between on-ramp and
off-ramp sampling.

If the preview knob is bound to a CO, co-match kicks in when the
knob and the CO disagree — the LED shows the matching gradient
instead. Turn until they match.

If the current scheme has a beat config, the preview LED pulses
on every beat.

### Interp, calibration, ratio

Three state toggles. Their LEDs show on/off.

- **Interp** — `true`: blend between stops. `false`: snap.
- **Calibration** — `true`: apply the flat-target solve. `false`:
  raw values to the wire.
- **Ratio** — turn on for per-stop weights. Only works when the
  scheme has ≤ 9 stops. Turning it off wipes the table.

### Marker

Press the marker LED to select the marker. Same edit controls.

- **Marker position** — 0..127. 63.5 = centre.
- **Marker width** — 0 = off. Wider = bigger trigger band.
- **Marker colour** — same RGB controls.

Shift + press the marker LED clears the marker.

The marker takes an off-brightness as its last colour field:
`'red, 80, 16'` is `red@80` on, `red@16` off.

When the deviation LED's knob sits inside
`markerPosition ± markerWidth`, the marker colour wins over the
ramp sample. The lab preview LED shows it raw — no beat cascade
applied; the runtime LEDs cascade it like a static LED.

### Fill gaps

Linearly interpolates every gap between two real stops. Real
stops are anchors and are never overwritten, so use them to pin
the endpoints of a blend.

To make a black stop an anchor, press it first — that marks it
real.

Filled cells become real stops (so a second fill doesn't
re-paint them). To re-fill a range, delete the cells first or
black them and set them again.

## Beat edit overlay

Press **grid2_3** in edit mode to toggle. The button's LED shows
the state: dim white when out, cyan when in.

The overlay repurposes the grid and L/R encoders to edit a
scheme's `beat` config.

Open with no preview showing — the beat config you'd edit lives
in a scheme that isn't loaded while previewing. Press
shift + `pressR` first to load the preview into the edit buffer.

```
grid0_0   beat colour target
grid1_0   bar colour target
grid2_0   prePhrase colour target
grid3_0   phrase colour target

grid0_1   on/off toggle      green = on, red = off
```

Rebinding the target cells moves the LEDs with them.

### Editing a colour target

Press a target to select it. The four targets work like stops:

- **Stepped edit** — top RGB encoders and brightness encoder
  increment by ±1.
- **Absolute edit** — faders set R, G, B, brightness directly.

Targets show dim when unset and the colour you set otherwise.
Selection is not indicated on the grid — the preview LED is the
reference for what you're editing.

**Shift + press** a target to clear it.

### On/off toggle

`grid0_1` toggles the whole beat config. Off means the beat is
saved but not applied. On first entry with no `beat` config, the
overlay creates `{ enabled: true }` and the button starts green.

The rest of the grid is nulled while the overlay is active.

### Preview LED in beat edit

Once the preview's deck has fired at least one beat, the preview
LED pulses through the cascade.

Before the first beat, beat-edit mode with a target selected
shows the target's colour solid — eyeball what you just set
without waiting for a beat.

The segment strip behind the grid does not pulse in beat edit;
the preview LED is the pulse reference.

### Encoders

| | |
|---|---|
| `encoderL` | `barBeats` — beats per bar |
| `encoderR` | `phraseBars` — bars per phrase |
| Shift + `encoderR` | `prePhraseBeats` — beats before phrase |

`barBeats` and `phraseBars` clamp to 1..32. `prePhraseBeats`
clamps to `[0, barBeats * phraseBars - 1]` and defaults to one
bar.

### Dump behaviour

The beat config is emitted only when `enabled !== false`.
Toggling off and dumping discards it.

## Slots and bakes

Three of the sixteen slots are automatic bakes of the current
preview. They rewrite whenever the preview changes; you never
save to them by hand.

| Slot | Contents | Rewrites on |
|---|---|---|
| 12 source | Verbatim clone of the preview. | preview change |
| 13 structural | One stop per segment. Lossless. | preview change |
| 14 sampled | 23 equal-spaced stops. | preview change |
| 15 wire | 23 stops, hardware-solved. | preview change |

### What each bake keeps

Fields are either **kept** (still in the emitted scheme, still
runtime-controlled), **baked** (already in the stops, no longer a
field), or **dropped** (not needed on reload).

| Field | Lab control | structural | sampled | wire |
|---|---|---|---|---|
| stops | segment cells | per segment | 23 equal | 23 + hw |
| `ratio` | press2 + knobs | kept | baked | dropped |
| `curve` | shift+enc0 | kept | baked | baked |
| `schemePosition` | knob2_0 | kept | baked | baked |
| `brightness` | enc3 / shift+enc1 | kept | kept | baked |
| `brightnessScale` | shift+enc2 | kept | kept | baked |
| `calibration` | press1 | kept | kept | forced off |
| `interp` | press3 | kept | kept | kept |
| marker | grid3_3 + knob1_0 + encL | kept | kept | kept |
| `offScheme`, `coScheme` | — | kept | kept | kept |
| `beat` | grid2_3 | kept | kept | kept |

**Baked** means the value is worked into the stop positions or
brightness — on reload nothing re-applies it. **Kept** means it
stays as a field and the runtime re-applies it live.

### Preview vs hardware

For structural and sampled, calibration stays on — the preview
and the hardware both re-solve brightness at render time. They
match only if the calibration tuning hasn't changed between
preview and reload.

For wire, calibration is off. The solve is frozen into each
stop's brightness. Preview matches hardware exactly, regardless
of tuning. Wire is the "what I see is what I get" slot.

### Field notes

- `curve` — warps stop boundaries. Default 0 (none). Positive
  squishes toward the middle; negative pushes toward the edges.
- `schemePosition` — slides the whole ramp. Default 63.5 (centre).
- `brightness` — default stop brightness when a stop has none.
  Default 127.
- `brightnessScale` — multiplier on the calibration target.
  Rarely needed.
- `interp` — true blends between stops, false snaps.
- `ratio` — per-stop weight. Editing turns it on; off resets to
  equal weights.

## Matching uncalibrated schemes

`calibration: true` solves each stop's brightness so every colour
hits the same perceived level. It can't solve black — black has
no emission to normalize against. So a calibrated scheme can't
fade to true black.

To get several different colours that match at every step **and**
fade to black:

1. Build the ramp with calibration on. Use the wire slot (15) as
   your reference.
2. The wire stops are already-solved RGB + brightness values.
3. Copy them into a **new uncalibrated** scheme
   (`calibration: false`, press1 off).
4. End with `[0, 0, 0]` at fixed brightness.

The colours match because the stops came out of the same solve.
The fade works because with calibration off the runtime isn't
fighting the darkening.

For a shared off-state, use each stop's brightness as
`brightnessOff` on the new scheme. All schemes dim to the same
perceived level when their `on:` reads 0.

## Dump

Shift + `press0` prints the preview as JavaScript.

- **Edit preview** → `XoneK3.SCHEMES.NAME = { ... };`
- **Registry preview** → same
- **Slot preview** → `XoneK3.SCHEMES.slotN = { ... };`. Slot 0
  includes the off/co/co-off chain from slots 1/2/3.

Rename `NAME` or `slotN` to whatever you want. Paste **after**
the existing `Object.assign(XoneK3.SCHEMES, {...})` block in
`xone-k3-cat-schemes.js` — the dump is a statement, not a
property.

If you'd rather paste inside the `Object.assign` block, strip
the leading `XoneK3.SCHEMES.` and the trailing `;` so it becomes
`NAME: {...},`.

### Format

Multi-line, trailing commas (valid JS, matches the codebase
style). Nested blocks (`offScheme`, `coScheme`, `beat`) inline
where compact. Only non-default fields appear — a scheme with
just `colors` is three lines.

Example:

```js
XoneK3.SCHEMES.myNew = {
    colors: [
        [127, 0, 0],
        [0, 127, 0],
        [0, 0, 127]
    ],
    markerColor: [127, 0, 0, 93],
    markerWidth: 2,
};
```

`coScheme: null` (disables co-match) is dropped by the emitter.
Reload falls back to the runtime default `'coMatch'`. If you
want to permanently disable co-match for a scheme, edit
`cat-schemes.js` by hand after paste.

### Slot chain for slot 0

Slots 0–3 form one conceptual scheme:

| Slot | Role |
|---|---|
| 0 | on |
| 1 | off — slot 0's `offScheme` |
| 2 | co — slot 0's `coScheme` |
| 3 | co-off — slot 2's `offScheme` |

Missing slots fall back to engine defaults (generated off from
the on-ramp; engine `coMatch` for the co ramp).

Dumping slot 0 emits the whole chain as **one** scheme object
with nested inline `offScheme` / `coScheme` objects:

```js
XoneK3.SCHEMES.NAME = {
    colors: [
        [127, 0, 0]
    ],
    offScheme: {
        colors: [
            [10, 10, 10]
        ],
    },
    coScheme: {
        colors: [
            [40, 40, 40]
        ],
        offScheme: {
            colors: [
                [5, 5, 5]
            ],
        },
    },
};
```

Each nested block only appears if the corresponding slot is
filled. Paste the whole object as one `XoneK3.SCHEMES.NAME = {…}`
statement.

### What gets emitted

Non-default fields only. Fields at their default don't appear.

The beat block is expanded across multiple lines with one field
per line, sub-objects inline:

```js
beat: {
    color: [89, 68, 125],
    brightness: 4,
    bar: { color: [0, 69, 0], brightness: 127 },
    prePhrase: { color: [0, 127, 127], brightness: 127 },
    phrase: { color: [127, 0, 127], brightness: 127 }
},
```

## Registry scroll

Shift + `encoderL`. Works from any mode. Loads each named scheme
in `XoneK3.SCHEMES` into the preview, one per step. Skips
registrations that don't carry `colors`.

Scrolling doesn't change modes — the strip (edit mode) or grid
(slots mode) stays visible, and the preview LED tracks the
scrolled scheme.

If `XoneK3.SCHEME_REGISTRY` is defined (`xone-k3-lab.js`), scroll
iterates that list instead of scanning `SCHEMES`. Use it to order
what shows up and hide test schemes.

## Shutdown

On preset unload, the lab dumps every populated slot to the
console. Silence with `XoneK3.LAB_DUMP_ON_SHUTDOWN = false`.

Chord shutdown: shift + layer held, `press3` held 2 s. Releasing
shift, layer, or `press3` cancels the timer. Works from EDIT and
SLOTS.

## Workflows

### Build from scratch

1. Load. Edit mode. Buffer starts as one black stop.
2. Press segment 0. Edit.
3. Press segment 1. Scheme extends. Edit.
4. Repeat.
5. Fill gaps if anchors are far apart.
6. Turn the preview knob to sweep.
7. Adjust marker: position, width, colour.
8. For a beat pulse: press `grid2_3`, set colours and time
   signature, press `grid2_3` again to exit.
9. Shift + `press0` to dump.
10. Paste, rename.

### Edit an existing scheme

1. Load.
2. Shift + `encoderL` to scroll until the scheme is previewed.
3. **Shift + `pressR`** to load the preview into the buffer.
   Nothing you do before this changes the buffer.
4. Edit.
5. Shift + `press0` to dump.
6. Paste over the old scheme.

Alternative: `layer` → slots, scroll, then shift + `pressR`.

### Save to a slot

1. In edit mode, get the buffer how you want it.
2. Press `layer` → slots.
3. Press `pressR` to arm.
4. Press the slot you want. Saves, loads the slot into the
   buffer, exits to edit mode.
5. Continue editing.

Slot presses without arming just preview — the grid stays up and
the preview LED tracks the slot. Press `layer` to leave.

### Fade to black across multiple colours

1. Build the ramp. Calibration on.
2. Preview the wire slot (15). Its stops are the target hw
   brightness for each colour.
3. Dump the wire slot. Copy the emitted colours.
4. Paste as a new scheme with `calibration: false`.
5. Add `[0, 0, 0]` at the end.

Repeat for each colour. All ramps will match perceptually at
their anchors and all fade cleanly to black.

## Terms

| | |
|---|---|
| **Stop** | One entry in `colors`. RGB + optional brightness. |
| **Real stop** | A stop the user set — pressed, non-black, or loaded from a saved scheme. Fill anchors on these. |
| **Gap** | An extension cell the user hasn't pressed. Fill paints these. Collapsed to real stops on save. |
| **Preview** | A scheme being inspected. Not editable. |
| **Edit buffer** | The working scheme. Only mutated in edit mode. |
| **Bake** | Automatic rewrite into an output slot. See Slots. |
| **Wire** | Bake level where the calibration solve is frozen into brightness. |

## Debug output

Shift + `press0` and other edits print to the console when
`XoneK3._debugPrintsOn = true`.

```
[k3] seg 3 r = 80
[k3] curve = 0.325
[k3] preview slot 5
[k3] saved edit -> slot 3
[k3] beat barBeats = 3
[k3] edit := slot5
```

Mode events print when `XoneK3.MODE_PRINTS = true`.

```
[k3] mode = EDIT
[k3] mode = SLOTS (preview=edit)
[k3] arm = ON
[k3] preview = slot5
[k3] scheme = filterEcho
```

Warnings fire once per boot via `_warnOnce`. The preview-only
key is `labEditWhilePreviewing`. Reload the preset to re-arm.

## Not in the lab

- No music bindings. That's Cat.
- No undo. Dump before unloading.
- No persistence across presets.
- Ratio editing only touches the first 9 stops.
- Beat config is edited but not played on the segment strip.
  The preview LED pulses; the strip does not.
- Gap/real distinction doesn't persist. Saving, baking, and
  loading all collapse gaps to real stops. Only the current edit
  session tracks the difference.