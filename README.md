# Xone K3 — Mixxx mapping

Custom Mixxx mapping for the Allen & Heath Xone K3.

One runtime, two layer trees, five presets. Four playback presets
share one layer tree and differ only in boot config; colorLab is
a separate editor preset. Presets on the same MIDI channel fight
over outputs — Cat, oneK3, oneK3 miniFX, and colorLab all ship on
0x0E. Change one before running them together.

| Preset | Channel | Boot mode | Layer tree | Use case |
|---|---|---|---|---|
| **Cat** | 0x0E | focus | CAT_LAYERS | Main preset. Re-pointable single-deck top half. |
| **Kitten** | 0x0D | focus, slot B | CAT_LAYERS | Second unit, opposite slot by default. |
| **oneK3** | 0x0E | twoDeck | CAT_LAYERS | Single K3, both decks visible. |
| **oneK3 miniFX** | 0x0E | twoDeckMini | CAT_LAYERS | Both decks, one focused FX unit in the middle. |
| **colorLab** | 0x0E | n/a | lab | No playback. LED colour ramp editor. |

---

## Install

1. Copy the `xone-k3-*.js` files and the `*.midi.xml` files into
   `~/.mixxx/controllers/`.
2. Preferences → Controllers → pick the K3 → Preset.
3. Pick a preset.
4. After editing any file: untick / re-tick the preset checkbox.

---

## Where to go

| I want to… | Read |
|---|---|
| Understand how the system works | `CONCEPTS.md` |
| See the physical layout and what each control does | this file, §Physical layout and behaviour, §LAB layout and behaviour |
| Look up an FX cell by unit and mode | this file, §FX cell layouts |
| Change a colour, rebind a button, add a mode | `CUSTOMISE.md` |
| Understand the runtime, tune internals | `INTERNALS.md` |
| Build a colour ramp on the hardware | `LAB.md` |
| Look up a term | `GLOSSARY.md` |
| Ask an AI to edit for me | `AI-HELPER.md` |

If you only read one thing, read `CONCEPTS.md`. Every other doc
assumes it.

---

## Physical layout and behaviour

```
                    ┌───────────┬───────────┬───────────┬───────────┐
  TOP               │ encoder0  │ encoder1  │ encoder2  │ encoder3  │
                    │ press0    │ press1    │ press2    │ press3    │
                    ├───────────┼───────────┼───────────┼───────────┤
                    │ knob0_0   │ knob1_0   │ knob2_0   │ knob3_0   │  row 0
                    │ button0_0 │ button1_0 │ button2_0 │ button3_0 │
                    │ knob0_1   │ knob1_1   │ knob2_1   │ knob3_1   │  row 1
                    │ button0_1 │ button1_1 │ button2_1 │ button3_1 │
                    │ knob0_2   │ knob1_2   │ knob2_2   │ knob3_2   │  row 2
                    │ button0_2 │ button1_2 │ button2_2 │ button3_2 │
                    ├───────────┼───────────┼───────────┼───────────┤
  FADERS            │ fader0    │ fader1    │ fader2    │ fader3    │
                    ├───────────┼───────────┼───────────┼───────────┤
  GRID              │ grid0_0   │ grid1_0   │ grid2_0   │ grid3_0   │  row 0
                    │ grid0_1   │ grid1_1   │ grid2_1   │ grid3_1   │  row 1
                    │ grid0_2   │ grid1_2   │ grid2_2   │ grid3_2   │  row 2
                    │ grid0_3   │ grid1_3   │ grid2_3   │ grid3_3   │  row 3
                    ├───────────┼───────────┼───────────┼───────────┤
  BOTTOM            │ layer     │ encoderL  │ encoderR  │ shift     │
                    │           │ pressL    │ pressR    │           │
                    └───────────┴───────────┴───────────┴───────────┘
```

`encoderL`/`encoderR` are separate from `encoder0`–`encoder3`, and
`pressL`/`pressR` are separate from `press0`–`press3` — the L/R
pair sit at the bottom, beside the layer and shift buttons, with
each press-switch directly under its encoder.

