# Controls

Every shipped preset's behaviour, control by control.

**One runtime, two layer trees, five presets.**

Four presets — Cat, Kitten, oneK3, oneK3 miniFX — load the same
layer tree (`XoneK3.CAT_LAYERS`). Their bottom half, chord, and
overlays are identical. Only their boot config differs: MIDI
channel, which slot is active by default, and which top-half
mode they start in. Everything else is shared.

The fifth preset, colorLab, is a different layer tree on the same
runtime. No top-half modes, no playback bindings, no bottom grid.
Read `LAB.md`.

| Preset | Channel | Boot mode | What's different |
|---|---|---|---|
| Cat | 0x0E | focus | — |
| Kitten | 0x0D | focus, side B | Deck and FX focus boot to B. |
| oneK3 | 0x0E | twoDeck | Boots two-column. |
| oneK3 miniFX | 0x0E | twoDeckMini | Boots single-FX-middle. |
| colorLab | 0x0D | n/a | Editor only. See LAB.md. |

This doc describes the shared parts once (bottom half, chord,
routing overlays), the top half three times (focus / twoDeck /
mini), and the preset deltas at the end. colorLab is out of
scope — read `LAB.md`.

## Naming: slots, not raw numbers

The top half has two **axes**, each with two **slots**:

- **Deck axis:** deck slot A and deck slot B. Each slot is
  assigned a channel (1–4). `activeDeck` picks which slot the
  top half points at — `'A'` or `'B'`, never a raw channel
  number.
- **FX axis:** FX slot A and FX slot B. Each slot is assigned a
  unit (1–4). `activeFx` picks which slot the top half points at
  — `'A'` or `'B'`, never a raw unit number.

When a doc says "the active deck", it means "whichever channel
is currently in the active deck slot". Same for FX.

**Pinning** a channel or unit to a slot is done in the `selectAB`
overlay. **Focusing** — picking which slot is active — is done
from the press row in focus mode and twoDeck, or is implicit in
mini where both slots are always visible.

---

# 1. Shared — bottom half

Same in every playback preset. Follows `activeDeck` — shift +
slip (bottom grid `grid2_1`) flips which of A or B is the active
deck.

## Layer button

`layer` cycles the grid between three layers:
cue → loop → oddLoop.

| Layer | Grid |
|---|---|
| cue | Transport + hotcues |
| loop | Even loop sizes |
| oddLoop | Odd loop sizes |

The layer button's LED carries **deck A's track-end
countdown**, not a layer indicator. The same countdown runs on
the shift button, driven by deck B. Colour phases as track end
approaches — counted in bars remaining: green >64, yellow 33–64,
amber 17–32, red ≤16. Off when the deck isn't playing.

Shift + layer enters the chord.

## Cue layer

**Row 0**

| Cell | Press → | LED |
|---|---|---|
| `grid0_0` | Jump 1 beat back | Deviation ramp on `fader0` |
| `grid1_0` | Jump 1 beat forward | Deviation ramp on `fader1` |
| `grid2_0` | **Display toggle** — track ↔ loop (no-op when no loop) | Deviation ramp on `fader2`; bright when showing track |
| `grid3_0` | Deck cue | Deviation ramp on `fader3`; tracks `cue_indicator` |

**Row 1**

| Cell | Press → | LED |
|---|---|---|
| `grid0_1` | Jump 16 beats back | purple (RGB `[69, 0, 127]`) |
| `grid1_1` | Jump 16 beats forward | purple |
| `grid2_1` | Slip toggle | active-deck colour — the theme colour of whichever channel is in the active deck slot |
| `grid3_1` | Play toggle | colour = display source (green track / yellow loop); on/off follows `play_indicator` |

**Rows 2–3 — hotcues**

| Cell | Press → | LED |
|---|---|---|
| `grid0_2`..`grid3_2` | Hotcues 1–4 | per-hotcue colour (Mixxx) |
| `grid0_3`..`grid3_3` | Hotcues 5–8 | per-hotcue colour (Mixxx) |

Hotcue presses set the phrase origin if the hotcue's stored colour
is in `PHRASE_MARKER_COLORS` (empty by default — feature off).

**Encoders and presses**

