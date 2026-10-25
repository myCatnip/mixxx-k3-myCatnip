# Concepts

Read this before editing anything. Every other doc assumes you've
read it.

The goal: understand what a **binding**, **patch**, **token**,
**scheme**, and **timeline** are, how they nest, and why each
exists. By the end you should be able to look at any line in a
config file and know which layer of the system it belongs to.

Two layer trees ship — the playback tree (`CAT_LAYERS`, four
presets: Cat / Kitten / oneK3 / oneK3 miniFX) and the lab tree
(`colorLab`, one preset). Both are built from the same binding,
patch, and stack primitives. Everything below is about the
primitives. Where the two trees diverge is noted as it comes up,
but the framework is the same.

Terms are defined on first use. `GLOSSARY.md` has the one-line
versions.

---

## 1. Why this exists

A stock Mixxx mapping assigns one physical control to one Mixxx
control. That's fine for a 2-deck, always-visible, one-layout
controller.

The K3 has more controls than most people need at once. So this
mapping treats the surface as something that *reconfigures itself*
based on what you're doing. Some controls always do the same
thing. Others change meaning depending on:

- which deck is focused (A or B),
- which FX unit is focused (1..4),
- which layer the bottom grid is on (cue, loop, oddLoop),
- whether shift is held,
- whether a chord, overlay, or a top-half mode swap is active.

Everything in this doc is about how that reconfiguration works.
The mechanism has three layers: **bindings**, **patches**, and the
**stack**. Everything else (tokens, schemes, timelines, modes) is
built on those three.

---

## 2. A binding

A **binding** describes one physical control — one knob, button,
fader, or encoder.

```js
button0_0: {
    group: '$DECK_ACTIVE$',       // Mixxx group
    inKey: 'pfl',                 // input control
    outKey: 'pfl',                // output control for LED on/off
    colorScheme: {                // LED appearance
        knob: 'knob0_0',          // sample a ramp at this knob's position
        scheme: 'myCatnip'
    }
}
```

A binding can hold four kinds of information:

| Field | Purpose |
|---|---|
| `group` + `inKey` | What Mixxx control it writes to. |
| `outKey` | What Mixxx control its LED reads for on/off state. |
| `colorScheme` | What the LED looks like. |
| `func` + `args` | Optional custom behaviour, replacing the default write. |

Any of these can be omitted. A binding with `group` + `inKey` does
the default thing. A binding with `colorScheme` only is an LED-only
indicator (no input). A binding with `func` only is a script action.

That's the atom. Everything else is grouping.

---

## 3. A patch

A **patch** is a named bag of bindings.

```js
var CUE = {
    layer: { ... },
    grid0_0: { ... },
    grid0_1: { ... },
    // ...
};
```

Patches exist because 90 controls × 6 modes is a lot to write by
hand. You want to describe "what the surface looks like when the
cue layer is active" as one unit, not 90 individual assignments.

Patches can inherit:

```js
var ODD = {
    patch: ['loop'],       // inherit everything from LOOP
    grid0_2: { ... },      // override specific cells
    grid1_2: { ... }
};
```

ODD gets everything in LOOP plus its own overrides. That's how the
oddLoop layer stays small — it only declares the cells that
differ.

**Sibling patches do not inherit.** CUE and LOOP are siblings —
neither is a parent of the other. A cell defined in CUE is *not*
visible when only LOOP is in the stack. If a cell must work in
both, both must declare it. This is the #1 source of "why did my
button stop working when I changed layers?".

---

## 4. The stack

The controller holds an ordered list of patch names, called
`activePatches`. At any moment, that list is flattened into one
binding map. Later patches override earlier ones, cell by cell.

```
   activePatches:  [topShared] [fxLayout1] [cue]
                         │          │          │
                         └──────────┴──────────┘
                                    │
                       shift companions appended (if shift held)
                                    │
                            chord appended (last)
                                    │
                                    ▼
                            merged binding map
                                    │
                                    ▼
                       every binding rebound + LED repainted
```

That's the entire runtime. Every mode, every overlay, every shift
behaviour is just a different combination of patches.

The stack is rebuilt on every config change (patch added or
removed, shift pressed or released, focus moved). It is *not*
rebuilt on physical input — a button press only fires the binding's
own handler and repaints the LEDs that observe it.