Section labels (TOP / FADERS / GRID / BOTTOM) match the blocks in
the layout table. `row N` on the right names the physical row
(`knobX_N` / `buttonX_N` / `gridX_N`). `layer` and `shift` cycle
and hold respectively; the L/R encoders and presses are the
performance pair described in the bottom section.

The blocks below describe what each physical control does in each
mode.

```
════════════════════════════════════════════════════════════
TOP — encoder0-3 / press0-3
════════════════════════════════════════════════════════════

FOCUS  (Cat / Kitten)
enc0:  pregain act.deck       +shift: keyReset  act.deck
enc1:  QFX cycle act.deck     +shift: keySync   act.deck
enc2:  —                      +shift: —
enc3:  —                      +shift: —

press0: active deck ← A       +shift: sync A         LED: theme, bright=active
press1: active deck ← B       +shift: keylock A      LED: theme, bright=active
press2: active fx ← A         +shift: keylock B      LED: theme, bright=active
press3: active fx ← B         +shift: sync B         LED: theme, bright=active

twoDeck  (oneK3)
enc0:  pregain A              +shift: keySync  A
enc1:  QFX cycle A            +shift: keyReset A
enc2:  QFX cycle B            +shift: keyReset B
enc3:  pregain B              +shift: keySync  B

press0: active deck ← A       +shift: sync A         LED: theme deckA, bright=active
press1: FX-A → deck A         +shift: keylock A      LED: FX-A colour
press2: FX-B → deck B         +shift: keylock B      LED: FX-B colour
press3: active deck ← B       +shift: sync B         LED: theme deckB, bright=active

twoDeckMini  (oneK3 miniFX)
enc0-3: inherit twoDeck
press0: active deck ← A       +shift: sync act.deck       LED: theme deckA, bright=active
press1: focused FX → deck A   +shift: keylock act.deck    LED: FX focus colour
press2: focused FX → deck B   +shift: active fx ← A       LED: FX focus colour
press3: active deck ← B       +shift: active fx ← B       LED: theme deckB, bright=active


════════════════════════════════════════════════════════════
GRID — rows 0-1
════════════════════════════════════════════════════════════

grid0_0:  jump −1 beat             +shift: inherit       LED: ramp fader0
grid1_0:  jump +1 beat             +shift: inherit       LED: ramp fader1
grid2_0:  cycle timeline           +shift: LED only      LED: ramp fader2 · bright=track, dim=loop · shift=dim
grid3_0:  CUE: cue                 +shift: clear cue     LED: ramp fader3, tracks cue_indicator
          LOOP/ODD: —              +shift: —             LED: ramp fader3, always lit

grid0_1:  CUE: jump −16            +shift: inherit       LED: purple [69,0,127]
          LOOP/ODD: jump −size     +shift: inherit       LED: magenta
grid1_1:  CUE: jump +16            +shift: inherit       LED: purple
          LOOP/ODD: jump +size     +shift: inherit       LED: magenta
grid2_1:  toggle slip              +shift: flip deck     LED: slipScheme · theme of active-deck ch
grid3_1:  toggle play              +shift: LED only      LED: green=track, yellow=loop


════════════════════════════════════════════════════════════
GRID — rows 2-3
════════════════════════════════════════════════════════════

                         row 2                row 3
                     g0_2 g1_2 g2_2 g3_2   g0_3 g1_3 g2_3 g3_3
CUE     (hotcues)      1    2    3    4      5    6    7    8
  +shift: clear 1-8    —    —    —    —      —    —    —    —

LOOP    (loop sizes)   8    4    2    1     1/16 1/8  1/4  1/2
  +shift: beatjump
  size (same cell map) 8    4    2    1     1/16 1/8  1/4  1/2

ODD     (odd loops)    7    5    3    1     3/32 3/16 3/8  1/2
  +shift: beatjump
  size (same cell map) 7    5    3    1     3/32 3/16 3/8  1/2

LEDs
  CUE hotcues         per-hotcue colour read from Mixxx
  LOOP sizes          green · teal2 (grid3_2 / grid3_3)
  LOOP shift sizes    teal2 · green (grid3_2 / grid3_3)
  ODD sizes           cyan · sky2  (grid3_2 / grid3_3)
  ODD shift sizes     sky2 · cyan  (grid3_2 / grid3_3)

Notes
  CUE hotcue press jumps to the hotcue. If the hotcue's colour is in
  PHRASE_MARKER_COLORS, the phrase origin follows automatically on the
  next playposition tick.
  Shift + hotcue = hotcue_N_clear (clears the hotcue slot).
  Loop-size and beatjump-size cells: pressSetValue writes the CO
  (beatloop_size / beatjump_size) on press-release edge.


════════════════════════════════════════════════════════════
FADERS
════════════════════════════════════════════════════════════

FOCUS  (Cat / Kitten)
fader0: pregain act.deck — actually volume act.deck   (inKey: volume)
fader1: FX-act mix                                    (inKey: mix)
fader2: —
fader3: —

twoDeck  (oneK3)
fader0: deck A volume
fader1: FX-A mix
fader2: FX-B mix
fader3: deck B volume

twoDeckMini  (oneK3 miniFX)
inherits twoDeck — faders do NOT follow focus. fader1/fader2 always mix the
pinned A/B units, never $FX_ACTIVE_N$.

Shift / chord
No shift companion, no chord override. Faders are identical in every state.

As LED sources
fader0..fader3 are the deviation knobs for grid row 0:
  grid0_0 reads fader0 · grid1_0 reads fader1
  grid2_0 reads fader2 · grid3_0 reads fader3
Fader position drives the ramp sample; fader N's own binding writes volume/mix.


════════════════════════════════════════════════════════════
LAYER BUTTON  (cycles bottom layer)
════════════════════════════════════════════════════════════

press:  CUE → LOOP → ODD → CUE  (replacePatch swaps the active layer)
LED:    track-end countdown on DECK A (4 phases: green/yellow/amber/red)
+shift: enters the chord (layer press is intercepted)


════════════════════════════════════════════════════════════
BOTTOM — encoderL / pressL / encoderR / pressR
════════════════════════════════════════════════════════════

CUE  (base)
encL:  BPM ±0.1                +shift: master gain
       pressL held → head mix
pressL: hold: encL = head mix
       +shift release (no turn): toggle headSplit
encR:  playlist prev/next       +shift: headphone volume
pressR: hold: arm track load
       while held: TOP press0/3 and selectAB cells load onto that
       channel instead of switching focus

LOOP  (diffs from CUE)
encL:  loop in-point nudge             +shift: beatjump
pressL: reloop (anchor→0)              +shift: inherit
encR:  loop out-point nudge            +shift: halve/double beatjump_size
pressR: beatloop activate              +shift: inherit

ODD  (inherits LOOP, no diffs for these four)


════════════════════════════════════════════════════════════
SHIFT BUTTON  (top right)
════════════════════════════════════════════════════════════

press:   isShifted = true → shift layer joins the stack
release: if _chordActive → _exitChord; then isShifted = false
LED:     track-end countdown on DECK B (same phases as layer button)


════════════════════════════════════════════════════════════
CHORD  (shift + layer, both held)
════════════════════════════════════════════════════════════

Enter:  hold shift, press layer, keep both held
Exit:   release shift OR layer, OR trigger shutdown timer

Overrides (top press row only — CHORD patch declares just these):
press0: toggle fxRouting overlay (clears selectAB)
press1: toggle selectAB overlay  (clears fxRouting)
press2: —
press3: hold 2 s → shutdown
pressR: toggleTopMode  (focus ↔ twoDeck-family; mini → focus)
pressL: toggleMiniFx   (twoDeck ↔ mini; focus → no-op)

Passes through unchanged:
enc0-3:  whatever the active top mode bound them to (chord holds shift, so
         shift-layer applies if that mode defines one)
encL/R:  whatever the active bottom layer bound them to
grids:   chord requires shift held, so grid cells behave as shifted

Overlays (enter via chord, exit via layer press or toggle again):

selectAB
  grid row 0: deck A ← channel 1-4
  grid row 1: deck B ← channel 1-4
  grid row 2: fx A   ← unit 1-4
  grid row 3: fx B   ← unit 1-4
  Layer press: exit
  pressR held + tap a deck cell: load onto that channel

fxRouting
  gridN_M: toggle FX(N+1) → channel(M+1) group-enable
  Layer press: exit
```

