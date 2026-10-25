# Customising

Change any of it. JavaScript assumed.

**Reload after every edit:** untick / re-tick the preset checkbox
in Preferences → Controllers. Nothing takes effect until you do.

Concepts (binding, patch, stack, token, scheme, timeline) live in
`CONCEPTS.md`. Four playback presets (Cat, Kitten, oneK3, oneK3
miniFX) share one layer tree — editing any `xone-k3-cat-*.js`
file changes all four. colorLab is a separate tree — see `LAB.md`.

---

## What do you want to do?

| I want to… | See |
|---|---|
| Change an LED's colour | §1.1 |
| Change deck / FX theme colours | §1.2 |
| Rebind a control to a different CO | §1.3 |
| Change a control's LED on/off rule | §1.4 |
| Make an LED follow a knob | §1.5 |
| Add a beat pulse | §1.6 |
| Add a new scheme | §1.7 |
| Anchor the phrase at a hotcue | §1.8 |
| Change what an FX knob controls | §1.9 |
| Add a shift override | §1.10 |
| Add an overlay | §1.11 |
| Accelerate an encoder | §1.12 |
| Add a custom behaviour | §1.13 |
| Change boot config | §2.6 |
| Change runtime tunables | §2.9 |

---

# 1. Recipes

## 1.1 Change a colour

Find the binding. Change `colorScheme.scheme`.

```js
grid3_1: {
    group: '$DECK_ACTIVE$', inKey: 'play', outKey: 'play_indicator',
    colorScheme: { scheme: 'green' }    // ← this
}
```

Colour spec accepts:

```js
'green'                 palette name
'green, 80'             name + on-brightness
'green, 80, 16'         + off-brightness
[127, 0, 0]             RGB 0..127
[127, 0, 0, 80]         + brightness
[127, 0, 0, 80, 16]     + off-brightness
'mixxx'                 reads the hotcue colour of the pad
```

Brightness goes **after** the colour. `'red, 80'` ✓. `'80, red'` ✗.

For a whole ramp, edit `XoneK3.SCHEMES` in `xone-k3-cat-schemes.js`.

## 1.2 Change a theme colour

Deck and FX number colours live in `xone-k3-cat-schemes.js`:

```js
XoneK3.THEME = {
    deck: {
        1: 'green, 127',
        2: 'red, 93',
        3: [24, 24, 127, 127],
        4: [127, 127, 32, 110]
    },
    fx: {
        1: 'magenta, 115',
        2: 'yellow, 115',
        3: 'cyan, 110',
        4: 'orange, 127'
    }
};
```

Every shipped emitter reads THEME live. Mutating at runtime
propagates on the next repaint — no reload.

## 1.3 Rebind a control

Before — `press0` sets the active deck to slot A:

```js
press0: { func: F.setActiveDeckTo, args: ['A'],
          colorScheme: { scheme: 'green, 60, 0' } }
```

After — `press0` toggles keylock:

```js
press0: {
    group: '$DECK_ACTIVE$', inKey: 'keylock', outKey: 'keylock',
    colorScheme: { scheme: 'white, 64, 0' }
}
```

If the new binding belongs in a different patch, move it there.
Bindings are per-patch.

## 1.4 Change a control's LED on/off rule

The LED's on-state comes from one of three sources, checked in
order:

```
   1. colorScheme.on           declarative
   2. group + outKey           read a Mixxx CO
   3. neither                  LED stays off
```

`on:` overrides `outKey` when both are present.

```js
on: true
on: { state: 'isShifted' }
on: { state: 'selectedDeckCurrent', equals: 1 }
on: { patchActive: 'selectAB' }
```

Full list of shapes and fields: §2.3.

**A func cannot influence its own LED's on/off state.** Store
the state on the controller and point `on:` at it:

```js
press0: {
    func: function() { this._ctrl._myFlag = !this._ctrl._myFlag; },
    colorScheme: { scheme: 'green, 60, 0', on: { state: '_myFlag' } }
}
```

## 1.5 Make an LED follow a knob (or just show state)