| | |
|---|---|
| `encoderL` | BPM, fine step. Hold `pressL` while turning → head mix |
| `pressL` | Hold: while down, `encoderL` writes `[Master],headMix` instead of `[InternalClock],bpm`. On its own the press does nothing. Shift + `pressL` (no turn) → head-split toggle |
| `encoderR` | Playlist: next / previous track |
| `pressR` | Load the selected track |

**Shifted**

| | |
|---|---|
| `encoderL` | master gain |
| `encoderR` | headphone volume |
| `grid0_0` | no shift override — base `beatjump_1_backward` fires |
| `grid1_0` | no shift override — base `beatjump_1_forward` fires |
| `grid2_0` | LED-only — dim deviation ramp on `fader2`, no input |
| `grid2_1` | **flips which of A or B is the active deck** |
| `grid3_0` | **Clear the main cue point** (`cue_clear`) — deviation ramp on `fader3`, tracks `cue_indicator` |
| `grid3_1` | LED-only — same play / display-source colour, no input |
| `grid0_2`..`grid3_3` | clear hotcue 1..8 |

## Loop layer

**Row 0**

| Cell | Press → | LED |
|---|---|---|
| `grid0_0` | Jump 1 beat back | Deviation ramp on `fader0` |
| `grid1_0` | Jump 1 beat forward | Deviation ramp on `fader1` |
| `grid2_0` | **Display toggle** — track ↔ loop (no-op when no loop) | Deviation ramp on `fader2`; bright when showing track |
| `grid3_0` | *(no input)* | Deviation ramp on `fader3`; always lit |

**Row 1**

| Cell | Press → | LED |
|---|---|---|
| `grid0_1` | Jump backward | magenta |
| `grid1_1` | Jump forward | magenta |
| `grid2_1` | Slip toggle | active-deck colour |
| `grid3_1` | Play toggle | colour = display source (green track / yellow loop) |

**Rows 2–3 — loop size**

| Cell | Size | LED |
|---|---|---|
| `grid0_2` | 8 | green |
| `grid1_2` | 4 | green |
| `grid2_2` | 2 | green |
| `grid3_2` | 1 | teal2 |
| `grid0_3` | 1/16 | green |
| `grid1_3` | 1/8 | green |
| `grid2_3` | 1/4 | green |
| `grid3_3` | 1/2 | teal2 |

**Encoders and presses**

| | |
|---|---|
| `encoderL` | Move loop in-point. Accelerates with turn speed |
| `pressL` | Reloop toggle (anchor reset to 0) |
| `encoderR` | Move loop out-point. Same acceleration |
| `pressR` | Beatloop activate (anchor reset to 0) |

`grid3_0` is LED-only. Reloop and beatloop activate live on
`pressL` / `pressR` exclusively.

**Shifted**

| | |
|---|---|
| `encoderL` | beatjump back / forward |
| `pressL` | beatloop activate |
| `encoderR` | halve / double `beatjump_size` |
| `pressR` | reloop toggle |
| `grid0_0` | no shift override — base `beatjump_1_backward` fires |
| `grid1_0` | no shift override — base `beatjump_1_forward` fires |
| `grid2_0` | LED-only — dim deviation ramp on `fader2`, no input |
| `grid2_1` | **flips which of A or B is the active deck** |
| `grid3_1` | LED-only — play / display-source colour, no input |
| `grid0_2`..`grid3_3` | beatjump sizes (same cell map as loop sizes) |

## Odd loop layer

Same layout as loop. Colours are cyan / sky instead of green /
teal. Encoders and presses inherit from LOOP — including the
accelerated loop-point nudges.

| Cell | Size |
|---|---|
| `grid0_2` | 7 |
| `grid1_2` | 5 |
| `grid2_2` | 3 |
| `grid3_2` | 1 |
| `grid0_3` | 3/32 |
| `grid1_3` | 3/16 |
| `grid2_3` | 3/8 |
| `grid3_3` | 1/2 |

Shifted: sizes become beatjump sizes. `grid2_0` is LED-only (dim
deviation ramp on `fader2`, no input). `grid2_1` flips which of A
or B is the active deck. `grid3_1` is LED-only. `grid0_0` /
`grid1_0` have no shift override — the oddLoop `beatjump1`
bindings fire (inherited from LOOP via the parent chain).

## Display toggle

Bound to `grid2_0` on both CUE and LOOP. Toggles the active deck's
reading between **track** and the **loop clock**. No-op while the
loop clock isn't running — track is the only reading then. The
manual choice sticks until the next loop start / stop event
re-resolves it.