**Chord sits on top of everything, including shift.** That's
deliberate — the chord's overlay toggles would otherwise be
shadowed by the top layer's shift overrides.

---

## 5. Shift and overlay patches

Two kinds of patch layer on top of the base stack.

**Shift companions.** A patch can declare a companion patch that
applies while shift is held:

```js
CUE._shift = 'cueShift';

var CUE_SHIFT = {
    grid0_0: { ... },     // override this cell while shifted
    grid1_0: { ... }      // and this one
};
```

Cells that CUE_SHIFT doesn't declare fall through to CUE. Shift
companions inherit up the parent chain — ODD_SHIFT collects
LOOP_SHIFT before its own overrides, because ODD inherits LOOP.

**Overlays.** A patch can declare a host list. It only applies
while one of its hosts is active:

```js
var SELECT_AB = {
    _host: ['twoDeck', 'twoDeckMini', 'topShared'],
    layer: { func: F.layerExitOverlay, args: ['selectAB'] },
    grid0_0: { ... },
    // ...
};
```

An overlay can *null* a cell from the layer below with `{}`. When
the overlay exits, the original comes back.

Overlays are typically toggled from the chord, and mutually
exclusive pairs pass a sibling list so toggling one clears the
other.

---

## 6. Tokens — routing by name

A binding that needs to follow *whatever deck is focused* writes a
**token** in its group:

```js
group: '$DECK_ACTIVE$'      // → [Channel1] or [Channel2] etc.
```

Tokens resolve at bind time. When focus changes, the runtime
re-applies every binding whose group referenced the changed token —
no manual rebind.

| Token family | Reads |
|---|---|
| `$DECK_A$` / `$DECK_B$` / `$DECK_C$` / `$DECK_D$` | A specific deck slot |
| `$DECK_ACTIVE$` | Whichever slot is currently focused |
| `$DECK_ALT$` | The other one |
| `$FX_A$` … `$FX_D$` | Specific FX slots |
| `$FX_ACTIVE$` / `$FX_ALT$` | Focus / other |
| `$FX_A_N$` etc. | Bare number instead of full group |

You rarely write these by hand — the builders use them. But you'll
see them in any binding that needs to follow focus.

---

## 7. Focus and modes

**Focus** has two independent axes: which deck slot is active (A
or B), and which FX slot is active (A or B). Each slot holds an
assignment (channel 1..4 or unit 1..4). Focus selects *which*
assignment is live; the assignment selects *what* channel or unit
it points at.

```
   Slot state:                  Derived:
     activeDeck : 'A' | 'B'       selectedDeckCurrent
     activeFx   : 'A' | 'B'       selectedDeckAlt
                                  selectedFxCurrent
     selectedDeckA : 1..4         selectedFxAlt
     selectedDeckB : 1..4
     selectedFxA   : 1..4
     selectedFxB   : 1..4
```

When focus moves, every binding whose group uses the corresponding
token is re-applied automatically.

**Top-half modes** are three complete layouts for the top half of
the controller. Only the top half swaps; the bottom half, chord,
and overlays are identical in all three.

| Mode | Base patch | Layouts | Shape |
|---|---|---|---|
| focus | `topShared` | `fxLayout1..4` | One deck, one FX. |
| twoDeck | `twoDeck` | `fxLayoutA<n>`, `fxLayoutB<n>` | Two pinned decks, two pinned FX columns. |
| twoDeckMini | `twoDeckMini` | `fxMini1..4` | Two pinned decks, one focused FX spanning the middle. |

Mode is inferred from `activePatches` — the mode whose base patch
is present wins. Swapping modes is one `setTopMode()` call, one
recompute, one repaint.

---

## 8. Colour schemes

An LED's appearance is controlled by a **scheme** — a named ramp or
a single colour.

Two render paths, and mixing them up is the #1 LED bug.

**Static** — no `knob:` reference. On or off. Picks the first stop
of the ramp.

```js
colorScheme: { scheme: 'green' }        // static LED
```

**Deviation** — has a `knob:` reference. Samples the ramp at the
knob's physical position.

```js
colorScheme: {
    knob: 'knob0_0',
    scheme: 'myCatnip'                   // ramp
}
```