**Deviation** — add `knob: '<name>'`. The LED samples the ramp
at that knob's position.

```js
button0_0: {
    group: '$DECK_ACTIVE$', inKey: 'pfl', outKey: 'pfl',
    colorScheme: { knob: 'knob0_0', scheme: 'myCatnip' }
}
```

The knob and the button are separate bindings. `knob:` references
the knob by name.

The ramp can carry a marker band:

```js
myCatnip: {
    colors: [...],
    markerColor: [127, 0, 0, 100],
    markerWidth: 2,                  // half-width, 0..127 units
    markerPosition: 63.5             // 0 = left, 127 = right
}
```

**LED-only** — a binding with `group` + `outKey` (or just
`colorScheme`) drives the LED without an input action:

```js
// Always lit, deviation ramp on fader3
grid3_0: { colorScheme: {
               knob: 'fader3',
               scheme: B.composeScheme({ scheme: 'myCatnipEq', markerWidth: 0 }),
               on: true
           } },

// Tracks loop_enabled for on/off, still reads fader3 for colour
grid3_0: { group: '$DECK_ACTIVE$', outKey: 'loop_enabled',
           colorScheme: { knob: 'fader3', scheme: '...' } },
```

The second form opens a CO listener so the LED repaints when
`loop_enabled` changes. The first has no CO and repaints only
when the knob moves.

## 1.6 Add a beat pulse

A scheme can pulse on the playing deck's beat.

```js
XoneK3.SCHEMES.myAlert = {
    colors: [[127, 0, 0]],
    beat: {
        color: 'red, 60',
        barBeats: 4,
        phraseBars: 4,
        prePhraseBeats: 4,
        bar:       { color: 'green, 60' },
        phrase:    { color: 'white, 127' },
        prePhrase: { color: 'amber, 100' },
        half: false
    }
};
```

Cascade resolves most-specific-first: `prePhrase > phrase > bar >
beat`. Field list and matrix: §2.5.

## 1.7 Add a scheme

Register on `XoneK3.SCHEMES` in `xone-k3-cat-schemes.js`:

```js
Object.assign(XoneK3.SCHEMES, {
    myRamp: {
        colors: [
            [0, 0, 127],     // stop 0 — blue
            [0, 127, 0]      // stop 1 — green
        ],
        brightness: 100
    }
});
```

Use by name:

```js
colorScheme: { scheme: 'myRamp' }
```

Minimal scheme: `{ colors: [[127, 0, 0]] }`. Full field list: §2.5.

A bare partial without `colors` is rejected with a console
warning. Derive from an existing scheme with
`B.composeScheme({ scheme: 'catFX', markerPosition: 127 })`.

## 1.8 Anchor the phrase at a hotcue

Set `PHRASE_MARKER_COLORS` in `xone-k3-cat-schemes.js` to the
Mixxx hotcue colour hexes you want to treat as phrase markers:

```js
XoneK3.PHRASE_MARKER_COLORS = [0xC50A08, 0x0044FF];
```

Put a hotcue at the phrase-start beat, set its colour to red
(`0xC50A08`). The origin derives on the next playposition tick.
Same hotcue doubles as a jump.

Empty list = feature off. Up to 16 hotcues scanned (`HOTCUE_MAX`
in `lib-controller-beat.js`; Mixxx supports 36, raise the
constant if you place markers past hotcue 16).

## 1.9 Change FX cell mapping

Three layout tables, one per mode, in `xone-k3-cat-fx.js`.

```js
var FX_LAYOUTS = {
    1: fxLayoutTable(),
    2: fxLayoutTable({
        knob1_0:   { effect: 3, param: 1 },
        button1_1: { effect: 3, buttonParam: 1, marker: 'low' }
    }),
    3: fxLayoutTable({ ... }),
    4: fxLayoutTable({})
};
```

`fxLayoutTable(overrides)` returns the base table with only those
cells changed. Same pattern for `twoDeckFxTable()` and
`twoDeckMiniFxTable()`.

Cell fields:

| Field | Meaning |
|---|---|
| `effect` | 1..3 — which effect on the unit |
| `param` | 1..N or `'meta'` — which parameter |
| `buttonParam` | 1..N — which button_parameter |
| `enabled` | `true` → effect enable button |
| `unit` | `true` → a unit-level knob (`spec.param` is the CO key) |
| `fxRoute` | `true` → route the focused FX unit into the active deck |
| `displayOnly` | `true` → display-only cell. No input bind. LED samples a knob ramp. Tracks the adjacent knob by default. Pair with `on: true` / `on: false` for bright / dim echo. |
| `ledTracks` | *(displayOnly only)* Override the tracked knob. Literal cell name (`'knob1_0'`), or — in twoDeck — abstract slot (`'knob0'` / `'knob1'`) resolved through the column's slot map. |
| `marker` | `'low'` / `'mid'` / `'high'` or 0..127 |
| `schemePosition` | 0..127 `schemePosition` override |

The runtime keeps `activePatches` in sync with the current FX
selection via `_syncFxLayout` — you don't rebind by hand.

## 1.10 Add a shift override

A shift companion is its own patch with `_shift` on the base:

```js
var CUE = { ..., _shift: 'cueShift' };

var CUE_SHIFT = {
    grid0_0: { ... },
    grid1_0: { ... }
};
```

Undeclared cells fall through to `CUE`. Bindings in `CUE_SHIFT`
apply only while shift is held.

**To make a binding apply only in one mode:** move it out of
`topShared` and into the base patch for that mode (`twoDeck`,
`twoDeckMini`). `twoDeckMini` inherits from `twoDeck`, so anything
in `twoDeck` reaches both twoDeck-family modes.

## 1.11 Add an overlay

An overlay is a patch with `_host`. It only applies while one of
its hosts is in `activePatches`.

```js
var MY_OVERLAY = {
    _host: ['topShared', 'twoDeck', 'twoDeckMini'],
    layer: { func: F.layerExitOverlay, args: ['myOverlay'] },
    grid0_0: { ... },
    grid0_1: { ... }
};
```

Toggle from a func:

```js
XoneK3.FUNCS.myToggle = function() {
    if (this._ctrl._patchActive('myOverlay')) {
        this._ctrl.removePatch('myOverlay');
    } else {
        this._ctrl.addPatch('myOverlay');
    }
};
```

Or use `toggleOverlay`, which takes an optional sibling list:

```js
press0: { func: F.toggleOverlay,
          args: ['fxRouting', ['selectAB']] }
```

The sibling list clears those patches before adding the target.

**An overlay can null a binding from the layer below with `{}`:**

```js
var MY_OVERLAY = {
    _host: 'topShared',
    grid1_1: { },   // kills whatever was here
    grid0_1: { func: F.myFunc }
};
```

When the overlay exits, the original comes back.

**The overlay must declare a `layer` binding** if you want the
layer button to exit it. Otherwise the host's `layer` wins.

## 1.12 Accelerate an encoder

Add `accel` to a binding that has a custom `func`. The runtime
calls the func `reps` times per MIDI event, based on turn speed.

```js
encoder3: { func: F.encKeyShift, group: '$DECK_ACTIVE$', accel: 3 }
```

Full form:

```js
encoder3: { func: F.encKeyShift, group: '$DECK_ACTIVE$',
            accel: { amount: 4, curve: 1.5, window: 250, fullAt: 50 } }
```

| Field | Default | Meaning |
|---|---|---|
| `amount` | 2 | Maximum multiplier |
| `curve` | 1 | Exponent on the rate ramp; > 1 = slower ramp-up |
| `window` | 200 ms | Rate measurement window |
| `fullAt` | 60 | Events/sec at which `amount` is reached |

**`accel` only does anything on a binding with a custom `func`.**
A binding with just `group` + `inKey` writes an absolute value;
repeating the write is a no-op.

**If you want the multiplier logic inside the func** rather than
in the binding config, write a self-accelerating func:

```js
XoneK3.FUNCS.myAccel = function(args, ch, c, v, s) {
    var now = Date.now();
    if (!this._myEvents) this._myEvents = [];
    var ev = this._myEvents;
    ev.push(now);
    var windowMs = 150;
    while (ev.length > 0 && ev[0] < now - windowMs) ev.shift();
    var rate = ev.length * 1000 / windowMs;
    var mult = Math.max(1, Math.min(6, Math.round(rate / 12)));
    // ... apply mult to whatever this func does ...
};
```

`encLoopMoveAccel` in `xone-k3-lib-funcs.js` is the worked example.

**Do not also add `accel:` to the binding.** The runtime would
call the func `reps` times per event, the func would count each
call as a separate event, and the rate would overcount.

Tuning knobs: `windowMs` (in the func, shorter = snappier),
`divisor` (events/sec per step, lower = climbs faster), `cap`
(ceiling on the multiplier).

## 1.13 Custom funcs

```js
XoneK3.FUNCS.myFunc = function(args, ch, c, v, s) {
    // this    = the Binding
    // args    = cfg.args array, passed unchanged
    // v       = MIDI value (0..127)
    // s       = MIDI status
    // this.group, this.inKey  = resolved CO
    // this._normalized        = 0..1 for knobs / faders
    // this._ctrl              = the controller
};
```

Bind it:

```js
press0: { func: XoneK3.FUNCS.myFunc, args: ['arg1'] }
```

**If your func touches a loop** (moves a boundary, engages a
loop, changes loop size), call `this._ctrl._touchLoop(this.group)`
after the write. A subsequent beatjump gates against that event.

**If your func is a beatjump** (moves the playhead by a beat
multiple), call `this._ctrl._beatjumpAllowed(this.group)` first
and bail if it returns `false`.

## 1.14 Definition helpers

Config-side pattern. Build a small function that returns binding
objects, reuse it across a group of controls.

```js
function eqCell(deck, param, killParam, knobName, scheme) {
    return {
        knob: { group: '[EqualizerRack1_' + deck + '_Effect1]', inKey: param },
        button: {
            group: '[EqualizerRack1_' + deck + '_Effect1]',
            inKey: killParam, outKey: killParam,
            colorScheme: { knob: knobName, scheme: scheme }
        }
    };
}

var h = eqCell('$DECK_ACTIVE$', 'parameter3', 'button_parameter3',
               'knob0_0', 'myCatnip');
```

Shipped examples: `fxLayoutTable()` + `fxCells(n)`,
`twoDeckFxTable()` + `twoDeckFxColumn(side, n)`,
`twoDeckMiniFxTable()` + `twoDeckMiniFxCells(n)`.

Builders in `xone-k3-lib-funcs.js`: `eqKnob`, `fxKnob`,
`fxEnabled`, `fxButton`, `fxHeadphone`, `fxGroupEnable`, `fxMix`,
`qfxKnob`, `ledTrackButton`, `composeScheme`, `marker`. Call them
as `B.eqKnob(...)` where `B = XoneK3.builders`.

**`composeScheme`** derives a variant of a named scheme:

```js
B.composeScheme({ scheme: 'catFX', markerPosition: 127 })
B.composeScheme({ scheme: 'catFX', marker: 'high' })
```

Overrides: `markerColor`, `markerPosition`, `markerWidth`,
`schemePosition`, `reverse`, `curve`, `brightness`, `beat`.
Resolves the base at config-eval time and returns a plain object.

---

# 2. Reference

## 2.1 Binding fields

| Field | Purpose |
|---|---|
| `group` | Mixxx group. Tokens resolve. |
| `inKey` | Input CO. |
| `outKey` | Output CO. Read for LED on/off, unless `colorScheme.on` overrides. |
| `type` | `'push'` for momentary. Omit for toggle. |
| `softTakeover` | `true` / `false`. Knobs and faders default true. |
| `func` | A function reference from `XoneK3.FUNCS`. |
| `args` | Array passed to the func. |
| `accel` | Number or object. Encoder repeat multiplier. |
| `valueCurve` | Exponent on knobs / faders. `output = input^c`. |
| `colorScheme` | See §2.2. |
| `noLED` | `true` disables LED writes. |
| `k2` | `true` forces MIDI-note colour output. |