The play button's LED colour tells you which reading is active:
**green** for track, **yellow** for loop.

---

# 2. Shared — chord

Hold **shift**, press **layer**, keep holding shift. The chord
engages.

```
   shift down       ┌─ hold ─┐
        │           │        │
        ▼           │        │
   layer down ──────┤  chord ├────► chord patch appended last
        │           │        │
        │           └─ hold ─┘
        │
        └──── any release (shift or layer) exits chord
```

| Control | Action |
|---|---|
| `press0` | Toggle `fxRouting` overlay |
| `press1` | Toggle `selectAB` overlay |
| `press3` | Hold 2 s → Mixxx shuts down |
| `pressR` | Swap focus ↔ twoDeck family |
| `pressL` | Swap twoDeck ↔ twoDeckMini |

`press0` and `press1` are mutually exclusive — toggling one clears
the other.

Release shift, layer, or `press3` at any point to exit. The
shutdown timer dies with the chord; re-enter and hold again from
zero.

---

# 3. Shared — routing overlays

Two routing overlays. Both enter from the chord. Both layer on top
of whichever mode is currently active — their `_host` list includes
all three top-half base patches, so they're reachable from any
mode.

## `selectAB` — routing grid

```
           col 0      col 1      col 2      col 3
row 0      deck A 1   deck A 2   deck A 3   deck A 4
row 1      deck B 1   deck B 2   deck B 3   deck B 4
row 2      FX A 1     FX A 2     FX A 3     FX A 4
row 3      FX B 1     FX B 2     FX B 3     FX B 4
```

Press a cell to **pin** that channel or unit to that slot. The lit
cell per row is the current slot assignment. Pinning is separate
from focusing — pressing a cell assigns the channel/unit to the
slot, but does not make that slot active.

Hold `pressR` and tap a deck column to load onto that channel.
`layer` exits.

## `fxRouting` — FX unit group enables

```
           col 0      col 1      col 2      col 3
row 0      FX1→ch1    FX1→ch2    FX1→ch3    FX1→ch4
row 1      FX2→ch1    FX2→ch2    FX2→ch3    FX2→ch4
row 2      FX3→ch1    FX3→ch2    FX3→ch3    FX3→ch4
row 3      FX4→ch1    FX4→ch2    FX4→ch3    FX4→ch4
```

Press a cell to toggle that group enable. `layer` exits.

---

# 4. Top half — three modes

Only the top half swaps between modes. Every control below exists
in every mode; only what it points at changes.

## Common shape

```
    encoder0   encoder1   encoder2   encoder3
    press0     press1     press2     press3

    knob0_0    knob1_0    knob2_0    knob3_0
    button0_0  button1_0  button2_0  button3_0
    knob0_1    knob1_1    knob2_1    knob3_1
    button0_1  button1_1  button2_1  button3_1
    knob0_2    knob1_2    knob2_2    knob3_2
    button0_2  button1_2  button2_2  button3_2

    fader0     fader1     fader2     fader3
```

- **Focus mode** — one deck, one FX. The top-half cells follow
  the active deck slot and the active FX slot. The press row
  flips which of A or B is active on each axis.
- **twoDeck mode** — two decks (slots A / B), two FX columns
  (slots A / B), both pinned. Column 1 (`*1_*`) is FX slot A.
  Column 2 (`*2_*`) is FX slot B. Both always live.
- **twoDeckMini mode** — two decks pinned as in twoDeck, but the
  middle eight cells become **one** focused FX unit instead of two
  columns. Same physical cells, different content.

**QFX lives in the top-half base patch, not an overlay.**
`knob1_2` is the Quick Effect rack super knob, `button1_2` is the
rack enable. Plain bindings in `TOP_SHARED` (and inherited by
`TWO_DECK` / `TWO_DECK_MINI`). The button LED tracks the loaded
Quick Effect chain via `loaded_chain_preset`. In twoDeck / mini,
`knob2_2` / `button2_2` are QFX for the second pinned deck.

**Routing is by token, not by fixed cell.** Deck cells use
`$DECK_ACTIVE$` / `$DECK_ALT$`. FX cells use `$FX_ACTIVE_N$` for
the focused unit and `$FX_ALT_N$` for the alt route. The
`fxLayout<n>` patches hardcode their own unit number — the patch
swap managed by `_syncFxLayout` keeps the focused one in the
stack. See §7.

