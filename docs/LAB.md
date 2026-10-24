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
6. Copy the printed block into `xone-k3-cat-schemes.js`, inside
   the `Object.assign(XoneK3.SCHEMES, {...})` block.
7. Reload Cat.

**Preview is preview-only.** Nothing you do while a scheme is
being previewed touches the edit buffer. To edit what you're
looking at, press shift + `pressR` to load the preview into edit
first. To abandon a preview, press `layer` — the buffer is
unchanged.

## The model

Four state variables describe everything the lab does.

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
        (mode-dependent, see below)
```
## Mode and state

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
                       (edit mode:  labLoadPreview
                        slots mode: labEditThis)

   press slot,     →   save preview into that slot
   saveArmed true      load into edit
                       exit to edit mode
```

Every preview is preview-only. Edits attempted while previewing
(segment selection, RGB encoders, faders, toggles, beat overlay)
are no-ops — a warn-once fires the first time, then the console
stays quiet for that boot. The only paths from a preview into
the edit buffer are:

- **Shift + `pressR`** — load preview into edit. Edit mode:
  `labLoadPreview`. Slots mode: `labEditThis` (also exits slots).
- **Armed-slot save** — press `pressR` to arm, then a slot cell.
  Saves the preview into that slot, loads it into edit, exits to
  edit mode.

- **edit** — the working buffer. Starts as one black stop.
- **slot 0** — pre-populated at boot with `labDefault`, a single
  black stop. It's the "on" slot, waiting to be filled. The slot
  grid paints it green because `idx === S.ON` in
  `_renderSlotLEDs`. If slot 0 were ever empty, the LED would go
  dark like any other unpopulated slot — it's green because of
  its index, and because the boot seed keeps it non-empty.
- **slots[0..15]** — saved schemes. Slots 0/1/2/3 are
  on/off/co/co-off. Slots 4..11 are user saves. Slots 12..15
  are auto-bake outputs.
- **previewSource** — `'edit'`, a slot index, or a registry
  scheme name. What the preview LED and the slots grid point at.
- **previewing** — true when the strip is showing a previewed
  scheme instead of the edit buffer. Set by scrolling the
  registry or by pressing a slot cell.

**The invariant:** the edit buffer is only overwritten by
explicit user action. Preview never modifies it. Editing while
previewing does nothing until you load the preview.

## Modes

The layer button swaps between two modes. Nothing else changes
mode.

### EDIT

The bottom half edits the edit buffer. Segment selection, RGB
knobs, faders, marker, ratio, beat.

If a scheme has been previewed, the strip shows it, and the
edit controls are no-ops until you press shift + `pressR` to
load the preview into the buffer or `layer` to return to edit
unchanged.

### SLOTS

The bottom grid becomes 16 slot cells.

While in slots mode the top segment strip keeps painting the
preview scheme — the grid swap only affects the bottom cells.
The preview LED tracks `previewSource` either way.

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

Which cell shows which slot is defined by the bindings, not
hardcoded. Rebinding `labSlotPress, [5]` to a different cell
moves slot 5's LED there.

### Slots-mode buttons

| | |
|---|---|
| Grid press | Preview that slot. Grid stays visible. |
| `pressR` | Toggle arm. |
| Grid press, armed | Save preview into that slot. Loads it into edit and exits to edit mode. |
| `pressL` | Exit to edit. Edit unchanged. |
| Shift + `pressR` | Load preview into edit, exit to edit mode. |
| Shift + `encoderL` | Scroll registry schemes. Grid stays visible. |
| `layer` | Exit to edit. |

**Saving writes the current preview** into the target slot. If
preview is edit, that's the edit buffer. If preview is slot 5,
that's slot 5. Slots-to-slots copies are one gesture.

If the preview cannot resolve — a bad registry name, an
unpopulated slot, anything that makes `_previewScheme()` return
null — the arm is cleared and the press falls through to a
normal preview. The slot is not written.