---

## FX cell layouts

Every mode's middle cells come from a per-unit layout table. When
the focused FX unit changes, the runtime swaps the live layout
patch automatically. You don't rebind by hand.

Three tables:

| Mode | Table | Layout cells | Emitter | Patch family |
|---|---|---|---|---|
| focus | `FX_LAYOUTS` | 16 | `fxCells(n)` | `fxLayout1..4` |
| twoDeck | `TWO_DECK_FX_LAYOUTS` | 4 per column | `twoDeckFxColumn(side, n)` | `fxLayoutA1..4`, `fxLayoutB1..4` |
| mini | `TWO_DECK_MINI_FX_LAYOUTS` | 8 | `twoDeckMiniFxCells(n)` | `fxMini1..4` |

QFX is **not** in these tables. `knob1_2` / `button1_2` are plain
bindings in the top-half base patch (`TOP_SHARED` / `TWO_DECK`).
The QFX super knob and rack enable are shared across all layout
patches, unlike the middle cells which swap per unit.

Notation: `FX<n>.p<m>` means effect `n` parameter `m` on the focused
unit. `meta` means the effect's meta knob. `btn<k>` means
`button_parameter<k>`. The parenthesised value (`hi` / `mid` /
`lo`) is the marker band position on the LED's ramp.

