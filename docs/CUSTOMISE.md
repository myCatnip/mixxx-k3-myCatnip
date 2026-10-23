# Customising

Change any of it. JavaScript assumed.

**Reload after every edit:** untick / re-tick the preset checkbox
in Preferences → Controllers. Nothing takes effect until you do.

Concepts (binding, patch, stack, token, scheme, timeline) live in
`CONCEPTS.md`. This file assumes you've read it. Control
behaviour is in `CONTROLS.md`.

Four playback presets (Cat, Kitten, oneK3, oneK3 miniFX) share
one layer tree. Editing any `xone-k3-cat-*.js` file changes all
four. colorLab is a separate tree — see `LAB.md`.

---

## What do you want to do?

| I want to… | Edit | See |
|---|---|---|
| Change an LED's colour | the scheme or the binding's `colorScheme.scheme` | §1.1 |
| Change deck / FX theme colours | `xone-k3-cat-schemes.js`, `XoneK3.THEME` | §1.2 |
| Rebind a control to a different CO | the binding's `group` + `inKey` | §1.3 |
| Change a control's LED on/off rule | binding's `colorScheme.on` | §1.4 |
| Make an LED follow a knob | binding's `colorScheme.knob` | §1.5 |
| Add a beat pulse | `SCHEMES.myX.beat` | §1.6 |
| Add a new scheme | `xone-k3-cat-schemes.js` | §1.7 |
| Anchor the phrase at a hotcue | `PHRASE_MARKER_COLORS` | §1.8 |
| Change what an FX knob controls | `xone-k3-cat-fx.js` tables | §1.9 |
| Move a binding between modes | move between patch objects | §1.10 |
| Bind a light-only LED cell | binding with `outKey` but no `inKey` | §1.11 |
| Add a shift override | `<patch>_SHIFT` object | §1.12 |
| Add an overlay | patch with `_host` | §1.13 |
| Accelerate an encoder | binding's `accel:` | §1.14 |
| Make a func do its own accel | custom func + `_*Events` window | §1.15 |
| Add a top-half mode | `TOP_MODES` + cat-* files | §1.16 |
| Adjust a rate limit | binding's `rate:` | §1.17 |
| Add a custom behaviour | `XoneK3.FUNCS.myX = …` | §1.18 |
| Change boot channel / mode | preset's `.js` boot override | §2.6 |
| Change loop-clock tempo tracking | `XoneK3.VIRTUAL_CLOCKS.loop.trackTempo` | §2.11 |

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

**Every shipped emitter reads THEME live** — the focus-mode
press row (`activeSlotButton`), the twoDeck / mini slot
indicators (`slotIndicator`), the FX column emitters
(`fxScheme`), the overlay grids (`deckSelect` / `fxSelect` /
`routeTo`), and the QFX / slip families (`FX_SCHEME_MAP`,
`FX_COLOR_MAP`, `slipScheme`). Mutating THEME at runtime
propagates to any affected LED on its next repaint — no reload
required.

The `selDeck*` / `selFx*` entries in `SCHEMES` still exist but
are unreferenced by the shipped layer tree. Changing THEME has no
effect on them because nothing binds to them.

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

If the new binding belongs in a different patch (say, only
during the cue layer), move it there. Bindings are per-patch.