Overwriting a populated slot dumps the old contents to the
console as a backup. Saving over the current preview skips the
backup — same content, nothing to preserve.

After a successful save you're in edit mode with the saved
content loaded.

## Preview sources

Three kinds:

- **edit** — the working buffer. Only source that permits edits.
- **a slot index** — set by pressing a slot cell.
- **a registry scheme name** — set by scrolling with
  shift + `encoderL`.

Auto-bake runs when the preview lands on `'edit'` or slots
0..11. Skipped for slots 12..15 (bake outputs) and for registry
schemes.

## Auto-bake

Whenever the preview changes to an editable source, four slots
are rewritten:

- **12 — source** — raw clone of the preview.
- **13 — structural** — ratio, curve, pole, position absorbed
  into the stops.
- **14 — sampled** — the above, plus interp sampled into 23 stops.
- **15 — wire** — the above, plus the calibration solve
  pre-computed into hw. Marks `calibration: false`.

There's no manual bake button. It just happens. Ignore it if
you don't need it.

## Editing

**Edits only take effect in edit mode.** If a preview is showing,
the first edit attempt is a no-op and prints a warn-once:

```
[k3] preview is preview-only — shift+pressR loads the preview
     into edit before edits take effect
```

Press shift + `pressR` to make the preview the edit buffer, or
`layer` to return to edit unchanged.

### Selecting a stop

Each segment LED is a stop. Press it to select.

In-range stops show their own ramp colour, whether selected or
not. A stop beyond the current ramp shows dim grey when selected
— a cue that editing it will bring it into existence. New stops
are `[0, 0, 0]`.

**Shift + press** a segment deletes it.

### Changing a stop

With a stop selected:

- **Stepped edit** — RGB encoders and the brightness encoder
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

**Marker fires before the ramp sample.** When the deviation
LED's knob sits inside `markerPosition ± markerWidth`,
`markerHit` returns true and the render path paints the marker
colour — the ramp sample never runs for that frame.

In the runtime, the marker colour then goes through the beat
cascade (same as a static LED) — phrase/bar/beat colours
override the marker colour at cascade levels, off-phase shows
the marker's off-brightness, half-beat skip holds the previous
frame. Co-match stays masked (`skipBeat=true`).

The lab preview LED shows the marker colour **raw** — no beat
applied. Deliberate: when editing a scheme, you want to see the
marker's actual colour while it's in the band, not a cascade-
coloured version. The preview and runtime differ only for
beat-carrying schemes with a marker.

### Fill gaps

Linearly interpolates every blank stop between two non-blank
anchors. Useful after placing a few key colours.

### Trailing zeros

Every edit that changes a stop triggers a trim of trailing
black stops. The **currently selected** stop is protected from
trimming. At least one stop always remains.

## Beat edit overlay

Press **grid2_3** in edit mode to toggle. The button's LED shows
the state: dim white when out, cyan when in.

The overlay repurposes the grid and the L/R encoders to edit a
scheme's `beat` config.

**The overlay refuses to open while a preview is showing.** A
preview is preview-only — the beat config you'd edit lives in a
scheme that isn't loaded. Press shift + `pressR` first to load
the preview into the edit buffer, or `layer` to return to edit
unchanged.

```
grid0_0   beat colour target
grid1_0   bar colour target
grid2_0   prePhrase colour target
grid3_0   phrase colour target

grid0_1   on/off toggle      green = on, red = off
```

Which cell shows which target is defined by the bindings. The
LEDs follow if you rebind them.

### Editing a colour target

Press a target to select it. The four targets work like stops:

- **Stepped edit** — the top RGB encoders and brightness encoder
  increment by ±1.
- **Absolute edit** — the faders set R, G, B, brightness directly.

Brightness is editable. The cell shows the target's actual
brightness — turning the brightness encoder or fader dims /
brightens it in place. The preview LED also follows the target.

Targets show mid grey when unset, brightening when selected, and
the colour you set otherwise.