`LED→knobN_M` cells are display-only — no press action, LED
echoes the knob above. In the table: `{ displayOnly: true }`,
optionally with `on: false` for a dim echo. Tracks the adjacent
knob automatically; `ledTracks: 'knobX'` only for a non-adjacent
target.

### Focus mode — `FX_LAYOUTS`

16 cells: rows 0–1 cols 1–3 (12 cells), plus row 2 cols 2–3 (4
cells). Row 2 col 1 is QFX and lives in `TOP_SHARED`. Col 0 is
the EQ/PFL column, also `TOP_SHARED`.

All cells point at the unit whose `fxLayout<n>` is in the active
stack — the patch hardcodes its own unit number, and
`_syncFxLayout` keeps the focused one in the stack.

Unit 1 is the base table, units 2–4 add overrides. **Bold** =
differs from unit 1.

**Row 0**

| Cell | Unit 1 | Unit 2 | Unit 3 | Unit 4 |
|---|---|---|---|---|
| `knob1_0` | FX2.p3 | **FX2.p1** | **FX2.p2** | **FX2.p1** |
| `knob2_0` | FX1.p2 | **FX1.p1** | FX1.p2 | **FX1.p1** |
| `knob3_0` | FX1.meta | **FX1.p2** | FX1.meta | **FX1.p3** |
| `button1_0` | LED→`knob1_0` | LED→`knob1_0` | LED→`knob1_0` (lo) | LED→`knob1_0` (110) |
| `button2_0` | LED→`knob2_0` | LED→`knob2_0` (hi) | LED→`knob2_0` | LED→`knob2_0` |
| `button3_0` | FX1.enable | FX1.enable (hi) | FX1.enable | FX1.enable |

**Row 1**