Control names are in `README.md`. Mixxx CO names are in the
[manual](https://manual.mixxx.org/2.5/en/chapters/appendix/mixxx_controls).

## 1.4 Change a control's LED on/off rule

The LED's on-state comes from one of three sources, checked in
order:

```
   1. colorScheme.on           declarative
   2. group + outKey           read a Mixxx CO
   3. neither                  LED stays off
```

`on:` overrides `outKey` when both are present.

Common shapes:

```js
on: true                                      // always lit
on: false                                     // always off-ramp
on: { patchActive: 'selectAB' }               // overlay is up
on: { state: 'isShifted' }                    // truthy controller field
on: { state: 'selectedDeckCurrent', equals: 1 }
on: { state: 'activeDeck', equals: 'B' }
on: { state: 'activeDisplaySource', equals: 'loop' }
on: { co: 'enabled', group: '[EffectRack1_EffectUnit1]' }
```

Full list of shapes and fields: §2.3.

**`on:` is `true`, `false`, or a conditional object.**

**`on: { co, group }` gets its own connection.** `_parseCsOn`
pushes an `engine.makeConnection` for `on.co` onto `b._conns`,
and `_bindConns` skips the `outKey` connection when `_csOn` is
set — so `on.co` is the only listener that repaints the LED.

**A func cannot influence its own LED's on/off state.** Store the
state on the controller and point `on:` at it:

```js
XoneK3.FUNCS.myToggle = function() {
    this._ctrl._myFlag = !this._ctrl._myFlag;
};

press0: {
    func: XoneK3.FUNCS.myToggle,
    colorScheme: {
        scheme: 'green, 60, 0',
        on: { state: '_myFlag' }
    }
}
```

## 1.5 Make an LED follow a knob

Add `knob: '<name>'`. The LED samples the knob's position along
its scheme's ramp.

```js
button0_0: {
    group: '$DECK_ACTIVE$', inKey: 'pfl', outKey: 'pfl',
    colorScheme: { knob: 'knob0_0', scheme: 'myCatnip' }
}
```

The knob and the button are separate bindings. `knob:` references
the knob by name.

The ramp can carry a marker band — a colour that shows when the
knob is near a target position:

```js
myCatnip: {
    colors: [...],
    markerColor: [127, 0, 0, 100],   // red, on-brightness 100
    markerWidth: 2,                  // half-width in 0..127 units
    markerPosition: 63.5             // 0 = left, 127 = right
}
```

## 1.6 Add a beat pulse

A scheme can pulse on the playing deck's beat.

```js
XoneK3.SCHEMES.myAlert = {
    colors: [[127, 0, 0]],
    beat: {
        color: 'red, 60',              // base, every beat
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
beat`.

Four-case pulse matrix:

| LED state | Between beats | On the beat |
|---|---|---|
| on  | off-ramp (dim) | on-ramp + cascade (bright) |
| off | black | off-ramp (dim) |

All fields optional except `beat`.

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

**Deck must be playing.** `beat_active` only fires on a running
deck.

**Marker + beat are a bad combination.** The marker band fires
*before* the ramp sample: while the knob is inside
`markerPosition ± markerWidth`, the marker colour owns the LED
and the beat cascade (including the base beat colour) never
runs. The marker still pulses on/off with the beat because
`isOn` toggles — bright on the on-phase, off-brightness on the
off-phase — but the cascade accents never reach it. If you want
beat colours visible at that knob position, don't put a marker
on the same scheme.

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

Minimal scheme: `{ colors: [[127, 0, 0]] }`. Full field list:
§2.5.

**A bare partial without `colors` is rejected** with a console
warning. If you want to derive from an existing scheme, use
`B.composeScheme({ scheme: 'catFX', markerPosition: 127 })` at
config-eval time.

Schemes do not survive a reload if you delete them from the
config. `lib-schemes.js` clears `XoneK3.SCHEMES` on every
re-evaluation, and config files re-register their schemes
immediately after. Removing a scheme from
`xone-k3-cat-schemes.js` and reloading is enough.

## 1.8 Anchor the phrase at a hotcue

Set `PHRASE_MARKER_COLORS` in `xone-k3-cat-schemes.js` to the
Mixxx hotcue colour hexes you want to treat as phrase markers.

```js
XoneK3.PHRASE_MARKER_COLORS = [0xC50A08, 0x0044FF];
```

Put a hotcue down at the white-phrase downbeat. Set its colour to
red (`0xC50A08`) in Mixxx. Press it — phrase origin moves there.
Same hotcue doubles as a jump.

Empty list = feature off.

Mixxx default hotcue hexes are documented in the comment above
the setting in `xone-k3-cat-schemes.js`.

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
| `unit` | `true` → a unit-level knob (`fxUnitKnob`, `spec.param` is the CO key) |
| `fxRoute` | `true` → route the focused FX unit into the active deck (a `fxGroupEnable` cell) |
| `displayOnly` | `true` → display-only cell. No input bind, no toggle. LED samples a knob ramp. Tracks the adjacent knob by default (the knob directly above the button). Pair with `on: true` / `on: false` for bright / dim echo. |
| `ledTracks` | *(optional, `displayOnly` cells only)* Override the tracked knob. Literal cell name (`'knob1_0'`), or — in the twoDeck family — abstract slot (`'knob0'` / `'knob1'`) resolved through the column's slot map. Only needed when the display cell should follow a non-adjacent knob. |
| `marker` | `'low'`, `'mid'`, `'high'`, or a raw 0..127 number |
| `schemePosition` | Raw 0..127 `schemePosition` override, same value the scheme would otherwise default to (63.5 = centre) |

The runtime keeps `activePatches` in sync with the current FX
selection via `_syncFxLayout` — you don't rebind by hand.

## 1.10 Swap a binding between modes

A binding in `topShared` only applies in focus mode. A binding in
`twoDeck` only applies in twoDeck mode.

`twoDeckMini` inherits from `twoDeck`, so anything in `twoDeck`
reaches both twoDeck-family modes. To make a cell behave the same
in every mode, add the same binding to each top-half base patch.

## 1.11 LED-only cell

A binding with `group` + `outKey` (or just `colorScheme`) drives
the LED without doing anything on input.

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
`loop_enabled` changes. The first has no CO and repaints only when
the knob moves.

## 1.12 Add a shift override

A shift companion is its own patch with `_shift` on the base:

```js
var CUE = { ..., _shift: 'cueShift' };

var CUE_SHIFT = {
    grid0_0: { ... },     // only this cell overrides
    grid1_0: { ... }
};
```

Empty cells fall through to `CUE`. Bindings in `CUE_SHIFT` apply
only while shift is held.

Shift companions inherit up the parent chain. `ODD_SHIFT` collects
`LOOP_SHIFT` before its own overrides.

## 1.13 Add an overlay

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

## 1.14 Accelerate an encoder

Add `accel` to a binding that has a custom `func`. The runtime
multiplies the number of times the func is called per MIDI event,
based on how fast the encoder is being turned.

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
| `fullAt` | 60 | Events per second at which `amount` is reached |

**`accel` only does anything on a binding with a custom `func`.**
A binding with just `group` + `inKey` writes an absolute value;
repeating the write is a no-op.

**`accel` doesn't work on funcs that have an internal rate
limit.** `encLoopMove` bails on the 2nd through Nth call within
its gate, so the repeats are swallowed. Use a self-accelerating
func instead — see §1.15.

## 1.15 Make a func do its own accel

Some funcs can't use `accel:` because they guard themselves
against rapid calls. The pattern is to track event rate on the
binding itself, then apply a step multiplier.

```js
XoneK3.FUNCS.myAccel = function(args, ch, c, v, s) {
    var now = Date.now();

    // Session-scoped rate window — survives rebind, not reset
    // by _reset.
    if (!this._myEvents) this._myEvents = [];
    var ev = this._myEvents;
    ev.push(now);
    var windowMs = 150;
    while (ev.length > 0 && ev[0] < now - windowMs) ev.shift();

    var rate = ev.length * 1000 / windowMs;   // events per second
    var mult = Math.max(1, Math.min(6, Math.round(rate / 12)));

    // ... apply mult to whatever this func does ...
};
```

`encLoopMoveAccel` in `xone-k3-lib-funcs.js` is a worked example.

**Do not also add `accel:` to the binding.** The runtime would
call the func `reps` times per event, the func would count each
call as a separate event, and the rate would overcount. One source
of acceleration per binding.

**Tuning:**

| Knob | Effect |
|---|---|
| `windowMs` (in the func) | Rate-averaging window. Shorter = snappier, noisier |
| `divisor` | Events/sec per multiplier step. Lower = climbs faster |
| `cap` | Ceiling on the multiplier |

K3 encoders top out around 40–80 Hz on a hard spin. Divisor 30
needs a very fast turn to reach 2×; divisor 12 reaches 2× at a
normal fast spin, 6× on a hard spin.

## 1.16 Add a top-half mode

The runtime knows nothing about specific modes. A mode is a base
patch plus one or more layout patches, registered in
`XoneK3.TOP_MODES`.

### 1. Layout table (`xone-k3-cat-fx.js`)

Define what each middle cell does, per unit:

```js
function myModeFxTable(overrides) {
    return Object.assign({
        knob0:   { effect: 1, param: 1 },
        knob1:   { effect: 2, param: 1 },
        button0: { effect: 1, enabled: true, marker: 'high' },
        button1: { effect: 2, enabled: true, marker: 'low' }
    }, overrides);
}

var MY_MODE_FX_LAYOUTS = {
    1: myModeFxTable(),
    2: myModeFxTable({ knob0: { effect: 3, param: 'meta' } }),
    3: myModeFxTable({}),
    4: myModeFxTable({})
};
```

### 2. Emitter

Turn a table entry into binding objects:

```js
function myModeFxCells(n) {
    var L = MY_MODE_FX_LAYOUTS[n];
    var unit = '$FX_ACTIVE_N$';
    var sch = function() { return fxScheme(n); };
    return {
        knob1_0: B.fxKnob(unit, L.knob0.effect, L.knob0.param),
        knob2_0: B.fxKnob(unit, L.knob1.effect, L.knob1.param),
        button1_0: B.fxEnabled(unit, L.button0.effect,
            { knob: 'knob1_0', scheme: sch, marker: L.button0.marker }),
        button2_0: B.fxEnabled(unit, L.button1.effect,
            { knob: 'knob2_0', scheme: sch, marker: L.button1.marker })
    };
}

function myModeFxLayout(n) {
    return Object.assign({ patch: ['myMode'] }, myModeFxCells(n));
}
```

### 3. Base patch (`xone-k3-cat-top.js`)

```js
var MY_MODE = {
    patch: ['twoDeck'],       // inherit; override what differs
    press1: B.fxGroupEnable('$FX_ACTIVE_N$', '[Channel$DECK_A_N$]', {
        schemeFromState: { state: 'selectedFxCurrent', map: FX_COLOR_MAP }
    }),
    // ...
};
MY_MODE._shift = 'myModeShift';
```

### 4. Register the mode (`xone-k3-lib-controller.js`)

Add to `XoneK3.TOP_MODES`:

```js
XoneK3.TOP_MODES.myMode = {
    owns: [
        'myMode',
        'myModeFx1', 'myModeFx2', 'myModeFx3', 'myModeFx4'
    ],
    activate: function(ctrl) {
        return ['myMode', 'myModeFx' + ctrl.selectedFxCurrent];
    }
};
```

### 5. Extend `_resolveFxPatchName`

Teach the runtime to recognise the new layout family:

```js
var m = /^fx(Layout[AB]?|Mini|MyMode)(\d)$/.exec(name);
```

Add a branch for `MyMode` that resolves to `myModeFx<N>`.

### 6. Add to `CAT_LAYERS` (`xone-k3-cat.js`)

```js
myMode:      CAT.MY_MODE,
myModeShift: CAT.MY_MODE_SHIFT,
myModeFx1:   CAT.myModeFxLayout(1),
myModeFx2:   CAT.myModeFxLayout(2),
myModeFx3:   CAT.myModeFxLayout(3),
myModeFx4:   CAT.myModeFxLayout(4),
```

### 7. Add a swap func + chord binding

`toggleTopMode` and `toggleMiniFx` use `ctrl.setTopMode(mode)`.
Add a chord cell if you want a third swap path, or extend the
existing cycle.

### Two gotchas

**Static vs ramp LEDs.** A group-enable cell with no adjacent
knob must use a **single-colour** scheme. A ramp scheme on a
static LED renders `ramp[0]` (blue for `catFX`).

The correct pattern is `schemeFromState` alone, with the map
already holding single-colour entries:

```js
colorScheme: {
    schemeFromState: { state: 'selectedFxCurrent', map: FX_COLOR_MAP }
}
```

`FX_COLOR_MAP` entries are functions returning single-colour
strings, so the LED picks one colour per state. Don't add
`scheme: FX_COLOR_MAP[n]` on top — that's a function scheme and
`_setupColorScheme` warns (`csDoubleDynamic`) about the
combination.

A cell that has an adjacent knob keeps the ramp and renders as a
deviation LED.

**Cross-route cells.** A cell that should route the *alt* FX unit
uses `$FX_ALT_N$`, not `$FX_ACTIVE_N$`. The press row handles
"focused unit into each deck"; the low-EQ cells are the
cross-route.

## 1.17 Add a rate class or override

Rate classes live in `XoneK3.RATE_CLASSES` in
`xone-k3-lib-core.js`. To add one:

```js
XoneK3.RATE_CLASSES.slowJump = {
    selfCheckMs: 20, selfScope: 'binding',
    jumpBlockMs: 200, claimMs: 200
};
```

Override on a specific binding with `rate:`:

```js
encoderL: { func: F.encLoopMove, args: ['in', 0.010],
            rate: 'jump' },           // force jump class
encoderR: { func: F.encLoopMove, args: ['out', 0.010],
            rate: { selfCheckMs: 15, jumpBlockMs: 60, claimMs: 60 } },
someBtn:  { func: F.something, rate: false }   // opt out
```

Turn on `XoneK3._debugPrintsOn` and reload. `_validateBindings`
warns if `rate: false` was declared on something inference would
have classified, or if `rate:` disagrees with inference.

Diagnostics: `XoneK3.controllers[0].inspect('rate')`. See §2.9.

## 1.18 Custom funcs

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

## 1.19 Definition helpers

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
B.composeScheme({ scheme: 'catFX', marker: 'high' })   // shorthand
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
| `outKey` | Output CO. Read for LED on/off state, unless `colorScheme.on` overrides it. |
| `type` | `'push'` for momentary. Omit for toggle. |
| `softTakeover` | `true` / `false`. Knobs and faders default true. |
| `func` | A function reference from `XoneK3.FUNCS`. |
| `args` | Array passed to the func. |
| `accel` | Number or object. Encoder repeat multiplier. |
| `valueCurve` | Exponent on knobs / faders. `output = input^c`. |
| `rate` | Rate class name, inline class object, or `false`. |
| `colorScheme` | See §2.2. |
| `noLED` | `true` disables LED writes. |
| `k2` | `true` forces MIDI-note colour output. |

## 2.2 colorScheme

```js
// Static — one colour, on/off
colorScheme: { scheme: 'green, 80, 0' }

// Static, on-state from a controller field
colorScheme: {
    scheme: 'white, 60, 0',
    on: { state: 'isShifted' }
}

// Deviation — LED tracks a knob
colorScheme: { knob: 'knob2_0', scheme: 'catFX' }

// Deviation + swap the base scheme based on a CO
colorScheme: {
    knob: 'knob1_2',
    schemeFromState: {
        co: 'loaded_chain_preset',
        group: '[QuickEffectRack1_$DECK_A$]',
        list: XoneK3.QFX_CHAIN_LIST
    }
}

// Static + swap based on a controller field
colorScheme: {
    schemeFromState: {
        state: 'selectedFxCurrent',
        map: FX_COLOR_MAP
    }
}
```

| Field | Meaning |
|---|---|
| `knob` | Name of the pot this LED follows. Presence flips the LED to the deviation render path. |
| `scheme` | Name, inline object, or colour spec. Required unless `schemeFromState` is present. |
| `schemeFromState` | Per-render override. Accepts `state` (dot-path) or `co` (Mixxx control), plus `map` (keyed by value) or `list` (indexed by value, 0-based). |
| `on` | Where the LED's on/off state comes from. |

**`scheme` is required** unless `schemeFromState` supplies one.
A binding without either fails the colour-scheme setup and
darkens the LED with a console warning.

**`schemeFromState` with both `state` and `co`**: `state` wins,
`co` is ignored with a warning.

**Do not combine a scheme function with `schemeFromState`.**
`scheme: FX_COLOR_MAP[n]` is a function scheme — pairing it with
`schemeFromState` triggers a `csDoubleDynamic` warn-once and the
function is ignored. Pass `schemeFromState` alone; the map's
entries already supply the colour.

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
no comparator, the runtime warns once per binding at boot — add
`equals` or `contains` for numeric states.

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

When focus changes, every binding whose `_usedTokens` include the
changed token is re-applied automatically. The rebind is skipped
when the resolved target is unchanged.

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
| `offScheme` | `null` | Named off-ramp. `null` = generated at `DEFAULT_RGB_BRIGHTNESS_OFF` (`lib-core.js`). |
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

## 2.6 Boot config

`xone-k3-cat.js` defines `BOOT_DEFAULTS`. Presets override via
`XoneK3.bootCat(overrides)`.

```js
XoneK3.bootCat({
    label: 'Cat',
    midiChannel: 0x0E,
    initialDeckA: 1, initialDeckB: 2,
    initialFxA: 1,   initialFxB: 2,
    initialActiveDeck: 'A',
    initialActiveFx:   'A',
    initialPatches: ['topShared', 'fxLayout1', 'cue'],
    patches: XoneK3.CAT_LAYERS,
    sysex: true
});
```

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
| `timeSig` | `null` | `{ barBeats, phraseBars }` global override. |

To boot twoDeck:

```js
initialPatches: ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
```

To boot mini:

```js
initialPatches: ['twoDeckMini', 'fxMini1', 'cue']
```

See CONTROLS §6 for the four shipped presets' boot configs.

## 2.7 Hardware calibration

`XoneK3.HARDWARE_CALIB` in `xone-k3-lib-core.js` holds the
factory values for the LED calibration pipeline. Every preset's
boot merges it in first, so a preset only declares what's
different.

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

Merge order — `bootCat` composes:

```
HARDWARE_CALIB  →  BOOT_DEFAULTS  →  per-preset overrides
```

Later entries win. To override for one unit:

```js
XoneK3.bootCat({
    label: 'Kitten',
    midiChannel: 0x0D,
    wbGain:  [0.55, 1.0, 0.90],
    hkBoost: 0.24
});
```

The merged result's `calibration` string, `calibrationMode`,
`wbGain`, `channelPerceptual`, `hkBoost`, and `lumGamma` are
hashed into `_calibKey`, which keys the per-controller
flat-target cache (`_flatCache[segs._cacheId]`, keyed by
`_calibKey` on read). Changing any of them at boot is safe;
changing them at runtime needs a preset reload.

## 2.8 Func mods

| Field | Type | Effect |
|---|---|---|
| `accel` | number / object | Return a repeat count per event. |
| `valueCurve` | number | Knobs / faders only. `output = input^c`. |
| `rate` | string / object / false | Rate class or override. |

Order in `Binding.input()`: rate gate → accel → dispatch.

`valueCurve` applies at write time, after `_scaleValue`.
`_normalized` stays uncurved.

## 2.9 Rate classes

```js
XoneK3.RATE_CLASSES = {
    jump:  { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 120, claimMs: 120 },
    edit:  { selfCheckMs: 10, selfScope: 'binding', jumpBlockMs: 60,  claimMs: 60  },
    claim: { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 0,   claimMs: 60  },
    free:  { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 0,   claimMs: 0   }
};
```

| Class | Use |
|---|---|
| `jump` | Both boundaries move (beatjump, reloop, beatloop activate). |
| `edit` | One boundary moves (loop-point nudge, loop size). |
| `claim` | Doesn't move anything, but shouldn't be followed by a jump (beatjump-size step). |
| `free` | No gate. Everything else by default. |

The class is inferred from the binding's `func` or `inKey`. See
`XoneK3._inferRateClass` in `xone-k3-lib-core.js`.

**Diagnostics.** `XoneK3.controllers[0].inspect('rate')` prints
gate state, per-class aggregates, per-binding stats, and any
recorded escapes. `inspect('rate', 'reset')` zeroes every counter.

**Escape detector.** A loop turning off within
`ESCAPE_DETECT_WINDOW_MS` (500) of a rate claim — and not a
deliberate reloop or track load — logs a single line:

```
[k3] LOOP ESCAPE deck=1 sinceClaim=42ms claimedBy=encoderL/edit loop=[0.2512,0.2537]
```

Read it: the throttle was too loose for that gesture.

## 2.10 K2-mode LEDs

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
index, not by binding, so that LED is K2-locked for the whole
session.

## 2.11 Runtime tunables

Set on the `XoneK3` namespace, at the top of the config or from
the console.

```js
XoneK3.PHRASE_MARKER_COLORS = [];      // [] = off

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

XoneK3.QFX_CHAIN_LIST = [
    'filterNone',
    'filterReverb', 'filterSmoothGrowl', 'filterEcho',
    'filterFlanger', 'filterMoog', 'filterBalance'
];

XoneK3.VIRTUAL_CLOCKS = {
    loop: { trackTempo: false }
};

// Co-match / soft-takeover bands.
XoneK3.CO_MATCH_EPSILON = 1 / 127;
XoneK3.TAKEOVER_EPSILON = 2 / 127;

XoneK3.setTimeSig(4, 4);               // global override
XoneK3.clearTimeSig();                 // per-scheme values
```

`QFX_CHAIN_LIST` order must match Preferences → Effects → Quick
Effect Chains.

**`CO_MATCH_EPSILON` and `TAKEOVER_EPSILON`** — co-match / soft-
takeover bands. `CO_MATCH_EPSILON` sets how far the physical knob
can be from its bound CO before the LED shows the co-match
steering gradient. `TAKEOVER_EPSILON` sets how close the physical
must be to CO at rebind for `_rearmSoftTakeover` to prime Mixxx's
soft takeover with a zero-distance write. The two must stay in
the relationship `CO_MATCH_EPSILON < TAKEOVER_EPSILON`. The LED
claims "matched" only inside the smaller band, so any matched
display implies control is live. Making them equal, or flipping
the order, reintroduces the "LED says matched but nothing
happens" class of bug — see INTERNALS §25.

**`VIRTUAL_CLOCKS.loop.trackTempo`** — the loop clock is the only
virtual timeline.

- `false` (default): advances in real seconds, scaled by the
  deck's playback multiplier (`[ChannelN],rate_ratio`, 1.0 =
  unity). Pitch changes are reflected.