**Shift + press** a target to clear it.

### On/off toggle

`grid0_1` toggles the whole beat config on or off. Off means the
beat is saved but not applied. On first entry with no `beat`
config, the overlay creates `{ enabled: true }` and the button
starts green.

The rest of the grid is nulled while the overlay is active.

### Preview LED in beat edit

While the preview's deck has fired at least one beat, the
preview LED pulses through the cascade. Beat colour shows on
beat, bar colour on the bar, phrase on the phrase.

Before the first beat on that deck, beat-edit mode with a target
selected shows the target's colour solid. Eyeball what you just
set without waiting for a beat.

`hasBeat` latches on the first beat and is only cleared by
`track_loaded`, so a paused deck that has already beaten keeps
pulsing. The solid-target path is the "no beat yet" state, not
the "paused" state.

The segment strip behind the grid does not pulse in beat edit —
the preview LED is the pulse reference.

### Encoders

| | |
|---|---|
| `encoderL` | `barBeats` — beats per bar |
| `encoderR` | `phraseBars` — bars per phrase |
| Shift + `encoderR` | `prePhraseBeats` — beats before phrase |

Each step prints a debug line.

`barBeats` and `phraseBars` clamp to 1..32. `prePhraseBeats`
clamps to `[0, barBeats * phraseBars - 1]` and defaults to one
bar.

### Dump behaviour

The beat config is emitted only when `enabled !== false`.
Toggling off and dumping discards it.

## Dump

Shift + `press0` prints the preview as JavaScript.

- **Edit preview** → `XoneK3.SCHEMES.NAME = { ... }`
- **Registry preview** → same
- **Slot preview** → `XoneK3.SCHEMES.slotN = { ... }`. Slot 0
  includes the off/co/co-off chain from slots 1/2/3.

Rename `NAME` or `slotN`. Paste into `xone-k3-cat-schemes.js`.

### Slot chain for slot 0

Slots 0–3 form one conceptual scheme:

| Slot | Role |
|---|---|
| 0 | on |
| 1 | off — slot 0's `offScheme` |
| 2 | co — slot 0's `coScheme` |
| 3 | co-off — slot 2's `offScheme` |

When slot 0 is previewed, the LED uses slot 1 as the off-ramp,
slot 2 as the co-steering ramp, and slot 3 as the off-ramp for
the co-steering ramp. Missing slots fall back to engine defaults
(generated off from the on-ramp; engine `coMatch` for the co
ramp).

Dumping slot 0 emits the whole chain as **one** scheme object
with nested inline `offScheme` / `coScheme` objects:

```js
XoneK3.SCHEMES.NAME = {
    colors: [...],
    offScheme: {
        colors: [...]
    },
    coScheme: {
        colors: [...],
        offScheme: {
            colors: [...]
        }
    }
};
```

Each nested block only appears if the corresponding slot is
filled. Paste the whole object as one `XoneK3.SCHEMES.NAME = {…}`
block — no separate registrations required. The engine resolves
inline `offScheme` / `coScheme` objects the same way it resolves
name strings.

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
registrations that don't carry `colors` — modifiers, patch
parents, and empty patches aren't selectable.

Scrolling never changes modes. If you're in edit mode, the strip
shows the scrolled scheme until you either press shift + `pressR`
to load it into edit or `layer` to return to edit unchanged. If
you're in slots mode, the slot grid stays visible and the
preview LED tracks the scheme.

If `XoneK3.SCHEME_REGISTRY` is defined (`xone-k3-lab.js`), scroll
iterates that list instead of scanning `SCHEMES`. Use it to
order what shows up in the editor and to hide test schemes. The
list must contain scheme names that exist in `SCHEMES` —
`cat.js` needs to load before `lab.js`, which the colorLab
preset's `<scriptfiles>` already arranges.

## Shutdown

On preset unload, the lab dumps every populated slot to the
console. Silence with `XoneK3.LAB_DUMP_ON_SHUTDOWN = false`.