A ramp fed to a static LED shows `ramp[0]`. For a multi-stop ramp
like `catFX`, that's often blue. If a group-enable button is
mysteriously blue, this is why. Pass a single colour instead.

A ramp can carry:

- **Stops** — colour + optional per-stop weight.
- **Curve** — warps the boundaries between stops.
- **Marker** — a colour band shown when a deviation LED samples
  within a target range.
- **Beat** — a colour cascade that fires per beat.
- **Co-match** — a gradient shown when the physical knob
  disagrees with the control it's bound to. Named after the state
  being detected (match); the gradient is the feedback that steers
  you there. The match band (`CO_MATCH_EPSILON = 1/127`) is
  narrower than the soft-takeover bridge band
  (`TAKEOVER_EPSILON = 2/127`), so a matched LED state always
  implies active control. See INTERNALS §25 for the mechanism.

Scheme swapping can be declarative (`schemeFromState`) or
conditional (`on:`). The `on:` block decides when the LED is
logically on, independent of the scheme itself.

Details and every field: CUSTOMISE → Reference → Scheme fields.

---

## 9. Timelines

Every channel tracks two timelines. They describe *where the
phrase colouring reads from*; they don't move the playhead.

```
                     ┌──────────────────────────────────┐
                     │  TRACK   playposition            │
                     │  beat 0 = file start             │
                     │  origin sets where "count 1" is  │
                     └──────────────────────────────────┘
                                    │
                                    │  (loop engages)
                                    ▼
                     ┌──────────────────────────────────┐
                     │  LOOP CLOCK                      │
                     │  accumulates playhead movement   │
                     │  through wraps                   │
                     └──────────────────────────────────┘
                                    │
                                    ▼
                        ┌──────────────────────┐
                        │  displaySource      │
                        │  'track' | 'loop'   │
                        └──────────────────────┘
                                    │
                                    ▼
                          count = abs - origin + 1
```

**Track** is the default. Beat 0 is file start. Origin sets
where "count 1" sits.

**Loop clock** starts itself when a loop is enabled, seeded from
wherever the playhead is. From there it *accumulates* musical
progress — every tick, its stored position advances by the same
amount the playhead would have moved if the loop played through
in sequence. A 4-beat loop that plays 4 iterations shows the
phrase cascade progressing *through* the loop iterations, not
repeating the loop's own 4 beats. Purpose: sync a transition out
of a loop at a phrase boundary that only exists on the timeline,
not on the playhead.

**Which timeline feeds the count** is `displaySource`. It is
`loop` while the loop clock is running, `track` otherwise. There
is no priority tunable and no third reading — the loop clock is
the only virtual timeline. Manual cycle via the LOOP layer's `grid2_0`
toggles between track and loop while the clock is running. The
manual choice sticks until the next start / stop event re-resolves it.

**Both timelines are rate-scaled.** Two synced decks at the same
tempo advance their cascade counts in phase, in any mix of track
and loop displays. That's what accumulation buys you: the count
follows the audio, not a wall-clock timer, so nothing drifts.

**Origin** is the beat number where "count 1" sits. Shared by
both readings — shifting it shifts both. Writer:
`_deriveOriginFromPosition`, run on every throttled
playposition tick, once on `track_loaded`, and immediately
whenever a hotcue is placed, recoloured, deleted, or dragged.
Marker hotcues (colour in `PHRASE_MARKER_COLORS`) define
phrase-start positions; the origin at any playhead position is
the beat of the last such marker at or before it, extended
backwards from the first marker ahead when none precede.
Frozen during an active loop.

**The pulse is not the count.** The LED's bright/dim half comes
from the track position's fractional beat in both modes. The
cascade count is what differs. This is why looping one deck
doesn't visibly desync it from the other.

**Paused decks.** `hasBeat` means "position is meaningful", not
"deck is playing". A paused deck that's been jogged once still
shows the cascade for the parked playhead. Scrub updates it at
the 30 ms position throttle. The pulse only fires on
`beat_active` edges, so a paused LED is static, not pulsing.

Details: CUSTOMISE → Reference → Timelines. Reference doc:
`timelines.md`.

---

## 10. Beat cascade