| Cell | Unit 1 | Unit 2 | Unit 3 | Unit 4 |
|---|---|---|---|---|
| `knob1_1` | FX2.p1 | FX2.p1 | **FX2.p3** | **FX2.p2** |
| `knob2_1` | FX2.p2 | FX2.p2 | **FX2.p4** | **FX2.p3** |
| `knob3_1` | FX2.p4 | FX2.p4 | **FX2.p5** | **FX2.p5** |
| `button1_1` | FX2.btn1 | FX2.btn1 | FX2.btn1 (mid) | FX2.btn1 (110) |
| `button2_1` | FX2.btn2 | FX2.btn2 | LED→`knob2_1` (mid) | FX2.btn2 (110) |
| `button3_1` | FX2.enable (lo) | FX2.enable (lo) | FX2.enable (lo) | FX2.enable (mid) |

**Row 2 (cols 2–3)**

| Cell | Unit 1 | Unit 2 | Unit 3 | Unit 4 |
|---|---|---|---|---|
| `knob2_2` | FX3.p2 | FX3.p2 | FX3.p2 | FX3.p2 |
| `knob3_2` | FX3.meta | FX3.meta | FX3.meta | FX3.meta |
| `button2_2` | fxRoute | fxRoute | fxRoute | fxRoute |
| `button3_2` | FX3.enable | FX3.enable | FX3.enable | FX3.enable |

`button0_2` (alt FX route) comes from `TOP_SHARED`, not this
table — it doesn't change per unit.

`button2_2` is `fxRoute: true` on every unit: it routes the
focused FX unit into the active deck. LED on/off follows the
route CO; deviation position samples `knob2_2`; colour follows
the focused unit's theme.

### twoDeck — `TWO_DECK_FX_LAYOUTS`

4 cells per column, per unit, in rows 0–1. Column 1 emits into
`knob1_0` / `knob1_1` / `button1_0` / `button1_1` and follows
`$FX_A_N$`. Column 2 emits into the `*2_*` cells and follows
`$FX_B_N$`.

```
              col 1        col 2
row 0  knob   knob1_0      knob2_0
       btn    button1_0    button2_0
row 1  knob   knob1_1      knob2_1
       btn    button1_1    button2_1
```

All four units share the same table (`twoDeckFxTable()` returns
one entry, no overrides):

| Cell in col 1 | Cell in col 2 | Content |
|---|---|---|
| `knob1_0` | `knob2_0` | FX1.meta |
| `knob1_1` | `knob2_1` | FX2.meta |
| `button1_0` | `button2_0` | FX1.enable (lo) |
| `button1_1` | `button2_1` | FX2.enable (lo) |

Row 2 comes from `TWO_DECK`, not this table: `knob1_2` /
`button1_2` = QFX A super/enable, `knob2_2` / `button2_2` = QFX B
super/enable. `button0_2` / `button3_2` (cross-routes) also come
from `TWO_DECK`.

### twoDeck mini — `TWO_DECK_MINI_FX_LAYOUTS`

8 cells in rows 0–1, all pointing at `$FX_ACTIVE_N$`:

```
              col 1        col 2
row 0  knob   knob1_0      knob2_0
       btn    button1_0    button2_0
row 1  knob   knob1_1      knob2_1
       btn    button1_1    button2_1
```

All four units share the same table (`twoDeckMiniFxTable()`
returns one entry, no overrides):

| Cell | Content |
|---|---|
| `knob1_0` | FX1.p1 |
| `knob2_0` | FX2.p1 |
| `knob1_1` | FX1.meta |
| `knob2_1` | FX2.meta |
| `button1_0` | FX1.btn1 (lo) |
| `button2_0` | FX2.btn1 (lo) |
| `button1_1` | FX1.enable (lo) |
| `button2_1` | FX2.enable (lo) |

Col 1 rows 0–1 is effect 1's parameter and meta; col 2 rows 0–1
is effect 2's. Same visual column split as twoDeck, just with
effects 1 and 2 instead of two independent units.