Chord shutdown: shift + layer held, `press3` held 2 s. Releasing
shift, layer, or `press3` cancels the timer. Works from EDIT and
from SLOTS.

## Workflows

### Build from scratch

1. Load. Edit mode. Buffer starts as one blue stop.
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
3. **Shift + `pressR` to load the preview into the buffer.**
   Nothing you do before this changes the buffer — the strip
   shows the scrolled scheme but the encoders and faders are
   no-ops.
4. Edit.
5. Shift + `press0` to dump.
6. Paste over the old scheme.

Alternative: `layer` → slots, scroll, then shift + `pressR` to
load and exit to edit.

### Save to a slot

1. In edit mode, get the buffer how you want it.
2. Press `layer` → slots.
3. Press `pressR` to arm.
4. Press the slot you want. Saves, loads the slot into the
   buffer, exits to edit mode.
5. Continue editing.

Slot presses without arming just preview — the grid stays up and
the preview LED tracks the slot. Press `layer` to leave.

### Preview without risk

1. In edit mode, buffer holds work in progress.
2. Press `layer` → slots. Press any slot to preview it — the
   grid stays visible and the preview LED tracks the slot.
3. Turn a knob. Nothing happens; a warn-once fires on the first
   attempt. The buffer is untouched.
4. Press `layer` to return to edit. Buffer intact, exactly as
   you left it.

| Concept | What it is |
|---|---|
| **Stop** | One entry in `colors`. RGB + optional brightness. |
| **Interp** | Blend between adjacent stops, or snap to nearest. |
| **Calibration** | Equalise perceived brightness across the ramp. Two or more stops only — a single-colour scheme has nothing to calibrate. |
| **Ratio** | Per-stop weight. Weight 3 takes 3× the width of weight 1. |
| **Curve** | Warp the boundaries between stops. |
| **Position** | Slides the ramp sideways. 63.5 = identity. |
| **Brightness scale** | Multiplier on the flat-target solve. |
| **Marker** | A colour band shown when a deviation LED samples within `markerPosition ± markerWidth`. Fires before the ramp sample, so a marker hit masks the ramp and cascade. On a beat scheme, the band pulses on/off with the beat, but the cascade accents never reach it. |
| **Beat** | A per-beat colour cascade. Fires off `beat_active` edges, no timers. On-state pulses bright → dim; off-state dim → black. |
| **Preview** | A scheme being inspected. Never editable. `shift+R` to promote to edit. |
| **Edit buffer** | The working scheme. Only mutated in edit mode. Only replaced by explicit load. |

## Debug output

Two streams.

**Edit events** — every action prints what changed.

```
[k3] seg 3 r = 80
[k3] curve = 0.325
[k3] preview slot 5
[k3] saved edit -> slot 3
[k3] beat barBeats = 3
[k3] edit := slot5
```

Silence with `XoneK3._debugPrintsOn = false`.

**Mode events.**

```
[k3] mode = EDIT
[k3] mode = SLOTS (preview=edit)
[k3] arm = ON
[k3] preview = slot5
[k3] scheme = filterEcho
```

Silence with `XoneK3.MODE_PRINTS = false`.

**Warnings.** No gate, fire once per boot via `_warnOnce`. The
preview-only warn-once key is `labEditWhilePreviewing`. Reload
the preset to re-arm it after a fix. Other keys (`labPreviewThrow`,
`schemeNoColors`, `composeSchemeMissing`, etc.) fire once per
boot for the same reason.

## Not in the lab

- No music bindings. That's Cat.
- No undo. Dump before unloading.
- No persistence across presets.
- Ratio editing only touches the first 9 stops.
- Beat config is edited but not played on the segment strip.
  The preview LED pulses; the strip does not.
- No preview-to-edit path other than shift + `pressR`, armed-slot
  save, and `_editThis` (slots mode). Editing while previewing
  never promotes the preview.