A scheme can carry a `beat:` block. That block fires a colour
cascade on every beat, using the count from whichever timeline is
displaying.

```js
XoneK3.SCHEMES.myAlert = {
    colors: [[127, 0, 0]],
    beat: {
        color: 'red, 60',           // every beat
        bar:       { color: 'green, 60' },
        phrase:    { color: 'white, 127' },
        prePhrase: { color: 'amber, 100' },
        barBeats: 4,
        phraseBars: 4,
        prePhraseBeats: 4
    }
};
```

The cascade resolves most-specific-first: `prePhrase > phrase >
bar > beat`. It's driven by `beat_active` edges in track mode, and
by the fractional phase on `playposition` in the loop reading.

You can't override the "off" colour of a beat pulse. Markers DO
get beat accents — marker colour is the base, cascade overrides
at cascade levels. See CUSTOMISE → What is and isn't possible.

---

## 11. Beatjump gate

One rule. Beatjumps are gated; nothing else is.

**The gate.** A beatjump — either `beatjumpButton` or
`encBeatjump` — is blocked when its target channel has an active
loop *and* less than `XoneK3.BEATJUMP_GAP_MS` has elapsed since
the last loop-touching event on that channel.

`BEATJUMP_GAP_MS = 130` in `lib-core.js`. One global value.

**What counts as a loop-touching event.** Anything that moves a
loop boundary, engages or disengages a loop, or changes the loop
size:

- `encLoopMove` / `encLoopMoveAccel` (boundary nudges)
- `pressSetValue` on `beatloop_size`
- `beatloopActivateResetAnchor`
- `reloopToggleResetAnchor`
- a beatjump that passed the gate, while the loop was on

**Why one value, not a class system.** The previous
implementation had four rate classes (`jump`, `edit`, `claim`,
`free`) with per-binding overrides and an escape detector. It
was complex enough to hide the actual constraint: *a beatjump
must not fire 60 ms after a loop edit, because Mixxx hasn't
settled the loop yet*. One gate on the beatjump itself, tuning
one value, is the whole rule.

**What it doesn't do.** The gate doesn't prevent a *single*
beatjump from exiting a short loop. A 1-beat jump into a
1/16-beat loop lands past `loop_out` and Mixxx deactivates the
loop. That's geometry, not a rate problem. If you don't want
the loop to exit, don't jump while it's playing.

**Outside a loop, everything fires freely.** The gate only
checks when `loop_enabled > 0` on the target channel. No stamp
is written when the loop is off, so a beatjump after a preset
reload or track load starts with a clean timestamp.

Details: INTERNALS §13 (Input mods) carries the mechanics, §25
non-obvious has the design bullets.

---

## 12. Bottom half

The bottom half is a three-layer grid: **cue**, **loop**,
**oddLoop**. The layer button cycles them.

| Layer | Grid cells |
|---|---|
| cue | Transport + hotcues |
| loop | Even loop sizes |
| oddLoop | Odd loop sizes. Inherits from loop. |

The layer button and every grid cell follow `activeDeck` — shift +
slip (bottom grid `grid2_1`) flips which of A or B is the active
deck.

The **chord** (shift + layer, held) reaches the overlays and mode
swaps. Release shift or layer to exit.

Details: CONTROLS → Bottom half.

---

## 13. colorLab

A separate preset built on the same runtime (`LabController`
extends `K3Controller`) with its own layer tree. No playback, no
top-half modes, no bottom grid, no chord. It reads the same
palette and scheme registry as Cat, so ramps built in the lab
paste straight into `xone-k3-cat-schemes.js`.

```
   Load colorLab in Preferences → Controllers.
   Turn knobs. Press segment LEDs. Shift + press0 to dump.
   Copy the printed block into xone-k3-cat-schemes.js.
   Reload Cat.
```

Full guide: LAB.md.

---

## Where to go next

- **README.md** — physical layout, per-mode behaviour, and the
  per-unit FX cell tables.
- **CUSTOMISE.md** — how to change any of it. Recipes first,
  reference second.
- **INTERNALS.md** — runtime pipeline, caches, beat maths, and
  the debugging probes. Developer doc.
- **GLOSSARY.md** — one-line definitions for every term used in
  these docs.