`accel` and `valueCurve` apply in `Binding.input()` before
dispatch. `valueCurve` applies at write time, after scaling;
`_normalized` stays uncurved.

## 2.2 colorScheme

```js
// Static — one colour, on/off
colorScheme: { scheme: 'green, 80, 0' }

// Deviation — LED tracks a knob
colorScheme: { knob: 'knob2_0', scheme: 'catFX' }

// Static + swap based on a controller field
colorScheme: {
    schemeFromState: { state: 'selectedFxCurrent', map: FX_COLOR_MAP }
}
```

| Field | Meaning |
|---|---|
| `knob` | Name of the pot this LED follows. Presence flips the LED to the deviation render path. |
| `scheme` | Name, inline object, or colour spec. Required unless `schemeFromState` is present. |
| `schemeFromState` | Per-render override. Accepts `state` (dot-path) or `co` (Mixxx control), plus `map` (keyed by value) or `list` (0-based index). |
| `on` | Where the LED's on/off state comes from. |

**`scheme` is required** unless `schemeFromState` supplies one.
A binding without either fails the colour-scheme setup and
darkens the LED with a console warning.

**`schemeFromState` with both `state` and `co`**: `state` wins,
`co` is ignored with a warning.

**Do not combine a scheme function with `schemeFromState`.**
`scheme: FX_COLOR_MAP[n]` is a function scheme — pairing it with
`schemeFromState` triggers a `csDoubleDynamic` warn-once and the
function is ignored.

**Do not use `chain_selector` as a `schemeFromState` source.**
It's a relative ±1 encoder control, not a readable index. Use
`loaded_chain_preset` (0-based).

## 2.3 `on:` shapes

| Shape | Meaning |
|---|---|
| `true` | LED always on. |
| `false` | LED always off (off-ramp). |
| `{ patchActive: 'name' }` | Overlay or patch is active. Accepts an array. |
| `{ state: 'dot.path' }` | Truthy controller field. |
| `{ state: 'path', equals: V }` | Strict equality. |
| `{ state: 'path', contains: V }` | Array / string membership. |
| `{ co: 'name', group: '...' }` | Mixxx CO. `group` defaults to the binding's own. |

Derived fields usable as `on.state`:

```
activeDeckVirtual         active deck showing the loop reading
activeLoopVirtual         loop clock running
activeDisplaySource       'track' | 'loop'
activeDeck                'A' | 'B'
activeFx                  'A' | 'B'
selectedDeckCurrent       1..4
selectedDeckAlt           1..4
selectedFxCurrent         1..4
selectedFxAlt             1..4
isShifted                 true | false
```

Without `equals` or `contains`, the LED is on when the resolved
value is truthy. If the resolved value is a positive number with
no comparator, the runtime warns once per binding at boot.

## 2.4 Tokens

Resolved at bind time in `group`, `inKey`, `outKey`,
`schemeFromState.group`, `schemeFromState.co`, `on.group`.

| Token | Reads |
|---|---|
| `$DECK_A$` | `selectedDeckA` → `[Channel<n>]` |
| `$DECK_B$` | `selectedDeckB` |
| `$DECK_C$` | `selectedDeckC` |
| `$DECK_D$` | `selectedDeckD` |
| `$DECK_A_N$` | `selectedDeckA` → bare number |
| `$DECK_B_N$` | `selectedDeckB` → bare number |
| `$DECK_ACTIVE$` | `selectedDeckCurrent` → `[Channel<n>]` |
| `$DECK_ACTIVE_N$` | `selectedDeckCurrent` → bare number |
| `$DECK_ALT$` | `selectedDeckAlt` → `[Channel<n>]` |
| `$DECK_ALT_N$` | `selectedDeckAlt` → bare number |
| `$FX_A$` | `selectedFxA` → `[EffectRack1_EffectUnit<n>]` |
| `$FX_B$` | `selectedFxB` |
| `$FX_C$` | `selectedFxC` |
| `$FX_D$` | `selectedFxD` |
| `$FX_A_N$` | `selectedFxA` → bare number |
| `$FX_B_N$` | `selectedFxB` → bare number |
| `$FX_ACTIVE$` | `selectedFxCurrent` → `[EffectRack1_EffectUnit<n>]` |
| `$FX_ACTIVE_N$` | `selectedFxCurrent` → bare number |
| `$FX_ALT$` | `selectedFxAlt` → `[EffectRack1_EffectUnit<n>]` |
| `$FX_ALT_N$` | `selectedFxAlt` → bare number |