- `true`: follows the position delta, which Mixxx has already
  rate-scaled. Same timing; differs only in loop-wrap handling.

**Do not read `[ChannelN],rate` directly.** That CO is the slider
position (~−0.08..+0.08), not a multiplier. A `<= 0` guard on it
silently turns the multiplier into unity.

## 2.12 Diagnostics

```
XoneK3.controllers[0].inspect()             // top-level state
XoneK3.controllers[0].inspect('press0')     // one binding
XoneK3.controllers[0].inspect('patches')    // activePatches, stack
XoneK3.controllers[0].inspect('beat')       // clock, counters, timeline
XoneK3.controllers[0].inspect('tokens')     // token → bindings
XoneK3.controllers[0].inspect('dark')       // unbound bindings
XoneK3.controllers[0].inspect('rate')       // gate state, stats, escapes
XoneK3.controllers[0].inspect('rate', 'reset')   // zero counters
```

Console prints:

```js
XoneK3._debugPrintsOn = true;      // edit prints
XoneK3.MODE_PRINTS = true;         // colorLab mode prints
```

Warnings (scheme-not-found, unknown token, audit drift, etc.) go
through `XoneK3._warnOnce` and fire once per unique key per boot.
Reload the preset to re-arm.

## 2.13 Funcs

Full annotated list lives in `AI-HELPER.md` under `FUNCS`. This
is a category index.