## Focus mode

### Encoders

| | Turn |
|---|---|
| `encoder0` | Active deck pre-gain |
| `encoder1` | Cycle the active deck's QuickFX chain preset |
| `encoder2` | unbound |
| `encoder3` | unbound |

**Shifted**

| | Turn |
|---|---|
| `encoder0` | Sync the active deck's key — any direction |
| `encoder1` | Reset the active deck's key — any direction |
| `encoder2` | unbound |
| `encoder3` | unbound |

### Press row

| | Press | Shift + press |
|---|---|---|
| `press0` | Set **active deck** to slot A | Sync enable — deck A |
| `press1` | Set **active deck** to slot B | Keylock — deck A |
| `press2` | Set **active FX** to slot A | Keylock — deck B |
| `press3` | Set **active FX** to slot B | Sync enable — deck B |

The unshifted row is focus. `activeDeck` and `activeFx` are
`'A'` or `'B'`, not a raw channel or unit number. Each button's
LED is the theme colour of whichever channel (`press0` / `press1`)
or unit (`press2` / `press3`) is currently pinned to that slot,
**bright when that slot is the active one and dim when it isn't**.
So the row reads as two 2-cell indicators: left pair shows which
deck slot is active, right pair shows which FX slot is active.

Pinning a specific channel (1–4) or unit (1–4) to a slot is done
in the `selectAB` overlay (chord + `press1`), not from the press
row.

The shift row is per-deck: sync / keylock for deck A on
`press0` / `press1`, keylock / sync for deck B on `press2` /
`press3`.

### Knob / button grid

```
              col 0         col 1        col 2        col 3
row 0  knob   EQ high       fxLayout     fxLayout     fxLayout
       btn    PFL           fxLayout     fxLayout     fxLayout

row 1  knob   EQ mid        fxLayout     fxLayout     fxLayout
       btn    FX hp         fxLayout     fxLayout     fxLayout

row 2  knob   EQ low        QFX super    fxLayout     fxLayout
       btn    alt FX route  QFX enable   fxLayout     fxLayout
```

- **PFL** (`button0_0`) — headphone cue for the active deck.
- **FX hp** (`button0_1`) — FX unit group headphone enable for the
  active FX.
- **alt FX route** (`button0_2`) — routes whichever FX slot A/B is
  *not* focused into the active deck.
- **QFX super** (`knob1_2`) — Quick Effect rack super knob for the
  active deck.
- **QFX enable** (`button1_2`) — toggles the Quick Effect rack.
  LED tracks the loaded chain via `loaded_chain_preset`.
- **fxLayout cells** — 16 cells (rows 0–1 cols 1–3, plus row 2
  cols 2–3). Content is per-unit; see §7.

### Faders

| | |
|---|---|
| `fader0` | Active deck volume |
| `fader1` | Active FX mix |
| `fader2` | unbound |
| `fader3` | unbound |

## twoDeck mode

### Encoders

| | Turn |
|---|---|
| `encoder0` | Deck A pre-gain |
| `encoder1` | Cycle deck A's QuickFX chain preset |
| `encoder2` | Cycle deck B's QuickFX chain preset |
| `encoder3` | Deck B pre-gain |

**Shifted**

| | Turn |
|---|---|
| `encoder0` | Sync deck A key — any direction |
| `encoder1` | Reset deck A key — any direction |
| `encoder2` | Reset deck B key — any direction |
| `encoder3` | Sync deck B key — any direction |

### Press row

| | Press | Shift + press |
|---|---|---|
| `press0` | Set active deck to slot A | Sync enable — deck A |
| `press1` | FX A group enable into deck A | Keylock — deck A |
| `press2` | FX B group enable into deck B | Keylock — deck B |
| `press3` | Set active deck to slot B | Sync enable — deck B |

`press0` / `press3` set `activeDeck` — same behaviour as focus
mode's press row. Their LEDs show the theme colour of whichever
channel is pinned to that slot, bright when that slot is active
and dim when it isn't. The two cells together read as "which
deck is active".

Hold `pressR` (cue layer) and tap `press0` / `press3` to load
the selected track onto that slot's **currently pinned** channel.

Pinning a channel into a slot is done in the `selectAB` overlay
(chord + `press1`), not from the press row.