`activeDeck` and `activeFx` start at `'A'`. Boot config accepts
`initialActiveDeck` and `initialActiveFx` (`'A'` or `'B'`).

## 2.5 Scheme fields

| Field | Default | Meaning |
|---|---|---|
| `colors` | — | Colour stops. Required. |
| `ratio` | `null` | Per-stop weight. Missing = 1. |
| `curve` | `0` | −0.95..0.95 warp on boundaries. |
| `schemePosition` | `63.5` | Slides the ramp, 0..127. |
| `interp` | `true` | `false` = snap, no blend. |
| `calibration` | `true` | `false` = skip flat-target solve. |
| `brightness` | `127` | Default hw for stops without one. |
| `brightnessScale` | `1` | Multiplier on flat-target. |
| `markerColor` | `null` | Marker band colour. |
| `markerPosition` | `63.5` | Marker centre, 0..127. |
| `markerWidth` | `0` | Half-width. `0` = no marker. |
| `offScheme` | `null` | Named off-ramp. `null` = generated at `DEFAULT_RGB_BRIGHTNESS_OFF`. |
| `coScheme` | `'coMatch'` | Steering ramp when knob and CO disagree. |
| `reverse` | `false` | Flip the ramp direction. |
| `beat` | `null` | Beat colour cascade. |

**Curve** warps the boundaries between stops, not the colours
themselves. Applied before `schemePosition`.

| `curve` | Effect |
|---|---|
| `> 0` | Boundaries squish toward the midpoint |
| `< 0` | Boundaries expand away from the midpoint |
| `0` | No warp |

### `beat:` block

| Field | Default | Meaning |
|---|---|---|
| `color` | — | Base colour, every beat |
| `brightness` | scheme's | Base brightness |
| `bar` | — | Override on `count % barBeats === 0` |
| `phrase` | — | Override on phrase start |
| `prePhrase` | — | Override before phrase |
| `half` | `false` | Skip odd beats at the beat level |
| `barBeats` | `4` | Beats per bar |
| `phraseBars` | `4` | Bars per phrase |
| `prePhraseBeats` | `barBeats` | Beats before phrase to fire prePhrase |
| `deck` | `$DECK_ACTIVE$` | Which deck drives the pulse |
| `enabled` | `true` | `false` mutes the pulse |

Cascade resolves most-specific-first: `prePhrase > phrase > bar >
beat`. Matrix:

| LED state | Between beats | On the beat |
|---|---|---|
| on  | off-ramp (dim) | on-ramp + cascade (bright) |
| off | black | off-ramp (dim) |

## 2.6 Boot config

`xone-k3-cat.js` defines `BOOT_DEFAULTS`. Presets override via
`XoneK3.bootCat(overrides)`.

| Field | Default | Meaning |
|---|---|---|
| `label` | `'Cat'` | Console name. |
| `midiChannel` | `0x0E` | 0x00..0x0F. |
| `initialDeckA/B/C/D`, `initialFxA/B/C/D` | 1/2/3/4 | Starting selection per slot. |
| `initialActiveDeck` | `'A'` | Which of A/B boots as the active deck slot. |
| `initialActiveFx` | `'A'` | Which of A/B boots as the active FX slot. |
| `initialPatches` | `['topShared','fxLayout1','cue']` | Ordered active patches at boot. |
| `patches` | `XoneK3.CAT_LAYERS` | The patch tree. |
| `sysex` | `true` | RGB sysex vs K2 MIDI palette. |
| `timeSig` | `null` | `{ barBeats, phraseBars }` override. |