| Category | Examples |
|---|---|
| Select / focus | `k3Select`, `setActiveDeckTo`, `setActiveFxTo`, `toggleActiveDeck`, `toggleActiveFx` |
| Timeline | `hotcueWithPhraseCheck`, `cycleDisplaySource` (`setPhraseOriginHere` exists but is unbound in shipped presets) |
| Patch / overlay / mode | `layerButton`, `toggleOverlay`, `toggleTopMode`, `toggleMiniFx` |
| Encoders | `encPregainStep`, `encLoopMove`, `encLoopMoveAccel`, `encBeatjump` |
| Buttons | `pressSetValue`, `beatjumpButton`, `reloopToggleResetAnchor`, `shutdownHold` |
| BPM | `bpmPress` |
| Hotcues | `hotcueWithPhraseCheck` |

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
| `on: true` does nothing | `on:` was mis-parsed — check the binding is in the active stack. |
| Hotcue LED wrong | `outKey` doesn't match `hotcue_N_status`. |
| Beat doesn't pulse | Deck not playing. |
| Beat pulses but colour never changes | Only `beat.color` set. Add `bar` / `phrase`. |
| Marker pulses but never accents | Marker fires before the ramp sample — the cascade is fully masked while the knob is in the band. |
| Beat follows the wrong deck | Change `scheme.beat.deck`. |
| Phrase colours are off | Origin isn't 0. Press set-here at the intro, or set `PHRASE_MARKER_COLORS`. |
| Hotcue press doesn't move origin | Colour isn't in `PHRASE_MARKER_COLORS`, or the list is empty. |
| `grid2_0` flashes but nothing changes | Loop clock isn't running. Start a loop first. |
| Display never leaves track | Same. Toggle is a no-op when the loop clock is stopped. |
| Display doesn't switch back to track | Loop clock still running. Stop the loop. |
| Beat LED fires faster/slower than the beat on a pitched deck, loop reading only | `_channelRate` isn't the current version. It must read `rate_ratio`, not `rate`. |
| Phrase clock jumps when pitch changes | Was the old bug. Now both modes rate-scale. If you still see it, check `_advanceVirtualClock` reads `_channelRate(ch)`. |
| Overlay does nothing | Patch doesn't have `_host`, or host isn't active. |
| Grid buttons fire under an overlay | Overlay didn't null them. Add `{}` in the overlay. |
| Layer button does nothing in a patch | Patch has no `layer` binding. |
| Layer does nothing while an overlay is active | Overlay didn't declare its own `layer`. |
| Chord `pressR` doesn't swap modes | Must hold shift + layer first. |
| Chord `pressL` no-op in focus | `pressL` swaps twoDeck ↔ mini. Not reachable from focus. |
| Chord overlay toggles leave both up | Pass the sibling list: `['name', ['other']]`. |
| Mode swap flickers through intermediate stacks | Using `addPatch` / `removePatch` in a loop instead of `_batchPatches`. |
| K2 LED goes dark on reload | Its index isn't in `k2Indices` and no binding marks it `k2: true`. |
| `accel` does nothing | Binding has no `func`. |
| `accel` runs but func sees each repeat as a separate event | Self-accelerating func AND `accel:` on the binding. One source per binding. |
| Loop encoder feels sluggish right after a beatjump | It's rate-gated by the `edit` class. Wait 60 ms, or add `rate: 'free'` if you know better. |
| Loop encoder accel never climbs above 2× | Divisor too high for the encoder's event rate. Lower `args[3]` — try 12 or 8. |
| Warning: "scheme object has no colors" | A bare partial. Use `composeScheme` in config. |
| Warning: "missing scheme" | A `colorScheme` without a `scheme:` field. `scheme` is required. |
| Warning: "fxEnabled missing scheme" | An FX builder was called without `scheme:`. Pass one. |
| Toggle LED never lights | No `outKey` and no `on:`. Add one. |
| Group-enable LED shows blue | Ramp scheme on a static LED. Use `schemeFromState` alone with `map: FX_COLOR_MAP`; don't pair it with a scheme function. |
| QFX LED always shows first scheme | `loaded_chain_preset` stuck at 0, or `QFX_CHAIN_LIST` doesn't match Preferences order. |
| FX columns point at wrong unit | Focus: unshifted `press2` / `press3`. twoDeck: `selectAB` overlay. mini: shift + `press2` / `press3`. |
| Changing a `THEME` colour has no effect | `THEME` is read live by every shipped emitter — the mutation should propagate on the next repaint. If it's stuck, check the emitter actually reads `THEME[x]`; the `selDeck*` / `selFx*` schemes are baked at config-eval, but they aren't referenced by shipped configs. |
| Mini mode swap does nothing | `toggleMiniFx` requires a twoDeck-family base in `activePatches`. |
| Warning prints only once, can't reproduce | `_warnOnce` dedupes per key per boot. Reload the preset to clear. |
| Chord `pressR` / `pressL` LEDs never light | There are no LEDs on those buttons. The bindings fire; nothing lights. |
| Loop turned off unexpectedly | Search the log for `LOOP ESCAPE`. `inspect('rate')` shows which binding claimed and how long before. |
| Rate class isn't throttling | `inspect('rate')` — if the binding isn't listed, inference didn't classify it. Add `rate: 'jump'` / `'edit'` explicitly. |
| `[k3] unknown rate class "…"` | A binding's `rate:` string doesn't match any entry in `RATE_CLASSES`. The binding becomes ungated. Check `lib-core.js`, or fix the binding's `rate:` value. |
| `[k3] _syncFxLayout: fx-pattern patch … has no matching target` | An fx-family patch name is in `activePatches` but missing from `patches:`. |
| `[k3] colorScheme scheme function on X returns a fresh object each call` | Wrap with `composeScheme` or hoist the object out of the closure. |
| `[k3] lab preview render threw: …` | A lab scheme function threw. Preview LED painted black. |