### Knob / button grid

```
              col 0        col 1        col 2        col 3
row 0  knob   EQ A high    fxLayoutA    fxLayoutB    EQ B high
       btn    PFL A        fxLayoutA    fxLayoutB    PFL B

row 1  knob   EQ A mid     fxLayoutA    fxLayoutB    EQ B mid
       btn    FX A hp      fxLayoutA    fxLayoutB    FX B hp

row 2  knob   EQ A low     QFX A super  QFX B super  EQ B low
       btn    FX B→A       QFX A enable QFX B enable FX A→B
```

- **`button0_2`** / **`button3_2`** — cross-routes. `button0_2`
  routes FX B into deck A; `button3_2` routes FX A into deck B.
  LED colour follows the routed unit's theme, tracking the low EQ
  knob underneath.
- **FX A hp** / **FX B hp** — headphone enables for the two FX
  units.
- **QFX A super / B super** (`knob1_2` / `knob2_2`) — Quick Effect
  rack super knobs for the two pinned decks.
- **QFX A en / B en** (`button1_2` / `button2_2`) — rack enables.
  LEDs track each deck's loaded chain.

Column 1 rows 0–1 is `fxLayoutA<n>`, driven by `selectedFxA`.
Column 2 rows 0–1 is `fxLayoutB<n>`, driven by `selectedFxB`. See
§7.

### Faders

| | |
|---|---|
| `fader0` | Deck A volume |
| `fader1` | FX A mix |
| `fader2` | FX B mix |
| `fader3` | Deck B volume |

## twoDeckMini mode

Same as twoDeck except the middle eight cells become one focused
FX unit instead of two columns.

Deck focus behaviour, EQ columns, QFX, faders, bottom half:
identical to twoDeck.

### Encoders

Same as twoDeck — both unshifted and shifted.

### Press row

| | Press | Shift + press |
|---|---|---|
| `press0` | Set active deck to slot A | Sync enable — active deck |
| `press1` | **Focused FX** group enable into deck A | Keylock — active deck |
| `press2` | **Focused FX** group enable into deck B | Set active FX to A |
| `press3` | Set active deck to slot B | Set active FX to B |

`press1` and `press2` route the focused unit. Shift + `press2` /
`press3` set the focused unit the same way focus mode does.
Shift + `press0` / `press1` follow the **active** deck — same
physical key, different target from twoDeck's shift row.

`press0` / `press3` are inherited from twoDeck, including the
armed-load path: hold `pressR` (cue layer) and tap `press0` /
`press3` to load onto that slot's pinned channel.

### Knob / button grid

```
              col 0        col 1        col 2        col 3
row 0  knob   EQ A high    fxMini       fxMini       EQ B high
       btn    PFL A        fxMini       fxMini       PFL B

row 1  knob   EQ A mid     fxMini       fxMini       EQ B mid
       btn    FX A hp      fxMini       fxMini       FX B hp

row 2  knob   EQ A low     QFX A super  QFX B super  EQ B low
       btn    alt FX→A     QFX A enable QFX B enable alt FX→B
```

The middle eight cells (rows 0–1, columns 1–2) all point at the
focused FX unit. See §7. Row 2 columns 1–2 are the QFX module,
same as twoDeck.

- **`button0_2`** / **`button3_2`** — cross-routes. The unit that
  *isn't* focused, into deck A and deck B respectively.
- **`press1`** / **`press2`** — focused unit into deck A / deck B.

### Faders

Same as twoDeck. `fader1` and `fader2` still mix the pinned A / B
units — the faders do not follow focus.

---

# 5. Switching modes

| Current mode | Chord + `pressR` | Chord + `pressL` |
|---|---|---|
| focus | → twoDeck | (no-op) |
| twoDeck | → focus | → twoDeckMini |
| twoDeckMini | → focus | → twoDeck |

`pressR` and `pressL` have no LEDs on the K3 — the bindings fire,
nothing lights.

Boot mode is `initialPatches` in the preset's boot config. See §6.

---

# 6. Preset deltas

All four playback presets load the same layer tree. Only the boot
config differs.