To boot twoDeck:

```js
initialPatches: ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
```

To boot mini:

```js
initialPatches: ['twoDeckMini', 'fxMini1', 'cue']
```

## 2.7 Hardware calibration

`XoneK3.HARDWARE_CALIB` in `xone-k3-lib-core.js` holds the factory
values for the LED calibration pipeline. Every preset's boot
merges it in first — a preset only declares what's different.

```js
XoneK3.HARDWARE_CALIB = {
    calibration:       'measuredRGB',
    calibrationMode:   'rms',
    wbGain:            [0.6, 1.0, 0.93],
    channelPerceptual: [1.35, 0.69, 0.19],
    hkBoost:           0.29,
    lumGamma:          0.32
};
```

To override for one unit, pass the fields to `bootCat`:

```js
XoneK3.bootCat({ label: 'Kitten', midiChannel: 0x0D,
                 wbGain: [0.55, 1.0, 0.90], hkBoost: 0.24 });
```

Changing these at boot is safe; changing at runtime needs a
preset reload.

## 2.8 K2-mode LEDs

`k2: true` on a binding routes its LED through MIDI notes instead
of sysex.

```js
shift: { func: F.shiftToggle, k2: true }
```

Alternative: list raw indices in the boot config:

```js
k2Indices: [0x1D]
```

`k2: true` works inside an overlay. `k2Indices` is keyed by LED
index, so that LED is K2-locked for the whole session.

## 2.9 Runtime tunables

```js
XoneK3.PHRASE_MARKER_COLORS = [];      // [] = off

XoneK3.THEME = { deck: { ... }, fx: { ... } };

XoneK3.QFX_CHAIN_LIST = [
    'filterNone',
    'filterReverb', 'filterSmoothGrowl', 'filterEcho',
    'filterFlanger', 'filterMoog', 'filterBalance'
];

XoneK3.VIRTUAL_CLOCKS = {
    loop: { trackTempo: false }
};

XoneK3.BEATJUMP_GAP_MS = 130;

XoneK3.BEAT_PLAYING_MODE = 'pulse';  // 'pulse' | 'solid' | 'off'
XoneK3.BEAT_PAUSED_MODE  = 'solid';  // 'pulse' | 'solid' | 'off'

XoneK3.CO_MATCH_EPSILON = 1 / 127;
XoneK3.TAKEOVER_EPSILON = 2 / 127;

XoneK3.setTimeSig(4, 4);
XoneK3.clearTimeSig();
```

`QFX_CHAIN_LIST` order must match Preferences → Effects → Quick
Effect Chains.

**`BEATJUMP_GAP_MS`** — the only rate-related tunable. Gates
beatjumps only, only when the target channel is in an active
loop. Set to `0` to disable, `150–200` for stricter. See
INTERNALS §25 for the gate logic.

**`BEAT_PLAYING_MODE` / `BEAT_PAUSED_MODE`** — what a beat
scheme's LED shows, per deck state. `'pulse'` is the bright/dim
half-beat alternation. `'solid'` shows the current beat's
cascade colour, held. `'off'` disables the cascade. Paused with
`'solid'` (the default) means jogging / beatjump / mouse-drag
shows the beat colour of wherever you land — useful for finding
the current beat without playing. For paused display to work on
a custom beat LED, its `outKey` (or `on:`) must read 1 while
paused — `track_loaded` works; `play_indicator` doesn't.

**`CO_MATCH_EPSILON` < `TAKEOVER_EPSILON`** must hold. `CO_MATCH`
sets how far the physical knob can be from its bound CO before
the LED shows the co-match steering gradient. `TAKEOVER` sets how
close physical must be at rebind for `_rearmSoftTakeover` to
prime soft takeover. The LED claims "matched" only inside the
smaller band, so any matched display implies control is live.