Row 2 comes from `TWO_DECK` / `TWO_DECK_MINI` — QFX A and B, plus
the alt cross-routes. `button0_2` / `button3_2` use `$FX_ALT_N$`
(the unit that isn't focused), not `$FX_ACTIVE_N$`.

### Editing a layout

Change the table entry in `xone-k3-cat-fx.js`. See CUSTOMISE → FX
cell mapping for the field vocabulary and worked examples.

---

## LAB layout and behaviour

Same physical layout as above. colorLab replaces the entire
layer tree — none of the playback bindings above apply. Two
modes, swapped by the layer button.

```
════════════════════════════════════════════════════════════
EDIT mode — TOP
════════════════════════════════════════════════════════════

                           unshifted                        +shift
enc0:                R ±1                            curve ±0.025
enc1:                G ±1                            brightness ±1
enc2:                B ±1                            brightnessScale ±0.05
enc3:                brightness ±1                   —
fader0:              R abs (0..127)                   identical
fader1:              G abs                           identical
fader2:              B abs                           identical
fader3:              brightness abs                  identical
knob0_0:             preview position                preview, no co-match
                     co-matched to QFX super1
knob1_0:             markerPosition (0..127)         identical
knob2_0:             schemePosition (0..127)         identical
knob3_0:             ratio[0]                        identical
knob0_1:             ratio[1]     knob1_1: ratio[2]  identical
knob2_1:             ratio[3]     knob3_1: ratio[4]  identical
knob0_2:             ratio[5]     knob1_2: ratio[6]  identical
knob2_2:             ratio[7]     knob3_2: ratio[8]  identical

button0_0:           toggle preview on/off ramp      identical
                     no LED
button1_0:           reset markerPosition → 63.5     reset brightness → 127
                     LED: dim red                    LED: dim white
button2_0:           reset schemePosition → 63.5     reset brightnessScale → 1
                     LED: dim green                  LED: dim white
button3_0:           select segment 0                identical
button0_1:           select segment 1                identical
button1_1:           select segment 2                identical
button2_1:           select segment 3                identical
button3_1:           select segment 4                identical
button0_2:           select segment 5                identical
button1_2:           select segment 6                identical
button2_2:           select segment 7                identical
button3_2:           select segment 8                identical

press0:              print seg / marker to console   dump scheme
                     LED: dim white                  LED: dim cyan
press1:              toggle calibration              toggle white balance
                     LED: green=on, red=off          LED: green=on, red=off
press2:              toggle ratio edit               identical
                     LED: green=on, red=off
press3:              toggle interp                   toggle tuning overlay
                     LED: green=on, red=off          no LED


════════════════════════════════════════════════════════════
EDIT mode — GRID
════════════════════════════════════════════════════════════

Segment → cell map (segments 0–8 are on top-row buttons, 9–22
on the grid):

button3_0: seg 0   button0_1: seg 1   button1_1: seg 2
button2_1: seg 3   button3_1: seg 4   button0_2: seg 5
button1_2: seg 6   button2_2: seg 7   button3_2: seg 8

grid0_0: seg 9    grid1_0: seg 10   grid2_0: seg 11   grid3_0: seg 12
grid0_1: seg 13   grid1_1: seg 14   grid2_1: seg 15   grid3_1: seg 16
grid0_2: seg 17   grid1_2: seg 18   grid2_2: seg 19   grid3_2: seg 20
grid0_3: seg 21   grid1_3: seg 22   grid2_3: toggle beat edit overlay
                                    grid3_3: select marker

LED: each segment cell shows that segment's ramp colour.
Empty stops render black. Marker cell (grid3_3) shows the marker
colour, or black when no marker is set. Beat-edit toggle LED is
cyan@60 when the overlay is on, white@20 when off.

+shift
grid0_0..grid1_3, grid0_3:  shift+press deletes that segment
grid3_3:                    shift+press clears the marker
                            (markerColor → null, markerWidth → 0)
grid2_3:                    no shift override


════════════════════════════════════════════════════════════
EDIT mode — BOTTOM
════════════════════════════════════════════════════════════

layer:   cycle to SLOTS                       LED: dim yellow
encL:    markerWidth (0..127)                 +shift: scroll registry
pressL:  fill gaps (interpolate blank stops    +shift: inherit
         between anchors)
encR:    — (unbound)                          +shift: —
pressR:  — (unbound)                          +shift: load preview into edit
                                                       (no-op if nothing previewed)

Grid cells follow the same segment map as EDIT GRID. grid2_3
and grid3_3 also stay bound here — the beat-edit toggle and the
marker select are accessible from either the grid rows or the
bottom row.


════════════════════════════════════════════════════════════
SLOTS mode
════════════════════════════════════════════════════════════

Entered from EDIT by pressing layer. Top section stays bound but
every edit func is a no-op (the edit gate returns null because
colorLab is no longer in the active stack). The preview LED and
preview sweep still work.

layer:   cycle back to EDIT                   LED: dim purple
encL:    — (unbound)                          +shift: scroll registry
pressL:  exit to EDIT, buffer unchanged       +shift: inherit
encR:    — (unbound)                          +shift: —
pressR:  arm save                             +shift: load preview
         LED: bright white when armed,               into edit, exit
              dim white otherwise                    to EDIT

Grid cells: 16 slots, row-major.

grid0_0 = slot 0    grid0_1 = slot 1    grid0_2 = slot 2    grid0_3 = slot 3
grid1_0 = slot 4    grid1_1 = slot 5    grid1_2 = slot 6    grid1_3 = slot 7
grid2_0 = slot 8    grid2_1 = slot 9    grid2_2 = slot 10   grid2_3 = slot 11
grid3_0 = slot 12   grid3_1 = slot 13   grid3_2 = slot 14   grid3_3 = slot 15

Grid press (unarmed) → preview that slot. Grid stays visible.
Grid press (armed)   → save current preview into that slot,
                       load it into edit, exit to EDIT.

Cell colours by slot index:
  0     green        (on)
  1     red          (off)
  2     white        (co)
  3     soft blue    (co-off)
  4..11 yellow       (saves)
  12    green        (source bake)
  13    blue         (structural bake)
  14    cyan         (sampled bake)
  15    magenta      (wire bake)

Empty cell:      dark
Populated:       dim (brightness 20)
Currently previewed slot: bright (brightness 127)


════════════════════════════════════════════════════════════
OVERLAYS
════════════════════════════════════════════════════════════

TUNING overlay (host: colorLabTop, toggle with shift+press3 in EDIT)

The overlay declares no unshifted bindings. Its only effect is
that, while shift is held, two shift-layer knobs are overridden:

+shift
enc1:  hkBoost (0..2, step 0.02)          ← replaces `brightness`
enc2:  lumGamma (0.1..2, step 0.02)       ← replaces `brightnessScale`

Toggle the overlay off to revert enc1/enc2 to their base shift
bindings.

BEAT EDIT overlay (host: colorLab, toggle with grid2_3 in EDIT)

encL:  beat.barBeats (1..32)                  +shift: inherit
encR:  beat.phraseBars (1..32)                +shift: beat.prePhraseBeats

grid0_0:  select target: beat       LED: target colour / dim
grid1_0:  select target: bar        LED: target colour / dim
grid2_0:  select target: prePhrase  LED: target colour / dim
grid3_0:  select target: phrase     LED: target colour / dim
grid0_1:  toggle beat.enabled       LED: green=on, red=off
grid1_1, grid2_1, grid3_1:  nulled
grid0_2, grid1_2, grid2_2, grid3_2:  nulled
grid0_3, grid1_3, grid3_3:  nulled

RGB encoders and faders edit the selected beat target's colour
and brightness while the overlay is active.

+shift
grid0_0..grid3_0:  shift+press clears that target's colour


════════════════════════════════════════════════════════════
CHORD
════════════════════════════════════════════════════════════

press3: hold 2 s → Mixxx shutdown

Releasing shift, layer, or press3 cancels the timer. Works in
both EDIT and SLOTS.
```

---

## Files

```
xone-k3-lib-core.js          bootstrap, tunables, PATCH_NAMES,
                             utilities, tokens, transfer curve,
                             sysex math, beat math, K2 palette,
                             HARDWARE_CALIB, VIRTUAL_CLOCKS,
                             BEATJUMP_GAP_MS
xone-k3-lib-schemes.js       palette, scheme engine, LED curves,
                             co-matching
xone-k3-lib-binding.js       Binding primitive, colour render
                             path, snapshot fields
xone-k3-lib-controller.js    K3Controller core: constructor,
                             patch resolution, focus, TOP_MODES,
                             chord, binding application,
                             render-time scheme resolution
xone-k3-lib-controller-colour.js  Colour-scheme parser: on:
                                  shapes, base scheme resolution,
                                  schemeFromState closures,
                                  _setupColorScheme
xone-k3-lib-controller-beat.js    Timeline, loop clock,
                                  display-source resolution, beat
                                  count, beat clock connections
xone-k3-lib-controller-render.js  LED writes, sysex queue,
                                  calibration, ramp sampling,
                                  beatjump gate
xone-k3-lib-controller-boot.js    Init / shutdown, MIDI wiring,
                                  boot, halt
xone-k3-lib-funcs.js         builders + XoneK3.FUNCS
xone-k3-lib-inspect.js       runtime state probes

xone-k3-cat-schemes.js       THEME, QFX_CHAIN_LIST,
                             PHRASE_MARKER_COLORS, SCHEMES,
                             scheme helpers
xone-k3-cat-fx.js            FX layout tables + emitters
xone-k3-cat-top.js           focus / twoDeck / mini base patches
xone-k3-cat-bottom.js        cue / loop / oddLoop layers
xone-k3-cat-overlays.js      selectAB / fxRouting / chord
xone-k3-cat.js               CAT_LAYERS assembler + bootCat()

xone-k3-kitten.js            boot override (2 lines)
xone-k3-onek3.js             boot override (2 lines)
xone-k3-onek3-minifx.js      boot override (2 lines)
xone-k3-lab.js               colorLab runtime
xone-k3-colorlab.js          colorLab layers + boot

xone-k3-cat.midi.xml
xone-k3-kitten.midi.xml
xone-k3-onek3.midi.xml
xone-k3-onek3-minifx.midi.xml
xone-k3-colorlab.midi.xml

calibration/                 optional, not loaded by default
```

---

## Things that surprise people

| | |
|---|---|
| A knob "does nothing" at first | Soft takeover. Turn it until it catches. |
| One LED stuck white | Its knob hasn't sent a MIDI value yet. Wiggle it. |
| Bottom grid doesn't follow your deck | Shift + slip (bottom grid `grid2_1`) flips which of A or B is the active deck. |
| Chord `pressR` doesn't respond | Shift then layer must be pressed together first. |
| Chord `pressL` does nothing in focus mode | `pressL` swaps twoDeck ↔ twoDeckMini. No-op from focus. |
| `grid2_0` flashes but nothing changes | No loop is running. The display toggle needs the loop clock. |
| Beatjump doesn't fire in a tight loop | Gated at 130 ms — `XoneK3.BEATJUMP_GAP_MS`. Wait a beat or jump outside the loop. Set `XoneK3._debugPrintsOn = true` for the `beatjump gated` line. |
| Beatjump immediately exits a short loop | Geometry — a 1-beat jump into a 1/16 beatloop lands past `loop_out`. The gate prevents rapid loop-edit spam, not a single jump. |
| Whole strip frozen | Script error. Check the Mixxx console, then restart Mixxx. |
| Console silent when you want to see edits | Edit prints are off by default. `XoneK3._debugPrintsOn = true`. |
| `inspect` doesn't exist | Run from the Mixxx console, on a live controller: `XoneK3.controllers[0].inspect()`. |

Everything else lives in `CONCEPTS.md` (how it works) and
`CUSTOMISE.md` (how to change it).