| Preset | `midiChannel` | `initialPatches` | `initialActiveDeck` / `Fx` |
|---|---|---|---|
| Cat | 0x0E | `['topShared','fxLayout1','cue']` | A / A |
| Kitten | 0x0D | (inherits Cat's) | B / B |
| oneK3 | 0x0E | `['twoDeck','fxLayoutA1','fxLayoutB1','cue']` | A / A |
| oneK3 miniFX | 0x0E | `['twoDeckMini','fxMini1','cue']` | A / A |

That's it. Same controls, same overlays, same chord, same bottom
half. You can swap a running Cat to twoDeck mode with chord +
`pressR` and it behaves exactly like a booted oneK3.

**Two presets on the same MIDI channel fight over outputs.** Cat,
oneK3, and oneK3 miniFX all ship on 0x0E. Change one before
running them together. Kitten and colorLab ship on 0x0D.

| Units | Load | Why |
|---|---|---|
| 1 | oneK3, or Cat in twoDeck | Both decks on one surface |
| 1 | oneK3 miniFX | Both decks, one FX unit with all eight middle cells |
| 2 | Cat + Kitten | One unit per side, re-pointable |
| 2 | oneK3 ×2 | Four decks / four FX, all visible |
| 3–4 | Cat + Kitten + … | Scale out |

---

# 7. FX cell layouts

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

Notation: `FX<n>.p<m>` means effect `n` parameter `m` on the
focused unit. `meta` means the effect's meta knob. `btn<k>` means
`button_parameter<k>`. The parenthesised value (`hi` / `mid` /
`lo`) is the marker band position on the LED's ramp.

`LED→knobN_M` cells are display-only — no press action, LED
echoes the knob above. In the table: `{ displayOnly: true }`,
optionally with `on: false` for a dim echo. Tracks the adjacent
knob automatically; `ledTracks: 'knobX'` only for a non-adjacent
target.

## Focus mode — `FX_LAYOUTS`

16 cells: rows 0–1 cols 1–3 (12 cells), plus row 2 cols 2–3 (4
cells). Row 2 col 1 is QFX and lives in `TOP_SHARED`. Col 0 is
the EQ/PFL column, also `TOP_SHARED`.

All cells point at the unit whose `fxLayout<n>` is in the active
stack — the patch hardcodes its own unit number, and
`_syncFxLayout` keeps the focused one in the stack.

Unit 1 is the base table, units 2–4 add overrides. **Bold** =
differs from unit 1.

### Row 0

| Cell | Unit 1 | Unit 2 | Unit 3 | Unit 4 |
|---|---|---|---|---|
| `knob1_0` | FX2.p3 | **FX2.p1** | **FX2.p2** | **FX2.p1** |
| `knob2_0` | FX1.p2 | **FX1.p1** | FX1.p2 | **FX1.p1** |
| `knob3_0` | FX1.meta | **FX1.p2** | FX1.meta | **FX1.p3** |
| `button1_0` | LED→`knob1_0` | LED→`knob1_0` | LED→`knob1_0` (lo) | LED→`knob1_0` (110) |
| `button2_0` | LED→`knob2_0` | LED→`knob2_0` (hi) | LED→`knob2_0` | LED→`knob2_0` |
| `button3_0` | FX1.enable | FX1.enable (hi) | FX1.enable | FX1.enable |

### Row 1

| Cell | Unit 1 | Unit 2 | Unit 3 | Unit 4 |
|---|---|---|---|---|
| `knob1_1` | FX2.p1 | FX2.p1 | **FX2.p3** | **FX2.p2** |
| `knob2_1` | FX2.p2 | FX2.p2 | **FX2.p4** | **FX2.p3** |
| `knob3_1` | FX2.p4 | FX2.p4 | **FX2.p5** | **FX2.p5** |
| `button1_1` | FX2.btn1 | FX2.btn1 | FX2.btn1 (mid) | FX2.btn1 (110) |
| `button2_1` | FX2.btn2 | FX2.btn2 | LED→`knob2_1` (mid) | FX2.btn2 (110) |
| `button3_1` | FX2.enable (lo) | FX2.enable (lo) | FX2.enable (lo) | FX2.enable (mid) |

### Row 2 (cols 2–3)

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

## twoDeck — `TWO_DECK_FX_LAYOUTS`

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

## twoDeck mini — `TWO_DECK_MINI_FX_LAYOUTS`

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

## Editing a layout

Change the table entry in `xone-k3-cat-fx.js`. See CUSTOMISE → FX
cell mapping for the field vocabulary and worked examples.