**`VIRTUAL_CLOCKS.loop.trackTempo`** — the loop clock is the only
virtual timeline.

- `false` (default): advances in real seconds, scaled by
  `[ChannelN],rate_ratio`. Pitch changes are reflected.
- `true`: follows position delta, which Mixxx has already
  rate-scaled. Differs only in loop-wrap handling.

## 2.10 Diagnostics

```js
XoneK3._debugPrintsOn = true;      // edit prints
XoneK3.MODE_PRINTS = true;         // colorLab mode prints
```

Warnings go through `XoneK3._warnOnce` and fire once per unique
key per boot. Reload to re-arm.

Runtime probes (safe to call any time):

```js
XoneK3.controllers[0].inspect()             // top-level state
XoneK3.controllers[0].inspect('press0')     // one binding
XoneK3.controllers[0].inspect('patches')    // activePatches, stack
XoneK3.controllers[0].inspect('why', 'layer')    // pipeline walk
```

Full command list and symptom table: INTERNALS §26.

## 2.11 Funcs

Full annotated list lives in `AI-HELPER.md` under `FUNCS`. This
is a category index.

| Category | Examples |
|---|---|
| Select / focus | `k3Select`, `setActiveDeckTo`, `setActiveFxTo`, `toggleActiveDeck`, `toggleActiveFx` |
| Timeline | `cycleDisplaySource` |
| Patch / overlay / mode | `layerButton`, `toggleOverlay`, `toggleLayerOverlay`, `toggleTopMode`, `toggleMiniFx` |
| Encoders | `encPregainStep`, `encLoopMove`, `encLoopMoveAccel`, `encBeatjump` |
| Buttons | `pressSetValue`, `beatjumpButton`, `reloopToggleResetAnchor`, `shutdownHold` |
| BPM | `bpmPress` |
| Hotcues | `hotcueSetPhraseColor` |

---

# 3. Common mistakes

Console warnings are emitted **once per unique key per boot**.
Fix the config, reload the preset, and the warning fires again.

| Symptom | Cause |
|---|---|
| LED stays dark | Scheme name typo. Console: `scheme "X" not found`. |
| LED is the wrong colour | Scheme name collides with a palette colour. Rename. |
| Binding does nothing | Forgot to reload the preset. |
| `on:` never lights | Value read doesn't match `equals`, or isn't truthy. |
| Hotcue LED wrong | `outKey` doesn't match `hotcue_N_status`. |
| Toggle LED never lights | No `outKey` and no `on:`. Add one. |
| Group-enable LED shows blue | Ramp scheme on a static LED. Use `schemeFromState` alone with `map: FX_COLOR_MAP`. |
| Beat doesn't pulse | Deck not playing, or `BEAT_PLAYING_MODE` is not `'pulse'`. |
| Paused deck shows no beat colour | The binding's `outKey` (or `on:`) reads 0 while paused. Use `track_loaded` or `on: true`. |
| Beat pulses but colour never changes | Only `beat.color` set. Add `bar` / `phrase`. |
| Overlay does nothing | Patch doesn't have `_host`, or host isn't active. |
| Grid buttons fire under an overlay | Overlay didn't null them. Add `{}` in the overlay. |
| Layer button does nothing in a patch | Patch has no `layer` binding. |
| FX columns point at wrong unit | Focus: unshifted `press2` / `press3`. twoDeck: `selectAB` overlay. mini: shift + `press2` / `press3`. |
| QFX LED always shows first scheme | `loaded_chain_preset` stuck at 0, or `QFX_CHAIN_LIST` doesn't match Preferences order. |
| Changing a `THEME` colour has no effect | Nothing bound to that slot, or the emitter reads THEME from a variable captured at config-eval time. |
| `accel` does nothing | Binding has no `func`. |
| Warning: "scheme object has no colors" | A bare partial. Use `composeScheme` in config. |
| Warning: "missing scheme" | A `colorScheme` without a `scheme:` field. `scheme` is required. |
| Warning prints only once | `_warnOnce` dedupes per key per boot. Reload to clear. |