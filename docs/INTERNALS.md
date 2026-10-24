# Internals

Modify the runtime. Developer-only.

For concepts, see `CONCEPTS.md`. For shipped-behaviour reference,
see `CONTROLS.md`. For scheme fields, binding fields, colour spec,
beat, patches — see `CUSTOMISE.md`. This file is the engine.

---

# 1. Load order

```
xone-k3-lib-core.js               bootstrap, tunables, RATE_CLASSES,
                                  PATCH_NAMES, utilities, tokens,
                                  transfer curve, sysex math, beat
                                  math, K2 palette, VIRTUAL_CLOCKS,
                                  diagnostics constants
xone-k3-lib-schemes.js            palette, scheme engine,
                                  LED_TRANSFERS, coMatchSample
xone-k3-lib-binding.js            Binding primitive, colour render
                                  path, rate gate, snapshot field list
xone-k3-lib-controller.js         K3Controller core: constructor,
                                  patch resolution, focus, TOP_MODES,
                                  chord, binding application,
                                  render-time scheme resolution
xone-k3-lib-controller-colour.js  on: parser, base scheme parser,
                                  schemeFromState closures,
                                  _setupColorScheme
xone-k3-lib-controller-beat.js    timeline, loop clock,
                                  display-source resolution, beat
                                  count, beat clock connections
xone-k3-lib-controller-render.js  LED writes, sysex queue,
                                  calibration, ramp sampling
xone-k3-lib-controller-boot.js    rate gate, escape detector,
                                  init / shutdown, MIDI wiring,
                                  boot, halt
xone-k3-lib-funcs.js              builders + XoneK3.FUNCS
xone-k3-lib-inspect.js            runtime state probes

xone-k3-cat-schemes.js            THEME, QFX_CHAIN_LIST,
                                  PHRASE_MARKER_COLORS, SCHEMES,
                                  scheme helpers
xone-k3-cat-fx.js                 FX layout tables + emitters
xone-k3-cat-top.js                focus / twoDeck / mini base patches
xone-k3-cat-bottom.js             cue / loop / oddLoop layers
xone-k3-cat-overlays.js           selectAB / fxRouting / chord
xone-k3-cat.js                    CAT_LAYERS assembler + bootCat()

xone-k3-kitten.js                 optional: boot override
xone-k3-onek3.js                  optional: boot override
xone-k3-onek3-minifx.js           optional: boot override
```

colorLab replaces the cat-* files with its own tree and adds:

```
xone-k3-lab.js             LabController, bakeScheme
xone-k3-colorlab.js        colorLab layers + boot
```

`lab.js` sits after `lib-funcs.js` — it references
`XoneK3.FUNCS.*` at load time for `LAB_PAINTER_FUNCS`. Everything
it borrows from the scheme engine (`compileScheme`, `sampleT`,
`sampleSegs`, `scaleTarget`, `coMatchSample`) is resolved at call
time, not at load.

## Why the splits

**lib splits — core / schemes / binding / controller / funcs / inspect.**
No single file holds more than one concern. `core` is the leaf
everything depends on. `schemes` depends on core. `binding`
depends on core plus the scheme engine. `controller` depends on
all three. `funcs` and `inspect` sit on top.

**controller split into five files.** All five extend
`K3Controller.prototype` — no new classes, no new imports, no
load-order surprises beyond what `_requireLoad` guards against.
The split is by concern:

| File | Holds |
|---|---|
| `lib-controller.js` | Constructor, patch resolve, focus, TOP_MODES, chord, binding application, `_tokenFingerprint`, `_resolvedTargetHash`, `_resolveSchemeRef` |
| `lib-controller-colour.js` | `_parseCsOn`, `_parseSchemeValue`, `_parseSchemeFromState`, `_parseCsScheme`, `_buildCsFromStateClosure`, `_setupColorScheme` |
| `lib-controller-beat.js` | Timeline, loop clock, display source, beat count, beat clock connections |
| `lib-controller-render.js` | LED writes, sysex queue, calibration math, ramp sampling |
| `lib-controller-boot.js` | Rate gate, escape detector, init/shutdown, MIDI wiring, boot, halt |

Every preset's `.midi.xml` loads all five, in this order, between
`lib-binding.js` and `lib-funcs.js`. Any change to the file list
means editing five `.midi.xml` files plus `test/harness.js`.

**cat splits — schemes / fx / top / bottom / overlays / assembler.**
The cat-* files extend `XoneK3.CAT`, a shared namespace created
by `xone-k3-cat-schemes.js` and consumed by `xone-k3-cat.js`.
Each declares its own `_requireLoad` prereqs. Load order matters
between them:

```
cat-schemes  →  cat-fx  →  cat-top  →  cat-bottom  →  cat-overlays  →  cat
     ↓            ↓          ↓            ↓                ↓           ↓
     creates      uses       uses         uses             uses        assembles
     XoneK3.CAT   fxScheme   fxSchemeFor  slipScheme       F, layer    CAT_LAYERS
                  THEME      FX_COLOR_MAP PLAY_LED_SCHEME  helpers     + bootCat
```

## Bootstrapping XoneK3

`lib-core.js` opens with `'use strict';` and a top-level
declaration:

```js
var XoneK3 = (typeof XoneK3 !== 'undefined') ? XoneK3 : {};
```

In Mixxx's Qt engine, all `<scriptfiles>` for a preset evaluate
into the same global object. The `var` at file scope creates the
shared global. The initializer preserves an existing global if
one's already there.

Every other file opens with `'use strict';` and an IIFE whose
first action is a load-order guard:

```js
(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('<filename>', ['FUNCS', 'SCHEMES', ...]);
```

`XoneK3._requireLoad(file, prereqs)` walks the prereq list and
throws if any symbol is `undefined`. The error names the file
and the missing symbols, and points at the `<scriptfiles>` block
in the `.midi.xml`.

Strict mode enforces file-scope declarations: a top-level `var`
creates the shared global deliberately, and a misspelled
reference that would have silently created a global now throws.

---

# 2. Architecture

## Request flow

```
   physical input           config                 LED output
   ───────────────          ──────                 ──────────
   midi.on(note, v)         CAT_LAYERS
        │                   ├─ topShared            ├─ _sendColor
        ▼                   ├─ fxLayout<n>          │  or
   Binding.input()          ├─ cue                  │  _send
        │                   ├─ loop                 │
        ├─ _onInput()       └─ oddLoop              │
        ├─ rate gate             │                   │
        ├─ accel / func / default                   │
        │                        ▼                   │
        │                    _recompute()            │
        │                        │                   │
        │                        ▼                   │
        │                    _buildStack             │
        │                        │                   │
        │                        ▼                   │
        │                    _resolveStack           │
        │                        │                   │
        │                        ▼                   │
        │                    _applyResolved ────║ Binding._refresh
        │                                            │
        └─ _ledObservers[i]._refresh() ──────────────┘
```

Every physical event fans out two ways: the binding's own input
handler fires (`_onInput` first, then the rate gate, then accel,
then func or default write), and every LED observing the binding
repaints. Config changes go through `_recompute`, which rebinds
everything whose hash changed and repaints every LED.

## Runtime object graph

```
config (cat-*.js chain / kitten.js / onek3.js / onek3-minifx.js / colorlab.js)
  │
  │  XoneK3.boot(devices) / bootLab(devices)
  ▼
K3Controller
  │
  ├── Binding[]         one per physical control. Holds input,
  │                     output, func, colour scheme, rate class,
  │                     and mods. Exposed as `this.bindings`.
  │
  ├── patches{}         named patch definitions.
  ├── activePatches[]   ordered list of currently-applied patches.
  │
  ├── activeDeck        'A' or 'B'.
  ├── activeFx          'A' or 'B'.
  │
  ├── selectedDeckA/B/C/D   channel numbers for each slot
  ├── selectedFxA/B/C/D     unit numbers for each slot
  │
  ├── selectedDeckCurrent   derived
  ├── selectedDeckAlt       derived
  ├── selectedFxCurrent     derived
  ├── selectedFxAlt         derived
  │
  ├── _phraseOrigin[1..4]   beat at which "count 1" sits
  │
  ├── _decks[1..4]      per-channel timeline + beat state
  │
  ├── activeDeckVirtual      derived
  ├── activeLoopVirtual      derived
  ├── activeDisplaySource    derived
  │
  ├── isShifted
  ├── _chordActive
  ├── k2Indices
  │
  ├── _lastLoopChangeMs     shared rate-gate clock
  ├── _lastRateClaim        { binding, className, ts }
  ├── _expectingLoopOff[ch] deliberate loop-off markers
  ├── _escapes[]            bounded history of loop escapes
  ├── _lastEscapePrintKey   print dedup key
  ├── _lastEscapePrintBucket print dedup bucket
  │
  ├── _beatConns[]      1 per channel (beat_active)
  ├── _playConns[]      5 per channel (playposition,
  │                     play_indicator, track_loaded, loop_enabled,
  │                     slip_enabled)
  ├── _beatLeds[]       Bindings whose scheme carries `beat`
  ├── _onBeat(ch)       subclass hook
  ├── _onInput(b)       subclass hook
  │
  ├── _trackMetaCache{}  per-channel { duration, fileBpm,
  │                      samples }. Cleared on track_loaded.
  │                      Incomplete reads (duration 0) not cached.
  ├── _hwCache{}         (rgb, targetLum) → solved hw.
  ├── _flatCache{}       per-controller, keyed by segs._cacheId
  │                      then by _calibKey. See §12.
  ├── _calibKey          captures every _emitAt input.
  │
  ├── _ledCache{}       per-index value dedup
  ├── _sysexQueue[]     pending sysex frames
  ├── _sysexTimer       drain timer handle
  │
  ├── _recomputeDepth     recompute-in-progress depth
  ├── _recomputeCompletedAt  stamp for redundant-refresh warning
  ├── _refreshAllLedsDepth   re-entrancy guard for _refreshAllLeds
  ├── _resolvedTargetHashCache  WeakMap<cfg, {fingerprint, value}>
  │                       — memo for _resolvedTargetHash; keyed on
  │                       the token fingerprint. See §8.
  │
  ├── _resolvedPatchCache{}  memoized patch merges, keyed by name
  │
  ├── addPatch / removePatch / replacePatch
  ├── _batchPatches     N mutations, one recompute
  │
  ├── setSelectedFor    assign channel/unit to a slot
  ├── setActiveDeck     set active deck slot to A or B
  ├── setActiveFx       set active FX slot to A or B
  ├── currentTopMode    reads activePatches
  ├── setTopMode        swap mode, one batch
  ├── _refreshActiveAlt recompute derived fields
  ├── _reapplyByTokens  re-bind bindings using a changed token
  ├── _tokenFingerprint token-bearing fields → positional snapshot
  ├── _resolvedTargetHash  fingerprint → resolved-target hash
  ├── _resolveFxPatchName
  ├── _syncFxLayout     swap the live fxLayout* / fxMini* patches
  │
  ├── _claimRate        check + claim a rate class
  ├── _checkLoopEscape  escape detector hook
  │
  ├── _enterChord / _exitChord
  │
  └── _recompute()
```

## Method ownership across the five controller files

| Method group | File |
|---|---|
| `constructor`, `_buildHardware` | `lib-controller.js` |
| `_parentList`, `_resolvePatch`, `_buildStack`, `_resolveStack` | `lib-controller.js` |
| `_applyResolved`, `_applyBinding`, `_bindCore`, `_bindFunc`, `_bindConns`, `_safeBinding` | `lib-controller.js` |
| `_tokenFingerprint`, `_resolvedTargetHash`, `_reapplyByTokens`, `_resolveSchemeRef` | `lib-controller.js` |
| `addPatch` / `removePatch` / `replacePatch` / `_batchPatches` | `lib-controller.js` |
| `currentTopMode`, `setTopMode`, `_resolveFxPatchName`, `_syncFxLayout` | `lib-controller.js` |
| `shift` / `unshift` / `_enterChord` / `_exitChord` / `_refreshAllLeds` | `lib-controller.js` |
| `setSelectedFor`, `setActiveDeck`, `setActiveFx`, `_refreshActiveAlt` | `lib-controller.js` |
| `_validateBindings`, `_isPress` | `lib-controller.js` |
| `_parseCsOn`, `_parseSchemeValue`, `_parseSchemeFromState`, `_parseCsScheme`, `_buildCsFromStateClosure`, `_setupColorScheme` | `lib-controller-colour.js` |
| `_channelOf`, `_readLoopState`, `_readLoopBounds`, `_channelRate` | `lib-controller-beat.js` |
| `_virtualTempoTrack`, `_startVirtualClock`, `_stopVirtualClock`, `_advanceVirtualClock` | `lib-controller-beat.js` |
| `_resolveDisplaySource`, `_refreshDisplayFlags` | `lib-controller-beat.js` |
| `_trackMeta`, `_readFileBpm`, `_fileBpm`, `_getContentBounds`, `_beatF`, `_computeAbsoluteBeat`, `_trackBeatF` | `lib-controller-beat.js` |
| `_computeBeatState`, `_cascadeCount`, `_virtualBeatFor`, `_syncBeatCount`, `_setPhraseOriginAt`, `_resetBeat`, `_repaintBeat`, `_repaintFromPosition` | `lib-controller-beat.js` |
| `_openBeatClocks`, `_closeBeatClocks`, `_syncBeatClocks`, `_needsBeatClocks`, `_refreshBeatLeds` | `lib-controller-beat.js` |
| `_attachBeatLed`, `_detachBeatLed`, `_resolveDeckRef`, `_deckStateFor` | `lib-controller-beat.js` |
| `sendLED`, `_sendSysExLED`, `_blankLeds`, `_pulseCo` | `lib-controller-render.js` |
| `_wbRGB`, `_channelEmit`, `_emitAt`, `_flatTarget`, `_calibratedHw`, `_solveHw`, `_sampleRamp` | `lib-controller-render.js` |
| `init`, `shutdown`, `_initExtra`, `_shutdownExtra` | `lib-controller-boot.js` |
| `_resolveRateClass`, `_claimRate`, `_bindingInActiveLoop`, `_checkLoopEscape` | `lib-controller-boot.js` |
| `XoneK3._wireInputs`, `XoneK3._bootWith`, `XoneK3.boot`, `XoneK3.bootLab`, `XoneK3.halt` | `lib-controller-boot.js` |

## The recompute cycle is self-contained

```
_recompute()
  _buildStack       → [stack names]
  _resolveStack     → merged binding map
  _applyResolved    → hash diff; _applyBinding per changed binding
  _afterRecompute   → subclass hook
  _refreshAllLeds   → _syncBeatClocks, then b._refresh() per binding
```

`_recompute` ends with `_refreshAllLeds`. **Callers do not refresh
after.** `_reapplyByTokens` ends with the same call by default;
token reapply is self-contained *unless* the caller passed
`{ skipRefresh: true }` — see §8. If a code path adds or removes
a patch and you find yourself reaching for `_refreshAllLeds`
afterwards, something else is wrong — the refresh already
happened.

One physical control is one `Binding`.

---

# 3. Boot and multi-device

`XoneK3.boot(devices)` and `XoneK3.bootLab(devices)` both route
through `XoneK3._bootWith(devices, Ctor, label)`:

1. Print the init banner.
2. Reset per-boot state: `XoneK3.controllers = []`,
   `_schemeCache = {}`, `_compiledCache = {}`, `_warned = {}`,
   `_modeSeen = { edit: false, slots: false }`,
   `_funcIdCounter = 0`, `_funcIdMap = new WeakMap()`.
3. Call `XoneK3._populateColors()` — copies `SYSEX_PALETTE` into
   `COLORS` so palette names resolve.
4. Set `XoneK3.TIME_SIG` from `devices[0].timeSig` (or null).
5. For each entry in `devices` (or the single object, wrapped):
   - Construct a `K3Controller` (or the passed `Ctor`) with the
     config.
     Constructor order: focus slots → `_decks` → `_refreshActiveAlt`
     → `_buildHardware` → boot-time fxLayout alignment.
   - Call `ctrl.init()` — blanks LEDs, runs `_recompute`, runs
     `_initExtra`, validates tokens + rate classes, and schedules
     a delayed beat-clock reopen (see below).
   - Call `XoneK3._wireInputs(ctrl)` — hooks every binding's MIDI
     input handler, plus a note-off handler for anything sent as
     0x90.
   - Push onto `XoneK3.controllers`.
6. Call `XoneK3._auditSnapshotFields()` — once per boot, after
   all controllers are constructed. Gated on `_debugPrintsOn`.

**Boot-time beat-clock reopen.** The initial `_recompute` runs
inside `init()` and opens the beat clocks via `_syncBeatClocks`.
On Mixxx startup, that first open can race the CO tree: the
connections register successfully but never fire, because the CO
tree isn't fully wired yet. `init` schedules a 250 ms one-shot
that closes and reopens the clocks once the tree has settled.
`_shuttingDown` guards a reload landing inside the delay window.
`_openBeatClocks`'s `track_loaded` handler also calls
`_syncBeatClocks` as belt-and-braces — a no-op when they're
already open.

The reopen also protects `_trackMetaCache`: the pre-open
`_recompute` may have read incomplete track metadata (CO tree
not settled) — that read is not cached (see §6), and the first
`playposition` tick after the reopen re-reads and caches it.

**Catch-up on open.** `_openBeatClocks` ends with a loop that
re-reads loop state and restarts the loop clock on any channel
where a loop is already enabled. CO connections only fire on
change, so without this a preset reload during an active loop
would leave the loop clock idle until the user toggled the loop
off and on. The catch-up handles the initial open and the reopen
in `init` identically.

Each controller owns its own binding map, its own sysex queue and
drain timer, its own beat clock connections, its own LED cache,
its own rate gate (`_lastLoopChangeMs`, `_lastRateClaim`,
`_escapes`, `_lastEscapePrintKey`, `_lastEscapePrintBucket`), and
its own caches.

`XoneK3.halt()` iterates `XoneK3.controllers`, calls `shutdown()`
on each, clears the array.

**`_funcId` state is boot-scoped.** `_funcIdMap` is a WeakMap
keyed by function reference — entries are collected with their
functions — but the monotonic counter grew unboundedly across
reloads, so `inspect()` output showed `func:_47`-style ids whose
value depended on how many times the preset had been reloaded.
Both are reset on every boot so ids read from `_0` per session.

---

# 4. Patches

`activePatches` is an ordered list of patch names. The stack is
these in order (chord held aside), then shift companions, then
chord at the very end.

- `_host` on a patch — the overlay gate. If a patch has a
  `_host`, it only applies while one of its hosts is also in
  `activePatches`.
- `layerButton, from, to` — swap the named patch. No-op if
  `from` isn't active. Intercepted when shift is held: enters
  the chord instead.

Three single mutations, plus one batched:

```js
addPatch(name)             // append, one recompute
removePatch(name)          // delete by name, one recompute
replacePatch(from, to)     // swap in place, one recompute
_batchPatches(mutator)     // N edits, one recompute
```

`addPatch` / `removePatch` / `replacePatch` each fire
`_recompute` (which rebinds and repaints), then
`_onPatchChange(from, to)`.

`_batchPatches(mutator)` gives the mutator direct access to
`activePatches`, runs `_recompute` once when it returns, then
fires `_onPatchChange` once per patch name that appeared or
disappeared.

The mutator must not call `addPatch` / `removePatch` /
`replacePatch` — those re-enter `_recompute`. Splice the array
directly.

`_batchPatches` wraps the mutator in try/catch. If it throws,
`activePatches` is restored in place (identity preserved), a
`[k3] _batchPatches mutator threw: …` line is printed, and the
exception is rethrown. `_recompute` does not run on a failed
mutation.

Resolution: `_resolvePatch(name, seen)` shallow-merges parents in
order, then overlays the patch's own bindings. `_parentList(name)`
reads the `patch:` field. Cycle detection via the `seen` map —
a repeated name throws.

**Memoization.** `_resolvePatch` caches its merged result per
name in `this._resolvedPatchCache`. Patches are fixed at
construction and never mutated, so a resolved patch is stable
for the controller's lifetime. Returning the cached object keeps
`resolved[name]` references identical across recomputes — that's
what makes `_applyResolved`'s `oldCfgs[name] === cfg` short-circuit
fire, so unchanged bindings skip the hash and the rebind entirely.
Cycle detection still runs on the first resolution; the cache is
only written after a successful merge.

**Overlays vs views.** An overlay is a patch with `_host`. It
applies *in addition to* its host. A view (like the `loop`
layer) replaces the previous patch via `replacePatch`.

**Sibling layers do not inherit.** `CUE` and `LOOP` are siblings
— both are base patches with no shared parent. A cell defined in
`CUE` is not visible when only `LOOP` is in `activePatches`.
`ODD` inherits from `LOOP` via `patch: ['loop']`.

**Sibling clearing.** `toggleOverlay` takes an optional second
`args` entry — an array of patch names to remove before adding
the target.

**Shift companions on overlays.** `selectABShift` and
`fxRoutingShift` are shallow clones of their base patches. With
SHIFT held, `_collectShiftPatches` walks the active stack and
pushes shift companions in order; without a companion on the
overlay itself, `cueShift` (or `loopShift`) sits above the
overlay and shadows its grid cells.

## Patch name constants

`XoneK3.PATCH_NAMES` in `lib-core.js` names every patch the
runtime or the mode table references:

```js
XoneK3.PATCH_NAMES = {
    FOCUS_BASE:       'topShared',
    FOCUS_LAYOUT:     'fxLayout',
    TWODECK_BASE:     'twoDeck',
    TWODECK_A_LAYOUT: 'fxLayoutA',
    TWODECK_B_LAYOUT: 'fxLayoutB',
    MINI_BASE:        'twoDeckMini',
    MINI_LAYOUT:      'fxMini',
    CHORD:            'chord',
    CUE:              'cue',
    LOOP:             'loop',
    ODD:              'oddLoop',
    SELECT_AB:        'selectAB',
    FX_ROUTING:       'fxRouting'
};
```

Layout names are built by concatenating the base with an index
(1..4). The runtime uses `PN.FOCUS_LAYOUT + n` rather than
literal strings.

---

# 5. Top-half modes

Cat's top half has three layouts. All live in `CAT_LAYERS`.

```
focus mode:     topShared   + fxLayout<n>
twoDeck mode:   twoDeck     + fxLayoutA<n> + fxLayoutB<n>
mini mode:      twoDeckMini + fxMini<n>
```

## The mode table

`XoneK3.TOP_MODES` in `lib-controller.js` is the single source of
truth for what a mode is. Each entry lists:

- `owns` — every patch name that belongs to the mode (base +
  every layout variant). Used for unwinding.
- `activate(ctrl)` — returns the exact list of patches that
  should be active given the current focus selections.

`twoDeck.owns` lists both base and both column-layout families.
`twoDeckMini.owns` lists the mini base and its four layouts.

## Mode state

**There is no `this.topMode` field.** Mode is inferred from
`activePatches` by `currentTopMode()`:

```js
K3Controller.currentTopMode = function() {
    for (var mode in XoneK3.TOP_MODES) {
        if (this._patchActive(XoneK3.TOP_MODES[mode].owns[0])) return mode;
    }
    return null;
};
```

## Mode swaps

One method does the work:

```js
K3Controller.setTopMode(mode) {
    target = XoneK3.TOP_MODES[mode]
    ownedByAnyMode = {}
    for (m in XoneK3.TOP_MODES) for (name of TOP_MODES[m].owns) ownedByAnyMode[name] = true

    ctrl._batchPatches(function(patches) {
        // Walk backwards, splicing owned patches out in place.
        // insertAt ends up at the lowest index any owned patch
        // occupied, so non-owned patches (cue, overlays, …) keep
        // their relative order and the top-half block lands back
        // where it was.
        insertAt = patches.length
        for (j = patches.length - 1; j >= 0; j--) {
            if (ownedByAnyMode[patches[j]]) {
                patches.splice(j, 1)
                insertAt = j
            }
        }
        for (name of target.activate(ctrl)) patches.splice(insertAt++, 0, name)
    })
}
```

Non-owned patches keep their relative order and stay on the same
side of the top-half block. A focus → twoDeck → focus round-trip
is exact.

**Constraint.** The relative-order preservation assumes owned
patches are not interleaved with non-owned patches that must
stay in front of them. Every shipped boot stack satisfies that.
A custom stack that interleaves owned and non-owned patches can
move the non-owned tail past the re-inserted block. If you build
such a stack, splice owned patches out and replace them in
place rather than calling `setTopMode`.

Two funcs wrap `setTopMode`:

```js
F.toggleTopMode:  focus → twoDeck / twoDeck-family → focus
F.toggleMiniFx:   twoDeck → mini / mini → twoDeck / focus → no-op
```

Both read `currentTopMode()` first.

## `_resolveFxPatchName`

The single source of truth for "given an fx-pattern patch name,
which patch should it be right now?". Both `_syncFxLayout` and
the constructor's boot-time alignment call it.

```js
K3Controller._resolveFxPatchName(name) {
    m = /^fx(Layout[AB]?|Mini)(\d)$/.exec(name)
    if (!m) return undefined
    kind = m[1]
    if      (kind === 'LayoutA') want = 'fxLayoutA' + selectedFxA
    else if (kind === 'LayoutB') want = 'fxLayoutB' + selectedFxB
    else if (kind === 'Mini')    want = 'fxMini'    + selectedFxCurrent
    else                         want = 'fxLayout'  + selectedFxCurrent
    return this.patches[want] ? want : null
}
```

Three return values:

| Return | Meaning |
|---|---|
| `undefined` | `name` doesn't match the fx-pattern regex |
| `null` | `name` matches, but the target patch doesn't exist |
| `string` | the target patch name |

Adding a new layout family means extending the regex and adding
a branch here.

`_syncFxLayout` warns once when it sees a `null` — an fx-pattern
name present in `activePatches` with no matching target patch is
almost always a typo or a missing `patches:` entry. The warning
is per-boot and lists every missing name in one line.

## Boot

Boot picks a mode via `initialPatches`:

```
Cat / Kitten:   ['topShared', 'fxLayout1', 'cue']
oneK3:          ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
oneK3 miniFX:   ['twoDeckMini', 'fxMini1', 'cue']
```

The constructor aligns each `fx*` entry in `initialPatches` with
its side's boot selection before the first `_recompute`.

---

# 6. Timeline

Two timelines per channel. They describe *where the phrase
colouring reads from*; they don't move the playhead.

```
                     ┌──────────────────────────────────┐
                     │  TRACK    playposition           │
                     │  intro marker = beat 0           │
                     │  origin sets where "count 1" is  │
                     └──────────────────────────────────┘
                                    │
                                    │  (loop engages)
                                    ▼
                     ┌──────────────────────────────────┐
                     │  LOOP CLOCK                      │
                     │  accumulates playhead movement   │
                     │  through wraps — marches forward │
                     │  as if the loop played through   │
                     │  in sequence                     │
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

## Per-channel state shape

```js
{
    count: 1, active: false, hasBeat: false, loopActive: false,
    playing: false,
    displaySource: 'track',
    loopClock: { running: false, pos: 0, lastTs: 0, lastTrackPos: 0 },
    loopStartN: 0, loopEndN: 0,
    lastBeatRepaint: 0, lastBeatEdge: 0, lastPositionSync: 0
}
```

`_freshDeckState()` in `lib-controller.js` returns a new object
with these fields. Adding a field means editing one place.

## Origin

The **origin** is the beat number where "count 1" sits. Expressed
in track-position terms, but shared by both timelines.

```js
_phraseOrigin = { 1: 0, 2: 0, 3: 0, 4: 0 };
```

`count = absolute_beat - origin + 1`. Because every reading
subtracts the same origin, shifting it shifts both readings
automatically.

Writers, all through `_setPhraseOriginAt(ch, pos, opts)`:

| Func | Source of position |
|---|---|
| `hotcueWithPhraseCheck` | `hotcue_N_position / track_samples`, gated on `hotcue_N_color` being in `PHRASE_MARKER_COLORS`. Passes `{ rawPos: true }` — a hotcue is a physical position, and the origin must land on that beat, not on the accumulated virtual count |
| `setPhraseOriginHere` | Displayed timeline: `playposition` in track mode, `loopClock.pos` in loop mode. Exists but is unbound in shipped presets — the shift+`grid2_0` cell in `shiftPhraseCells()` has its `func:` line commented out. |

`_setPhraseOriginAt` picks the reference position based on
`displaySource` and `loopClock.running` — "here" means here on
the displayed timeline, not the raw playhead — **unless the
caller passes `{ rawPos: true }`.** In that case the passed `pos`
is used verbatim, regardless of display mode. Hotcue jumps use
this; a user who pressed a phrase-marker hotcue wants the origin
at that hotcue's beat, not at whatever the accumulated loop clock
happens to read.

It floors the fractional beat and syncs the count.

`_phraseOrigin` is **user intent**, not derived state. It survives
every non-load event: rebind, mode swap, shift, chord, clock
teardown, shutdown. Only two things reset it:

- `track_loaded` → `_resetBeat` → origin = 0 (intro start).
- The user hits a phrase-marker hotcue (or, if the
  `setPhraseOriginHere` binding is enabled, presses set-here).

## Beat maths

**Track metadata is cached per channel.** Duration, file BPM, and
`track_samples` are fixed for a loaded track — only
`track_loaded` changes them. Content bounds (intro / outro) are
*not* cached: markers can move mid-playback from the Mixxx UI.

**Incomplete reads are not cached.** The first `_trackMeta` call
can run during `init`, before the CO tree has populated
`duration` / `track_samples`. Caching a zero-duration result
there would freeze the values for the controller's lifetime —
the `track_loaded` observer only fires on track *change*, not on
preset reload, so a preset reloaded while a track is already
loaded would keep the zeros forever. `_trackMeta` therefore
writes the cache only when `duration > 0`. The next call (on the
first real `playposition` tick after the boot reopen) re-reads
and caches once the CO tree is settled.

```
_channelRate(ch)     uncached. Prefers rate_ratio; falls back
                     to 1 + rate. See "Playback rate" below.
_readFileBpm(ch)     uncached. Reads file_bpm; falls back to
                     bpm / _channelRate(ch).
_trackMeta(ch)       cached wrapper. { duration, fileBpm, samples }.
                     Only cached when duration > 0.
_fileBpm(ch)         thin wrapper over _trackMeta.
_beatF(ch, pos)      reads _trackMeta + _getContentBounds.
_trackBeatF(ch)      convenience: _beatF(ch, playposition).
```

`_beatF` — fractional beats from content start:

```
(pos - bounds.start) * meta.duration * meta.fileBpm / 60
```

`bounds.start` = `intro_start_position / track_samples`, or 0 if
unset/nonsensical. `bounds.end` = `outro_end_position /
track_samples`, or 1.

`_computeAbsoluteBeat(ch, pos)` floors `_beatF`. Floor not round.

## Source selection

`_cascadeCount(ch, trackBeatF)` picks the position source for the
cascade:

```js
_cascadeCount(ch, trackBeatF):
    if displaySource === 'loop' && loopClock.running:
        loopBeatF = _beatF(ch, loopClock.pos)
        if loopBeatF !== null:
            return floor(loopBeatF) - origin + 1
    return floor(trackBeatF) - origin + 1
```

Track mode reads `playposition` (via `trackBeatF`, computed from
the caller). Loop mode reads `loopClock.pos`.

**The pulse phase is not the count.** Whether the LED is in the
bright half or the dim half of the beat always comes from the
track position's fractional beat, in both modes. See
`_repaintFromPosition` and the `beat_active` handler. The loop
clock's `pos` never feeds the pulse — it's an accumulated
musical progress counter, not a phase reference.

`_phraseSourcePos(ch)` still exists as a legacy helper — it
returns `loopClock.pos` when loop mode is active, else
`playposition`. It's used by `inspect` and by older test
patterns; the cascade itself does not call it.

`_virtualBeatFor(ch)` is a read-only accessor that returns the
loop-mode cascade count (`floor(_beatF(ch, clock.pos)) - origin + 1`),
or `null` when not in loop mode. Same derivation as
`_cascadeCount`, exposed so `inspect('beat')` can show the loop
count separately from the `count` field (which reflects whichever
mode is displayed).

## Resolution

`_resolveDisplaySource(ch)` reads the loop clock's running state
and picks `displaySource`:

```
loop clock running  → 'loop'
otherwise           → 'track'
```

Called from every event that starts or stops the loop clock, and
from `track_loaded`. Sets `st.displaySource`, and if the channel
is the active deck, calls `_refreshDisplayFlags` so the three
derived flags update. Syncs the count when `displaySource`
changes.

There is no priority tunable. With one virtual clock, the
"which reading when both run" question does not exist.

## Playback rate

`_channelRate(ch)` returns the deck's playback multiplier, ~1.0
at unity.

**Mixxx's `rate` CO is the rate *slider position*, not a
multiplier.** For −7% pitch it returns roughly `-0.07`, not
`0.93`. `rate_ratio` is the actual ratio. `_channelRate` prefers
`rate_ratio`, falls back to `1 + rate` on builds without it.

Do **not** read `rate` directly with a `<= 0` guard. The slider
position is `<= 0` on every pitch-down AND at unity, so the
guard silently turns the multiplier into `1` and disables any
scaling. That bug shipped once — see §26.

## Loop clock — accumulation

The loop clock doesn't read the playhead directly. It
**accumulates progress**: every tick, `clock.pos` advances by
the amount the playhead *would* have moved if the loop played
through in sequence. This is what keeps the cascade in phase
across two decks: both accumulate musical time at the same rate
at the same tempo, regardless of which deck is looping.

Two accumulation strategies, selected by
`XoneK3.VIRTUAL_CLOCKS.loop.trackTempo`:

### Real-seconds (default, `trackTempo: false`)

```js
_startVirtualClock(ch):
    pos = playposition
    clock.pos = pos; clock.lastTrackPos = pos; clock.lastTs = now
    clock.running = true
    _resolveDisplaySource(ch)

_stopVirtualClock(ch):
    clock.running = false
    _resolveDisplaySource(ch)

_advanceVirtualClock(ch, newPos):
    clock = st.loopClock
    if !clock.running: return
    if VIRTUAL_CLOCKS.loop.trackTempo:
        delta = newPos - clock.lastTrackPos
        reversing = engine.getValue(group, 'reverse') > 0
        delta = applyLoopWrapAdjust(st, clock, delta, newPos, reversing)
        clock.pos += delta
    else:
        if play_indicator:
            dt = (now - clock.lastTs) / 1000
            if dt < 0: dt = 0        // backward NTP step guard
            rate = _channelRate(ch)   // rate_ratio, not rate
            clock.pos += (dt * rate) / duration
    clock.lastTrackPos = newPos
    clock.lastTs = now
```

`clock.pos` is in track-fraction units (same as `playposition`).

Real-seconds mode accumulates wall-clock time. It needs no wrap
detection — the wall clock doesn't know the playhead wrapped, so
the backward jump at wrap never reaches `clock.pos`. This is why
it's the default.

**Real-seconds mode is forward-only.** Reverse playback is not
handled here — a deck in reverse with a loop engaged will still
see `clock.pos` marching forward. Use `trackTempo: true` if you
need reverse-accurate accumulation. The comment on the `else`
branch in `_advanceVirtualClock` records this.

### Tempo-tracking (`trackTempo: true`)

Accumulates playhead deltas directly. Wrap detection is
direction-based: a jump opposite the playback direction is a
wrap.

```js
function applyLoopWrapAdjust(st, clock, delta, newPos, reversing) {
    if (!st.loopActive || st.loopEndN <= st.loopStartN) return delta;
    var loopLen = st.loopEndN - st.loopStartN;
    if (!reversing) { if (delta < 0) return delta + loopLen; }
    else            { if (delta > 0) return delta - loopLen; }
    return delta;
}
```

The old boundary-proximity test (both endpoints near opposite
loop boundaries) missed wraps on tight loops — a single tick
could cross the whole boundary region. Direction-based detection
catches every wrap.

Tempo-tracking handles reverse playback (real-seconds mode does
not) and lets pitch changes propagate exactly, because the delta
comes from Mixxx's own rate-scaled position. Set with
`XoneK3.VIRTUAL_CLOCKS.loop.trackTempo`.

**Single-wrap per tick.** `applyLoopWrapAdjust` corrects for at
most one wrap per tick. A loop short enough to wrap twice within
a single `playposition` update (i.e. a loop shorter than the
30 ms tick interval — well under 1/32 beat at any tempo) would
be one loop-length off. Not reachable in shipped configs.

### Both modes are rate-scaled

Real-seconds mode scales elapsed time by `_channelRate(ch)`
(`rate_ratio` with a `1 + rate` fallback). Tempo-tracking uses
`playposition` deltas, which Mixxx already rate-scales. Both
produce the same rate of accumulation at the same effective
tempo.

### Sub-beat loops

Sub-beat loops (1/8, 3/16, odd fractions) work correctly. The
loop wraps many times per beat; each wrap adds the loop length
back to `clock.pos`, so the count still advances one beat per
beat. The pulse will look erratic — that's Mixxx's
`beat_active` timing on sub-beat loops, and the cascade doesn't
depend on it.

## Derived flags

Three booleans on the controller, always reflecting the *active*
deck:

```js
activeDeckVirtual      = (displaySource !== 'track')
activeLoopVirtual      = loopClock.running
activeDisplaySource    = displaySource
```

`_refreshDisplayFlags()` is the only writer of these fields. It
reads the active deck's state and assigns; it does **not** return
whether anything changed, and it does not fire a repaint itself.

**`_refreshActiveAlt` calls `_refreshDisplayFlags`** and does not
repaint. It runs from inside the recompute cycle — from the
constructor, `setSelectedFor`, `setActiveDeck`, `setActiveFx` —
so the enclosing `_refreshAllLeds` handles the repaint.

**All three focus setters use the same refresh discipline** —
`setSelectedFor`, `setActiveDeck`, `setActiveFx`. Each calls
`_reapplyByTokens(tokens, { skipRefresh: true })`, then
`_syncFxLayout()`. `_syncFxLayout` runs its own recompute (and
therefore its own `_refreshAllLeds`) when it actually swaps a
layout patch; when it doesn't swap, the setter calls
`_refreshAllLeds('<why>')` directly. One repaint per focus
change, on every path. See §7, §8.

The three callers *outside* a recompute — `_resolveDisplaySource`
(when it changes the active deck's `displaySource`), `_resetBeat`
(when the channel is the active deck), and `cycleDisplaySource` —
call `_refreshAllLeds('<why>')` themselves after updating the
flags. The flag-reading LEDs (`grid2_0` on `activeDeckVirtual`,
`grid3_1` on `activeDisplaySource`) have no CO connection, so
without the explicit refresh the toggle only appears after the
next recompute. `_closeBeatClocks` is the exception: it runs
inside `_syncBeatClocks` ← `_refreshAllLeds`, so no extra call is
needed.

There is no `_refreshDisplayFlagsAndRepaint` helper. The flags
are read by `colorScheme.on.state` bindings; any repaint that
follows the flag update picks up the new values, and the three
non-recompute callers make sure that repaint happens.

## Display cycle

`cycleDisplaySource` is bound to both CUE `grid2_0` and LOOP
`grid2_0`. It toggles `displaySource` between `'track'` and
`'loop'`. No-op when the loop clock isn't running — track is the
only reading then. The manual choice sticks until the next start
/ stop event re-resolves.

---

# 7. Focus

Two independent focus concepts. Both share the same shape.

```
Slot state:                    Derived:
  activeDeck : 'A' | 'B'         selectedDeckCurrent
  activeFx   : 'A' | 'B'         selectedDeckAlt
                                 selectedFxCurrent
  selectedDeckA : 1..4           selectedFxAlt
  selectedDeckB : 1..4
  selectedFxA   : 1..4
  selectedFxB   : 1..4
```

`_refreshActiveAlt()` recomputes the four derived fields and
calls `_refreshDisplayFlags`. Called from the constructor (after
`_decks` is built), then from `setSelectedFor`, `setActiveDeck`,
`setActiveFx`.

## setSelectedFor

Assigns a channel or unit to a slot, then re-applies every
binding that references the changed token. If the slot is FX,
also syncs the FX layout patch.

**Refresh discipline.** Both deck and FX pinning use the same
path: `_reapplyByTokens(tokens, { skipRefresh: true })`, then
`_syncFxLayout()`. `_syncFxLayout` runs its own recompute (and
therefore its own `_refreshAllLeds`) when it swaps a layout
patch; when it doesn't swap, the setter calls
`_refreshAllLeds('focus-deck')` or `_refreshAllLeds('focus-fx')`
directly. One repaint per call either way.

## setActiveDeck / setActiveFx

Set the active slot to A or B. Both call `_refreshActiveAlt` and
then `_reapplyByTokens(tokens, { skipRefresh: true })`, then
`_syncFxLayout()`. One repaint per focus flip via the same
`skipRefresh` + `_syncFxLayout` pattern as `setSelectedFor`.

`setActiveDeck` calls `_syncFxLayout` for symmetry with
`setActiveFx` — for a deck flip, `selectedFxCurrent` doesn't
change, so `_syncFxLayout` always returns `{ swapped: false }`.
The `_refreshAllLeds('focus-deck')` fallback is the live path.
`setActiveFx` genuinely can swap a layout patch (focus-mode
`fxLayout<n>` points at `selectedFxCurrent`), so it takes the
recompute-driven refresh when it does.

## _syncFxLayout

Scans `activePatches` for any entry that matches the fx-pattern
regex, resolves each to its target via `_resolveFxPatchName`,
and swaps via a single `_batchPatches` call. Collects swaps
first, applies after.

Returns `{ swapped: bool, reason: 'swapped'|'noop'|'missing' }`.
Callers use the return value to decide whether to refresh
themselves — `swapped: false` means no recompute happened and the
caller is responsible for the repaint. Missing targets warn once
per boot via `_warnOnce('fxLayoutMissing:<names>')`.

`fxLayout<n>` only exists in focus mode. `fxLayoutA<n>` /
`fxLayoutB<n>` only in twoDeck. `fxMini<n>` only in mini. Each
scan finds only its own family.

---

# 8. Routing via tokens

There is no runtime routing-func layer. Bindings reach the
currently-focused deck / FX by putting a token in their group
string. Tokens resolve at bind time, and `_reapplyByTokens`
re-applies any binding whose `_usedTokens` include the changed
token:

```js
K3Controller._reapplyByTokens = function(tokens, opts) {
    // Short-circuit: if the resolved target (after token
    // substitution) is identical to what the binding already
    // has, skip the rebind.
    var fingerprint = this._tokenFingerprint();
    for (var name in this.bindings) {
        var b = this.bindings[name];
        if (!b._usedTokens || !b._rawCfg) continue;
        var hit = false;
        for (var i = 0; i < tokens.length; i++) {
            if (b._usedTokens.indexOf(tokens[i]) !== -1) { hit = true; break; }
        }
        if (!hit) continue;
        var h = this._resolvedTargetHash(b._rawCfg, fingerprint);
        if (b._resolvedTargetHash === h) continue;
        this._applyBinding(name, b._rawCfg, fingerprint);
    }
    // Callers that will refresh themselves — all three focus
    // setters via _syncFxLayout — pass { skipRefresh: true }.
    // Direct callers refresh here.
    if (!(opts && opts.skipRefresh)) {
        this._refreshAllLeds('token-reapply');
    }
};
```

**The rebind is skipped when the resolved target is unchanged.**
`_resolvedTargetHash(cfg, fingerprint)` resolves every
token-bearing field (group / inKey / outKey / `cs.on.group` /
`cs.schemeFromState.{group,co}`) against the current focus, then
hashes the result. `b._resolvedTargetHash` is written by
`_applyBinding` at every successful bind and cleared on unbind. A
focus flip between two slots that resolve to the same channel no
longer disconnects and reconnects every token-carrying binding's
CO listeners.

**The hash is memoized per `(cfg, token fingerprint)`.**
`_resolvedTargetHashCache` is a `WeakMap` keyed on the cfg object
(owned by `_resolvePatch`'s memo, never mutated, collected with
the patch), with a `{fingerprint, value}` record. The fingerprint
is a positional, `|`-separated snapshot of every field in
`XoneK3.TOKENS` — derived, not counted. Any state change that
could alter a token's resolved value changes the fingerprint,
invalidating the entry without a walk. `_reapplyByTokens`
computes the fingerprint once per pass and threads it through, so
each binding's memo lookup is a WeakMap hit plus a string
compare, not a fresh `XoneK3.resolve` per field. The same
fingerprint is passed to `_applyBinding` when a rebind does
happen, so the hash write on the binding side hits the same memo
entry rather than recomputing the fingerprint.

The memo does not change the short-circuit semantics —
`b._resolvedTargetHash === h` still tests what `_applyBinding`
wrote at bind time against what the current state would produce.

**`skipRefresh`** lets a caller that will refresh itself (via a
follow-up `_syncFxLayout` + recompute, or an explicit
`_refreshAllLeds`) suppress the trailing refresh and avoid a
double repaint. **All three focus setters use it** —
`setSelectedFor`, `setActiveDeck`, `setActiveFx` — because all
three call `_syncFxLayout` afterwards and take the
`_refreshAllLeds` fallback when it doesn't swap. The trailing
`_refreshAllLeds('token-reapply')` is only the default for
direct `_reapplyByTokens` calls that don't have a follow-up
step.

`_usedTokens` is populated in `_collectTokens`. Both it and
`_validateBindings` share `XoneK3._tokenFields(cfg)`, which
enumerates every binding field that can carry a `$TOKEN$`:

```js
XoneK3._tokenFields = function(cfg) {
    var out = [];
    if (cfg.group  !== undefined) out.push(['group',  cfg.group]);
    if (cfg.inKey  !== undefined) out.push(['inKey',  cfg.inKey]);
    if (cfg.outKey !== undefined) out.push(['outKey', cfg.outKey]);
    var cs = cfg.colorScheme;
    if (cs && cs.schemeFromState) {
        if (cs.schemeFromState.group !== undefined)
            out.push(['schemeFromState.group', cs.schemeFromState.group]);
        if (cs.schemeFromState.co    !== undefined)
            out.push(['schemeFromState.co',    cs.schemeFromState.co]);
    }
    if (cs && cs.on && cs.on.group !== undefined)
        out.push(['on.group', cs.on.group]);
    return out;
};
```

Adding a new token-bearing field means editing `_tokenFields`
and `_resolvedTargetHash` — the two must stay in sync or the
short-circuit will miss a field. Both consumers pick it up.

The fingerprint derives from `XoneK3.TOKENS`: every state field
any token reads from is in the fingerprint by construction, so a
new token added to the registry is automatically covered. The
only remaining discipline is that a new token must be added to
`XoneK3.TOKENS` — which is already required for it to resolve at
all.

---

# 9. Chord

Two states interact: `isShifted` and `_chordActive`.

- `shift` press → `isShifted = true`.
- `layer` press while `isShifted` → `_enterChord()`.
- `layer` release while `_chordActive` → `_exitChord()`.
- `shift` release while `_chordActive` → `_exitChord()` then
  `unshift()`.

**Chord wins over shift companions.** `_buildStack` holds the
`chord` entry aside while building the stack and appends it
after the shift companions.

`layerButton` runs the check before its normal swap:

```js
if (pressed && ctrl.isShifted) { ctrl._enterChord(); return; }
if (!pressed && ctrl._chordActive) { ctrl._exitChord(); return; }
if (!pressed) return;
ctrl.replacePatch(args[0], args[1]);
```

Cat's chord binds five cells:

| Cell | Func |
|---|---|
| press0 | `toggleOverlay, ['fxRouting', ['selectAB']]` |
| press1 | `toggleOverlay, ['selectAB', ['fxRouting']]` |
| press3 | `shutdownHold` |
| pressR | `toggleTopMode` |
| pressL | `toggleMiniFx` |

`shutdownHold` is a 2-second hold. Releasing shift, layer, or
the binding cell cancels the timer via `Binding._reset`.

`_pulseCo(group, co, opts)` fires a CO high, then clears it on a
1 ms one-shot timer. `opts.deliberateLoopOff` marks the pulse as
an intentional loop-off for the escape detector — the channel
is added to `_expectingLoopOff` before the pulse fires.

---

# 10. Beat pipeline

## Count and pulse — separate sources

Two distinct quantities drive a beat-scheme LED:

- **The cascade count** — a 1-based beat number. Picks which
  cascade level (`prePhrase` / `phrase` / `bar` / `beat`) and
  which colour override applies. Track mode: derived from
  `playposition`. Loop mode: derived from `loopClock.pos`.
- **The pulse phase** — whether the LED is in the bright half or
  the dim half of the beat. Always derived from `playposition`'s
  fractional beat, in **both** modes.

This separation is what makes two decks stay in phase when one
of them loops. The loop clock's `pos` is a musical progress
counter, not a phase reference — reading it for the pulse would
put the two decks visibly out of sync the moment one looped.

```
   playposition ─────┐
                     │  (track beat F)
   loopClock.pos ────┤
                     │  (loop beat F)
                     ▼
              _cascadeCount(ch, trackBeatF)
                     │        ← displaySource picks which
                     ▼
                floor(...) - origin + 1
                     │
                     ▼
                beatLevel(beat, count)
                     │
                     ▼
          { level, color, brightness }
                     │
                     ▼
          _renderStatic / deviation
                     │
                     ▼
          applyBeat() → cascade

   ─────────────────────────────────────────

   playposition (track frac) ─────► st.active
                                    (bright / dim phase)
```

## The four-case matrix

The LED's colour is decided by two booleans: whether the LED is
logically on, and whether the current moment is in the off-phase
of a beat.

| logicalOn | beatOffPhase | isOn | LED shows |
|---|---|---|---|
| true | false | 1 | on-ramp + cascade |
| true | true | 0 | off-ramp |
| false | false | 0 | off-ramp |
| false | true | — | black (early return) |

The gate for "is this deck producing beats" is `st.hasBeat`, not
`st.count > 0`. `hasBeat` flips true on the first beat source
fired for that channel and stays true until `_resetBeat`.

## Phase helpers

`Binding._beatStateFor(compiled)` — shared preamble for every
beat-aware render path. `compiled` is the result of
`_evaluateScheme` (a compiled scheme with a `.beat` field when
the underlying scheme carries one). Returns the deck state for
this binding's scheme when the deck has seen at least one beat;
`null` otherwise.

`Binding._isBeatOffPhase(compiled)` wraps it with the
`!st.active` flip. Used by `_refreshColorScheme`.

## Two writers of `st.active`

- `beat_active` handler — high → `active = true`, low → `active
  = false`. Fires in both display modes.
- `_repaintFromPosition` handler — sets `active = trackFrac < 0.5`.

Both writers set `active` from the track's fractional beat, so
they agree. The `beat_active` path is preferred when edges
arrive; the position path covers the gap between edges and the
no-edge case (paused deck, gridless track).

The position handler skips *the pulse repaint* in track mode when
the deck is playing forward and a recent `beat_active` edge exists
(within 1.5 s). That's what prevents the flicker inside a loop.

It still calls `_syncBeatCount(ch)` before returning. Without that,
a dropped or throttled `beat_active` edge freezes the cascade colour
on the previous beat until the next edge happens to land on a
different level — which looks like eight greens in a row where cyan
should have fired. Position ticks are the only place that can catch
up. The pulse stays `beat_active`'s job; the count sync runs on
every tick.

`_refreshBeatLeds(ch)` filters by resolved beat deck. For a
binding whose scheme is a static beat block, that's
`_csScheme.beat.deck`. For a scheme-function binding it's the
last compiled result, `_csCompiledMemo.beat.deck`.

## `beatLevel`

```js
XoneK3.beatLevel = function(beat, count) {
    var bpb, ppb;
    var sig = XoneK3.TIME_SIG;
    if (sig) {
        bpb = sig.barBeats; ppb = sig.phraseBars;
    } else {
        bpb = beat.barBeats || XoneK3.DEFAULT_BAR_BEATS;
        ppb = beat.phraseBars || XoneK3.DEFAULT_PHRASE_BARS;
    }
    var phraseLen = bpb * ppb;
    var preBeats = (typeof beat.prePhraseBeats === 'number')
        ? beat.prePhraseBeats : bpb;
    ...
    var c = ((count - 1) % phraseLen + phraseLen) % phraseLen;
    var level;
    if (preBeats > 0 && c === preAt) level = 'prePhrase';
    else if (c === 0)                level = 'phrase';
    else if (c % bpb === 0)          level = 'bar';
    else                             level = 'beat';
    ...
    // cascade: prePhrase > phrase > bar > beat
};
```

**Counts are valid for any integer, including zero and
negatives.**

## Throttle

```
BEAT_REPAINT_THROTTLE_MS = 30
```

Two timestamps per channel, gated independently:

- `lastBeatRepaint` — `beat_active` path.
- `lastPositionSync` — `playposition` path.

## Clock connections

Six connections per channel, split across two arrays:

| Array | Connection | What it does |
|---|---|---|
| `_beatConns` | `beat_active` | Pulse source. Drives `st.active` transitions. |
| `_playConns` | `playposition` | Advances the loop clock every tick; position-tick repaint. |
| `_playConns` | `play_indicator` | Resyncs the clock anchor; sets `st.playing`. |
| `_playConns` | `track_loaded` | Clears `_trackMetaCache[ch]`, marks `_expectingLoopOff[ch]`, full reset, re-syncs beat clocks (belt-and-braces boot race fix). |
| `_playConns` | `loop_enabled` | Reads loop state; starts the loop clock on rising edge; on falling edge, stops the clock and calls `_checkLoopEscape`. |
| `_playConns` | `slip_enabled` | Count resync. |

Per boot with four channels: `_beatConns.length = 4`,
`_playConns.length = 20`.

`_openBeatClocks` uses a local `wire(conns, co, fn)` helper per
channel — the group string is captured once and pushed onto the
appropriate array. Same six connections, same order, same
handlers; the helper is just readability.

`_openBeatClocks` ends with a catch-up loop: it re-reads loop
state for every channel and starts the loop clock on any channel
where a loop is already enabled. CO connections fire on change,
not on setup, so a preset reload during an active loop would
otherwise leave the loop clock idle. The catch-up handles both
the initial open and the delayed reopen from `init`.

`_syncBeatClocks` is the only caller of `_openBeatClocks` /
`_closeBeatClocks`. Runs once per recompute cycle, from
`_refreshAllLeds`.

The gate is `_needsBeatClocks` — returns `this._beatLeds.length > 0`.
There's a safety net: when `_beatLeds` is empty, `_needsBeatClocks`
scans `this._applied` for any `colorScheme` that carries a
scheme function, a `schemeFromState`, or a static scheme with
`.beat`. That fires only when a prior `_applyBinding` threw
partway and later beat-carrying bindings never reached
`_attachBeatLed` — dead code in the shipped path, present so a
future regression doesn't silently close the clocks.

In shipped presets the clocks are effectively always open,
because `countdownScheme` carries `beat:` and is on the layer
and shift buttons. They close only if a custom config removes
every beat-carrying scheme from the stack. Closing also wipes
per-channel timeline state. `_phraseOrigin` is preserved — it
is user intent, not derived state.

---

# 11. Scheme pipeline

```
scheme ref (string | object | colour spec)
   │
   │  compileScheme(ref, overrides)
   │    resolveScheme(ref)
   │      - string: SCHEMES[name], then SCHEME_DEFAULTS
   │      - object with .colors: as-is + defaults
   │      - object without .colors: warn + null
   │    if the above produced a scheme with colors:
   │        _buildSegments(colors, ratio, brightness)
   │        _computeTmap(raw)
   │    else:
   │        resolveColorEntry(ref)  → single-colour fallback
   ▼
compiled: {
    on, off, co, marker,
    tmap: { position, curve },
    markerPosition, markerWidth,
    interp, calibration, brightnessScale, reverse,
    beat
}
```

**Single-colour schemes.** A bare palette name like `'magenta'`
resolves to a scheme with one colour.

Cached by name when `ref` was a string and no overrides were
passed.

Off-ramp is either `offScheme` compiled, or `on` with every
brightness dropped to `DEFAULT_RGB_BRIGHTNESS_OFF`
(`lib-core.js`).

**Partial objects** with no `colors` warn and return null. The
fix is `XoneK3.builders.composeScheme({ scheme: 'base', ... })`.

## t-composer

Two remaps compose in `sampleT`: **position, then curve**.

Position is applied first, so `schemePosition` slides the ramp —
including its curve pivot — through knob space. The shifted
input is clamped to `[0, 1]` before warping, so out-of-range
inputs hold the boundary segment colour. Warp is applied last,
so the curve's shape is preserved at every position.

```js
XoneK3.sampleT = function(compiled, t) {
    var m = compiled.tmap;
    if (!m) return t;
    t = t - m.position;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    if (m.curve !== 0) t = _warp(t, m.curve);
    return t;
};
```

**Warp** is a gamma with a fixed pivot at 0.5.
`CURVE_GAIN = 4.0`.

**Position** is `(schemePosition - 63.5) / 127`, subtracted
from the input `t` before clamping and warping.

**Bounds.** Out-of-range inputs clamp to 0 or 1 and hold the
boundary segment colour. With the old ordering (warp → shift →
clamp), out-of-range inputs sat on the near-saturated tail of
`warp`, so a shifted ramp looked smeared instead of holding a
clean edge colour. Reordering also preserves the curve's steep
pivot at every `schemePosition`, since the pivot survives the
shift-and-clamp instead of being eaten by the clamp.

## Co-matching

`XoneK3.coMatchSample(compiled, group, key, physical, isOn)` is
the shared helper for both `Binding._renderCoMatch` and
`LabController._renderCoMatch`. "Co-match" names the state
being detected (knob and CO agree); the ramp shown when they
disagree is the scheme named `coMatch`.

## _funcId

Funcs get a stable id on first sight, keyed by a module-scope
`WeakMap`. `_funcIdCounter` and `_funcIdMap` are both reset on
every boot — ids are boot-scoped, not session-scoped.

---

# 12. Render

Every render goes through `Binding._refresh`:

```
1. _csActive?  → _refreshColorScheme()
2. outKey?     → getValue(group, outKey), send on/off
3. neither     → nothing
```

`_refreshColorScheme`:

```
logicalOn = _isOn()

scheme = _evaluateScheme()

if !scheme:                      send black, done

beatOffPhase = _isBeatOffPhase(scheme)

if beatOffPhase && !logicalOn:   send black, done
isOn = logicalOn && !beatOffPhase

if !_csDeviation:  // static
    ramp = isOn ? on : off
    send ramp[0] with beat cascade, done

else:              // deviation
    knob = _csKnob
    if knob has never reported: send white hw 127, done
    physical = knob._normalized
    if scheme.co and knob has a CO:
        steer = coMatchSample(...)
        if steer: sample co-ramp, send, done
    dev = (physical - 0.5) * 2
    devDir = scheme.reverse ? -dev : dev
    if markerHit(scheme, devDir): send marker, done
    t = (devDir + 1) / 2
    ramp = isOn ? on : off
    sample, beat-apply, send
```

The beat gate sits *above* the ramp selection.

`_evaluateScheme()` resolves base + closure + ref-identity memo
into one compiled scheme or null. Split out of
`_refreshColorScheme` for readability. When a scheme function
returns a fresh object twice in a row with identical content,
`_warnOnce('csSchemeFresh:<binding>')` fires — the fix is
`XoneK3.builders.composeScheme` or hoisting the object out of
the closure.

## Calibration path

`_emitAt` splits into three named pieces:

```
_emitAt(rgb, hw)
   │
   ├── _channelEmit(rgb, hw)     →  [r, g, b]  linear emissions
   │      white-balance × transfer curve × channelPerceptual
   │
   ├── sum → Y                    total linear luminance
   │
   ├── Math.pow(Y, lumGamma)      perceptual compression
   │
   └── × (1 + hkBoost × sat)      saturation boost
```

## Flat target (cached)

`_flatTarget(segs)` scans the ramp's stops and returns the
minimum perceived luminance. Cached per-controller in
`this._flatCache`, keyed first by `segs._cacheId` (assigned
lazily when the segments array is first seen), then by
`_calibKey` on read:

```js
if (segs._cacheId === undefined) segs._cacheId = ++_segsCacheCounter;
var entry = this._flatCache[segs._cacheId];
if (entry && entry.key === this._calibKey) return entry.value;
// compute value
this._flatCache[segs._cacheId] = { key: this._calibKey, value: value };
```

Two controllers with different `_calibKey` no longer overwrite
each other's entries. The segments arrays are owned by
`XoneK3._compiledCache`, reset per boot, so the total number of
distinct entries per controller per boot is bounded by the
number of distinct schemes. `_segsCacheCounter` is module-scope
in `lib-controller-render.js`; it's global across controllers
but collision-free because ids are only ever assigned once per
segments array.

## Hardware solve (cached)

`_calibratedHw(rgb, targetLum)` bisects `_emitAt` over 12
iterations. Cached in `this._hwCache`, bounded at 1024 entries,
wiped when full.

## _isOn

Three sources, checked in order:

```js
Binding.prototype._isOn = function() {
    if (this._csOn !== null && this._csOn !== undefined) {
        if (this._csOn === true)  return 1;
        if (this._csOn === false) return 0;
        var s = this._csOn;
        // conditional shapes
    }
    if (this.group && this.outKey) return engine.getValue(this.group, this.outKey) > 0 ? 1 : 0;
    return 0;
};
```

`on:` shapes:

| Shape | Fields |
|---|---|
| `true` | *(boolean — `_csOn === true`)* |
| `false` | *(boolean — `_csOn === false`)* |
| `{ patchActive: 'name' }` | `{ patchActive: 'name' }` |
| `{ state: 'path' }` | `{ state: 'path' }` |
| `{ state: 'path', equals: V }` | `{ state, equals }` |
| `{ co: 'k', group: 'g' }` | `{ co, group: resolved }` |

Without `equals` or `contains`, the LED is on when the resolved
value is **truthy** (`v ? 1 : 0`).

**Lazy truthy re-check.** For `state` without `equals` / `contains`,
`_isOn` re-runs the "truthy by construction" test on every read
and fires `_warnOnce('csOnTruthyState:' + name)` the first time
the resolved value is a positive number or non-empty string.

**`_isOn` is the only site that fires this warning.** It runs on
the first LED render, not at bind. `_parseCsOn` does not read the
resolved state — there is no bind-time check. A binding
whose LED never renders (e.g. `noLED: true`, or a binding that
never lands in the active stack) will never surface the warning.
The dedupe is per-boot via `_warnOnce`.

`on.co` gets its own `engine.makeConnection` in `_parseCsOn`,
pushed onto `b._conns`. `_bindConns` skips the `outKey`
connection when `_csOn` is set, so `on.co` is the only listener
that repaints an `on.co` LED.

## schemeFromState list branch

`schemeFromState.list` is used as-is. The CO that feeds it
(`loaded_chain_preset`) is **0-based**. No offset. Out-of-range
clamps to the last entry.

---

# 13. Input mods and the rate gate

`Binding.input()` runs five stages in order:

```
1. _onInput(b)                  subclass hook, always fires
2. normalized update            knobs / faders only
3. rate gate                    only when the binding has a class
4. accel multiply               only when _accel is set
5. func dispatch or default
```

Then repaints every observer LED.

## 3. Rate gate

The gate sits *before* accel. A gated event never reaches the
func, never lands in `_accelEvents`, and never bumps the
per-binding self-stamp. Only accepted events feed the accel
window.

The gate applies to the *action* edge only: for buttons, only on
`v > 0`.

## 4. Accel

`_parseAccel` normalises the binding's `accel` field to
`{ amount, curve, window, fullAt }`.

**Accel** is a rate-driven multiplier:

```js
var rate = ev.length * 1000 / window;
var t = Math.min(1, rate / fullAt);
t = Math.pow(t, curve);
var reps = 1 + (amount - 1) * t;
```

`_accelEvents` persists across rebinds.

**Accel is inert without `func`.** The default input path writes
an absolute value once per MIDI event; repeating the write is a
no-op. `_auditBindingCfg` warns once per binding per boot when
`accel` is declared without a `func`.

## 5. valueCurve

Applies at write time, after `_scaleValue`. `_normalized` stays
uncurved.

## Self-accelerating funcs

A func can implement its own acceleration by tracking event rate
on `this`. When a func does its own accel, the binding must
**not** carry `accel:`. One source of acceleration per binding.

---

# 14. Binding hash

`_applyResolved` diffs hashes, not object identity.

```
patch config (cfg object)
    │
    │  _hashBinding(cfg)
    │    walks _BINDING_CFG_FIELDS, one entry per field
    │    _hashBindingValue(f, cfg[f]) serializes each
    ▼
"group\u0001inKey\u0001...\u0001colorSchemeJSON"
    │
    │  compared against previous hash for this control name
    ▼
same?  → skip (no rebind, no LED flicker)
diff?  → _applyBinding(name, cfg)
           _bindCore
           _auditBindingCfg
           _collectTokens
           _setupColorScheme
           _bindConns
           b._refresh()
```

`_applyResolved` also caches the cfg object reference per binding
name. If the resolved cfg object is identical to the previous
recompute's (`oldCfgs[name] === cfg`), the hash is reused rather
than recomputed. This short-circuit works because `_resolvePatch`
memoizes its output per patch name — a repeated recompute over
the same stack returns the same `resolved[name]` references, so
`oldCfgs[name] === cfg` holds for every unchanged binding.

Each per-binding `_applyBinding` call is wrapped via
`_safeBinding`. A throwing binding (bad scheme, transient CO
miss) warns once via `_warnOnce('applyBindThrow:<name>')` and
doesn't stop the rest of the pass — later bindings still reach
`_attachBeatLed`.

## _BINDING_CFG_FIELDS

```js
XoneK3._BINDING_CFG_FIELDS = [
    'group', 'inKey', 'outKey', 'type',
    'func', 'args',
    'valueCurve', 'softTakeover',
    'noLED', 'k2', 'accel', 'rate',
    'colorScheme'
];
```

Fields starting with `_` are structural metadata and are
deliberately skipped.

## _hashBindingValue

- `undefined` → empty string.
- `func` → resolved through `_funcId`.
- Objects / arrays → `_stableStringify`, key-sorted.
- **Strings** → `JSON.stringify(v)` (quoted, so a `|` inside a
  value can't shift the field boundary).
- Everything else → `String(v)`.

The JSON quoting is what makes string values unambiguous at the
join boundary. Without it, `group: 'a|b'` + `inKey: 'c'`
serialized identically to `group: 'a'` + `inKey: 'b|c'` and the
hash collided.

## _hashBinding

Joins the per-field parts with **`\u0001`** (SOH), not `|`. The
separator must be a character that cannot appear in a CO name or
numeric output. JSON-quoted strings (above) escape `\u0001`, so
a value can't inject the delimiter either. The hash is
per-session only, so the delimiter choice is invisible to
configs.

## _auditBindingCfg

Runs on every bind, gated on `_debugPrintsOn`. Warns about:

- cfg keys not in `_BINDING_CFG_FIELDS` (hash will miss them).
- `accel` declared without `func` (inert on the default input
  path).

---

# 15. _bindingDefaults

Standalone factory that returns every reset-able Binding field
at its default value. Called by both the `Binding` constructor
and `_reset`. Adding a new reset-able field means editing one
list, not three.

Session-scoped state lives outside the factory on purpose:

```
_normalized        — knob/fader position, survives reset
_accelEvents       — accel rate window, survives reset
_lastGateMs        — rate self-check stamp, survives reset
_loopAccelEvents   — self-accelerating func rate window
pressHeld          — BPM tap state
turnHappened       — BPM tap state
_ledObservers      — LED observers
_rateAccepted      — rate diagnostics counters
_rateGated
_rateLastAcceptedMs
_rateIntervals     — bounded ring of accepted gaps
```

---

# 16. _snapshotBinding

Before every `_reset`, `_applyBinding` calls `_snapshotBinding(b)`
to capture fields that `_unbind` and `_rearmSoftTakeover` need
after the wipe.

```js
XoneK3._SNAPSHOT_FIELDS = [
    ['group',   'group'],
    ['inKey',   'inKey'],
    ['type',    'wasPot'],
    ['_rawCfg', 'wasBound'],
    ['_noLED',  'wasNoLED'],
    ['_k2',     'wasK2'],
    ['idx',     'idx']
];
```

`_SNAPSHOT_IGNORED` lists every reset-able field that consumers
do not read. Anything reset-able that isn't in either list
triggers a boot-time warning.

`_resolvedTargetHash` (see §8) is a controller-set field, not
in `_bindingDefaults`, so the snapshot audit doesn't see it.
`_applyBinding` clears it to `undefined` on unbind and rewrites
it on every successful bind.

---

# 17. Bake

`bakeScheme(ref, ctrl, level)` — lab-only.

Three levels, sampled at 23 points (structural samples at the
segment count):

- **structural** — sample at the segment count, tmap applied.
- **sampled** — sample at 23 uniform points, tmap applied.
- **wire** — the above, plus the calibration solve. Marks
  `calibration: false`.

---

# 18. Lab model

`LabController extends K3Controller`.

```
_lab.edit             scheme buffer
_lab.slots[16]        null or a scheme object
_lab.previewSource    'edit' | 0..15 | registry name
_lab.previewing       bool
_lab.saveArmed        bool
_lab.previewPos       0..1
_lab.previewKnown     bool
_lab.previewOn        on-ramp vs off-ramp
_lab.selectedSegment  index, or -1 for marker
_lab.ratioEdit        bool
_lab.schemeName       cursor for registry scroll
_lab.beatTarget       target level or null
_lab._version         monotonic, bumped on every input event
_onBeat               fires on every beat edge
```

`_editableScheme()` returns `edit` when `colorLab` is active,
`null` otherwise.

`_previewScheme()` resolves `previewSource` to a scheme object.

`_labLEDScheme()` is what the strip paints.

`_commitPreview()` is the edit gate. Returns `_lab.edit` when
`previewSource === 'edit'`, `null` otherwise (with a warn-once
keyed `labEditWhilePreviewing`). Preview mode is preview-only —
the ~15 edit funcs that go through it are no-ops while
previewing, and no edit ever promotes the preview into the
buffer. The only paths from a preview into `_lab.edit` are the
explicit `_loadPreview()` (shift+R), `_editThis()` (slots
mode), and the armed-slot save in `_selectSlot`.

`_loadPreview()` is the explicit shift+R path in edit mode.
Resolves `_previewScheme()`, clones it into `_lab.edit`, resets
`previewSource` / `previewing` / `selectedSegment` / `ratioEdit`,
and repaints. No-op when `previewSource === 'edit'` or when the
preview doesn't resolve.

`_editThis()` is the slots-mode equivalent. Same buffer
replacement, plus `replacePatch('slots', 'colorLab')` to exit
slots mode.

`_onPatchChange(from, to)` handles the auto-bake when leaving
the `colorLab` patch and the mode prints.

`_applyAutoBake()` runs when preview lands on `'edit'` or slots
0..11.

`_needsBeatClocks` is overridden to keep beat connections open
whenever `_onBeat` is set.

The preview LED uses `st.hasBeat` to distinguish "pulse" from
"solid preview": the pulse path fires once the preview's deck
has produced at least one beat. Before the first beat, beat-edit
mode with a target selected shows the target's colour solid so
edits are visible without a running deck. `st.playing` is
diagnostic-only — printed by `inspect('beat')` and
`inspect('why')`, never consulted by a render path.

**Slot save and null preview.** `_selectSlot` guards against a
`null` preview: if `_previewScheme()` returns null while the save
arm is set (bad registry name, unpopulated slot, stale
`previewSource`), the arm is cleared and the press falls through
to a normal preview. Without the guard, `_lab.edit` could become
`null`.

**Preview render is exception-safe.** `_renderPreviewLED` wraps
its render path in try/catch. A user-authored scheme function
that throws (broken `SCHEMES` entry, bad `composeScheme` chain)
would otherwise propagate out of the beat handler and stop the
timer chain, leaving the LED frozen in its last-painted state.
On throw, the preview LED is painted black and `_warnOnce`
prints the message once per boot.

**Shutdown dump.** `LabController.shutdown` is overridden to run
the slot dump synchronously, before the parent's async sysex
drain. The base `_shutdownExtra` fires only after the LED queue
empties; dumping there would race the caller. `_shutdownExtra`
keeps the connection cleanup.

## Preview compile cache

Keyed on a monotonic version counter bumped by `_onInput` on
every physical event.

## Slot-0 preview chain

When `previewSource === LAB_SLOT.ON` (slot 0), `_previewCompiled`
wires slots 1–3 as compile overrides:

| Slot | Wired as |
|---|---|
| 1 | `offScheme` |
| 2 | `coScheme` |
| 3 | `offScheme` on the co ramp |

Missing slots fall through to engine defaults — no slot 1 →
generated off-ramp from slot 0's colours; no slot 2 → engine
`coMatch`; no slot 3 → generated off from slot 2's colours.
Only `_previewCompiled` does this. A normal `compileScheme`
call ignores slots 1–3 entirely.

## Binding discovery

Renderers do not hardcode which cell shows what. Every lab
painter asks for its cells by func reference via
`_findCellsByFunc`. `XoneK3.LAB_PAINTER_FUNCS` lists every func
whose cell is owned by a lab painter.

## Dump helper export

`emitSchemeLines` is exported as `XoneK3._emitSchemeLines`.

---

# 19. Mode prints

```js
XoneK3.MODE_PRINTS = false;    // default off
XoneK3.modePrint(line)
XoneK3.modePrintFirst(mode, hint)
```

Flipped on by the colorLab boot config (`modePrints: true`).

---

# 20. Builders

`XoneK3.builders` in `lib-funcs.js` produces binding objects for
common control shapes.

`composeScheme(opts, base)` resolves the base at config-eval
time.

Scheme-side helper: `XoneK3.coMatchSample(...)`.

---

# 21. Debug prints

Three separate channels:

| Channel | Gate | Reset on boot |
|---|---|---|
| `debugPrint` | `_debugPrintsOn` | no (persists) |
| `modePrint` / `modePrintFirst` | `MODE_PRINTS` | via `_modeSeen` |
| `_warnOnce` | none — always emits first occurrence | via `_warned` |

`debugPrint` walks `PRINT_TABLES` and uses the first table that
has the key.

`_warnOnce(key, msg)` prints `[k3] <msg>` the first time a given
`key` is seen. Cleared in `_bootWith`.

`_auditBindingCfg` fires per rebind, gated on `_debugPrintsOn`.
`_auditSnapshotFields` fires once per boot.

`_syncBeatClocks` prints one line when `_debugPrintsOn` is set:

```
[k3] _syncBeatClocks want=1 have=1 _beatLeds=2 applied=45
```

Read it: `want` is `_needsBeatClocks()`, `have` is whether the
connections are open, `_beatLeds` is the fast-path array length,
`applied` is the resolved binding count. A mismatch between
`want` and `have` at boot means the open/close decision is
wrong; `_beatLeds=0` with `applied=45` means a binding threw
during `_applyResolved` and the safety net is carrying the load.

## Escape detector

Separate from the debug prints. `_checkLoopEscape(ch)` is called
from the `loop_enabled` observer when the loop turns off.

---

# 22. Adding things

## Adding a scheme field

1. Add to `SCHEME_DEFAULTS`.
2. Consume it in `compileScheme`.
3. If it affects render, read it in `_refreshColorScheme` or
   `sampleT`.
4. If bake should preserve it, add to `bakeScheme`'s output.

## Adding a binding field

1. If it affects runtime behavior or LED output, add it to
   `_BINDING_CFG_FIELDS`.
2. If `_bindCore` should read it, add a branch there.
3. If it can carry a `$TOKEN$`, add it to `_tokenFields` AND to
   `_resolvedTargetHash`. The two enumerators must stay in sync
   or the token short-circuit in `_reapplyByTokens` misses it.
4. If it's reset-able, add it to `XoneK3._bindingDefaults`.
5. If it's reset-able and `_unbind` or `_rearmSoftTakeover`
   should read it, add it to `_SNAPSHOT_FIELDS`. Otherwise add
   it to `_SNAPSHOT_IGNORED`.
6. Turn on `XoneK3._debugPrintsOn` and reload.

## Adding a func

```js
XoneK3.FUNCS.myFunc = function(args, ch, c, v, s) {
    // this    = Binding
    // args    = cfg.args array
    // v       = MIDI value, s = MIDI status
};
```

LED state comes from `colorScheme` and its `on:` shape.

Rate gating is external. If the func moves a loop, add its name
to `_inferRateClass` or set `rate:` explicitly.

**If your func wraps an existing FUNCS method,** rate inference
by identity stops working — `_inferRateClass` sees an unknown
function reference. `_validateBindings` warns once per boot when
a binding has a custom func, a loop-adjacent `inKey`, and no
explicit `rate:`. The audit uses a deliberately broader inKey
pattern (`/^(beatjump_|beatloop_|reloop_|loop_)/`) than
`_inferRateClass`'s classifier — the classifier maps only
specific movement COs to specific classes and must not, e.g.,
label `beatjump_size` as `jump`. The two patterns look similar
and are intentionally different widths. Fix is to declare
`rate:` or `rate: false`.

## Adding a top-half mode

1. Define the base patch and its `_shift` companion in
   `xone-k3-cat-top.js`.
2. Define layout patches that inherit from the base; emitters
   live in `xone-k3-cat-fx.js`.
3. Add all of them to `CAT_LAYERS` in `xone-k3-cat.js`.
4. Add an entry to `XoneK3.TOP_MODES` in `lib-controller.js`
   (core file) with `owns` (every patch name) and
   `activate(ctrl)`.
5. Extend `_resolveFxPatchName`'s regex in `lib-controller.js`
   (core file) to recognise the new layout family.
6. Write a swap func (or extend `toggleTopMode` /
   `toggleMiniFx`) that calls `ctrl.setTopMode(mode)`.
7. Bind it on a chord cell.
8. Add the new files to every `.midi.xml` if new files, and to
   `test/harness.js`.

See CUSTOMISE §1.16 for the full walkthrough.

## Adding a rate class

Add to `XoneK3.RATE_CLASSES` in `lib-core.js`. Extend
`_inferRateClass` if new funcs should map to it automatically.

## Adding a beat-carrying scheme

Not currently supported beyond the loop clock. A second virtual
clock would need:

1. A new field on `_freshDeckState` (`lib-controller.js`).
2. A `which` parameter threaded through `_startVirtualClock` /
   `_stopVirtualClock` / `_advanceVirtualClock`
   (`lib-controller-beat.js`).
3. A per-clock `VIRTUAL_CLOCKS` entry.
4. A branch in `_cascadeCount` to pick between two running
   clocks — and a priority tunable, since the "which wins"
   question reappears.
5. A new start / stop caller.

The two-timeline model was chosen precisely to avoid (4).
Re-adding a second clock means re-adding a priority model.

## Adding a controller concern

If the new method group doesn't fit any of the five existing
controller files, add a sixth. Pattern:

```js
'use strict';
if (typeof XoneK3 === 'undefined') throw new Error(...);
if (typeof XoneK3._requireLoad !== 'function') throw new Error(...);
XoneK3._requireLoad('xone-k3-lib-controller-<name>.js',
    ['K3Controller', ...prereqs]);

(function() {
    XoneK3.K3Controller.prototype.myMethod = function() { ... };
})();
```

Then add the filename to every `.midi.xml` (5 files) and to
`test/harness.js`.

---

# 23. Tests

Run: `node test/run.js` from the controllers directory.

```
test/
  run.js               runner + assertions + per-test reset
  harness.js           loads lib + cat files into a vm sandbox
  helpers.js           ctrl(), bootCat(), bootLab(), bind(), send()
  mocks/
    engine.js          CO values, connections, timers
    midi.js            sysex + short msg capture

  ... test files
```

Test files share one vm sandbox. `test/run.js` resets a fixed set
of mutable globals before every test:

```
SYSEX_THROTTLE_MS, BEAT_REPAINT_THROTTLE_MS,
BEATJUMP_MIN, BEATJUMP_MAX,
ESCAPE_DETECT_WINDOW_MS, ESCAPE_HISTORY_MAX,
RATE_INTERVAL_SAMPLES, RATE_CLASSES (deep copy),
_debugPrintsOn, MODE_PRINTS, _warned, _modeSeen,
_funcIdCounter, _funcIdMap,
_schemeCache, _compiledCache,
VIRTUAL_CLOCKS, TIME_SIG,
engine and midi mocks, controllers array, print log.
```

`SCHEMES` is reset by `lib-schemes.js` on every reload — the
file clears `XoneK3.SCHEMES` and `XoneK3.COLORS` at eval time,
then re-registers `coMatch`, and every config file loaded after
it re-registers its own schemes. `run.js` therefore does not
need to reset `SCHEMES` itself; the harness's script evaluation
does it implicitly. A scheme removed from a config file is gone
after reload — no manual clearing required.

Adding a new mutable global on `XoneK3` means adding a reset
line to `resetGlobals()` in `run.js`. `_funcIdCounter` and
`_funcIdMap` are in this list — a test that boots two controllers
in sequence expects the second controller's func ids to start
from `_0`, not continue from the first.

Coverage:

```
schemes       — _warp, sampleT, sampleSegs, compileScheme
beat          — beatLevel, applyBeat, cascade, half
beatinherit   — applyBeat with one-field-per-level inheritance
beatdeck      — _resolveDeckRef, _deckStateFor, _isBeatOffPhase
beatsync      — lazy clock open/close, beat_active counters
countdown     — countdownScheme renders when deck playing / paused
onco          — on.co connection repaints LED when CO changes
fxlayout-batch — _syncFxLayout via one _batchPatches
clock-teardown — _closeBeatClocks preserves origin, resets deck state
calibration   — _channelEmit, _emitAt, _calibratedHw, _flatTarget
bake          — bakeScheme structural / sampled / wire
dumpformat    — emitSchemeLines default-elision
hash          — _stableStringify, _hashBinding, _funcId
patches       — _resolvePatch, _buildStack, _patchActive
fxlayout      — _resolveFxPatchName, _syncFxLayout
modes         — toggleTopMode, toggleMiniFx, setTopMode
top-modes     — TOP_MODES table, currentTopMode
overlays      — toggleOverlay, layerExitOverlay
selection     — _refreshActiveAlt, setSelectedFor, setActiveDeck
tokens        — resolve, _tokenFields, _collectTokens
render        — _refreshColorScheme end-to-end
lifecycle     — _applyBinding rebind / unbind / LED blanking
rate-gate     — _inferRateClass, _claimRate, Binding.input
escape        — detector, deliberate markers, inspect('rate')
pulse         — _pulseCo set/fire/clear, shutdownHold
warnings      — _warnOnce dedup, every warn-once call site
```

Not tested:

- Anything that requires a real Mixxx.
- Real LED bytes on hardware. `render.test.js` asserts against
  `midi._sysex`.
- Config file contents as data.
- Lab round-trip state machine.

---

# 24. Lint

`eslint.config.js` at the project root. Flat config, no plugins.

`no-implicit-globals` is on for runtime files. The single
`var XoneK3` declaration in `lib-core.js` carries an inline
disable with a comment explaining why.

---

# 25. Non-obvious

## Timelines

- **Track is the default.**
- **The origin is shared between both readings.**
- **`_beatF` has no `pos < 0` guard.** A position before the intro
  marker returns a negative fractional beat. `_cascadeCount` floors
  it to a negative count, `beatLevel` normalises via modulo, and the
  cascade shows the previous phrase's colours. Pre-start scrub
  cycles backward through the phrase instead of freezing the LED.
  The old `pos < 0 → null` guard froze the whole pipeline at
  `pos ≤ 0` (the tick handler returned early, no count update), which
  is what produced the "two whites at boot" bug — boot rendered
  `ramp[0]`, the pipeline went dead, then the first real tick
  rendered the same colour as count 1. One white, not two.
- **The loop clock accumulates, it doesn't read the playhead
  directly.** Every tick, `clock.pos` advances by the amount the
  playhead would have moved if the loop played through in
  sequence. This is what keeps two decks in phase when one loops.
- **Two accumulation strategies, same rate.**
  `trackTempo: false` (default) accumulates wall-clock time ×
  rate / duration; `trackTempo: true` accumulates playhead
  deltas with direction-based wrap correction. At the same
  effective tempo, both produce the same rate of accumulation.
- **Real-seconds mode needs no wrap detection.** The wall clock
  doesn't know the playhead wrapped, so the backward jump at
  wrap never reaches `clock.pos`. It is also forward-only —
  use `trackTempo: true` for reverse playback.
- **Wrap detection is direction-based, not boundary-based.** A
  jump opposite the playback direction is a wrap. The old
  boundary-proximity test missed wraps on tight loops.
- **The pulse is not the count.** `displaySource` picks which
  count the cascade reads. The pulse phase always comes from
  `playposition`'s fractional beat, in both modes. Reading
  `clock.pos` for the pulse desyncs two decks the moment one
  loops.
- **`_cascadeCount(ch, trackBeatF)` is the single count
  selector.** Track mode reads the passed `trackBeatF`; loop
  mode reads `_beatF(ch, clock.pos)`.
- **`_virtualBeatFor(ch)` is the read-only inspect accessor** for
  the loop-mode cascade count. Same derivation as
  `_cascadeCount`, exposed separately so `inspect('beat')` can
  show the loop count without running the render pipeline.
- **`_setPhraseOriginAt` has a `rawPos` opt-out.** Callers that
  need "here" to mean a physical position (hotcue jumps) pass
  `{ rawPos: true }`; the display-mode override is skipped.
- **`beat_active` is the pulse source in both modes.** Its edges
  drive `st.active` transitions; the cascade count does not
  depend on edge timing.
- **The recent-beat guard is what kills the flicker inside a
  loop.**
- **`_resolveDisplaySource` only runs on loop start / stop and
  `track_loaded`.**
- **`_refreshDisplayFlags` is the only writer of the three
  derived flags.** Called from `_refreshActiveAlt` (which runs
  inside the recompute), and from `_resolveDisplaySource`,
  `_resetBeat`, and `cycleDisplaySource` when the channel is the
  active deck. There is no separate "and repaint" variant — the
  three non-recompute callers call `_refreshAllLeds('<why>')`
  themselves, since the flag-reading LEDs have no CO connection.
  See §6.
- **All three focus setters refresh exactly once on every
  path** — `setSelectedFor`, `setActiveDeck`, `setActiveFx`.
  They all pass `{ skipRefresh: true }` to `_reapplyByTokens`,
  then call `_syncFxLayout()`. When `_syncFxLayout` swaps a
  patch, its own recompute handles the refresh; when it doesn't,
  the setter calls `_refreshAllLeds('<why>')` directly. See §7,
  §8.
- **Loop tempo tracking is read fresh on every advance.**
- **`_advanceVirtualClock` clamps `dt` to zero.** Date.now() is
  not monotonic; a backward NTP step would otherwise subtract
  from `clock.pos`, shifting the loop-mode cascade count
  backward until the clock caught up. Same defensive clamp as
  the rate gate's `elapsed()` helper, inlined locally because
  the helper lives in `lib-controller-boot.js` and
  `_advanceVirtualClock` is in `lib-controller-beat.js`.
- **`applyLoopWrapAdjust` only runs in tempo-tracking mode.**
  Real-seconds mode never needs it.
- **`_advanceVirtualClock` early-returns when the clock isn't
  running.**
- **`clock.pos` is in track-fraction units.**
- **The loop clock scales by `_channelRate(ch)`, not
  `[ChannelN],rate`.** Mixxx's `rate` CO is the slider position
  (~−0.08..+0.08) — a `<= 0` guard on it silently turns the
  multiplier into unity and disables the scaling on every
  pitch-down. `_channelRate` reads `rate_ratio` and falls back
  to `1 + rate` for older builds.
- **`_closeBeatClocks` preserves `_phraseOrigin`.** It resets
  per-channel timeline state (`count`, `hasBeat`, `active`,
  clock position, throttles) but leaves the origin alone — the
  origin is user intent.
- **`hasBeat` means "position is meaningful",** not "deck is
  playing". Set by `beat_active` edges, position ticks, and
  `_syncBeatCount`. It latches on the first beat and is only
  cleared by `track_loaded`. `st.playing` mirrors
  `play_indicator` and is diagnostic only — read by
  `inspect('beat')` and `inspect('why')`, never by a render
  path. The lab preview LED keys off `st.hasBeat`, not
  `st.playing`.
- **The loop clock is the only virtual timeline.** Two-timeline
  model: track + loop. `VIRTUAL_PRIORITY` does not exist, and
  the metronome clock was removed by design, not oversight.
- **Sub-beat loops work.** The count advances one beat per beat
  regardless of loop length. The pulse may look erratic — that's
  Mixxx's `beat_active` timing on sub-beat loops, and the
  cascade doesn't depend on it.
- **Boot-time beat-clock reopen.** `init` schedules a 250 ms
  one-shot that closes and reopens the beat clocks. On Mixxx
  startup, the first open can race the CO tree — connections
  register but never fire. `track_loaded` also re-syncs, as
  belt-and-braces.
- **`_openBeatClocks` catches up state on open.** CO connections
  fire on change, not on setup, so the tail of `_openBeatClocks`
  re-reads loop state and starts the loop clock for any channel
  with an already-active loop. Both the initial open and the
  delayed reopen go through this path.

## Caches

- **`_trackMetaCache` is per-channel and reset on
  `track_loaded`. Incomplete reads are not cached.** A
  `_trackMeta` call that returns `duration: 0` leaves the entry
  unwritten, so the next call re-reads after the CO tree
  settles. Without this guard, a preset reloaded while a track
  is already loaded caches zeros forever (the `track_loaded`
  observer only fires on track *change*, not on preset reload),
  and beat LEDs on that channel never start.
- **`_flatTarget` caches per-controller in `_flatCache`, keyed
  by `segs._cacheId` then by `_calibKey`.** Two controllers
  with different `_calibKey` no longer share an entry. The
  segments arrays are owned by `XoneK3._compiledCache`, reset
  per boot, so the entry count per controller per boot is bounded
  by the number of distinct schemes.
- **`_calibratedHw` caches on `_hwCache`, bounded at 1024.**
- **`_ledCache` and `_sysexQueue` are per-controller.**
- **The compiled scheme cache is reset per boot.**
- **`_blankLeds` stops the sysex drain timer and clears the
  queue before sending black.** Note-off sweep runs
  unconditionally — a previous session may have left K2 notes
  lit, and sysex blanks can't reach them.
- **`_resolvedPatchCache` is per-controller and set once at
  construction.** Patches never change, so it needs no
  invalidation.
- **`_resolvedTargetHashCache` is a WeakMap keyed on cfg,
  invalidated by the token fingerprint.** The fingerprint is
  derived from `XoneK3.TOKENS` — every field a token reads,
  joined positionally. A new token added to the registry is
  covered automatically; a new focus axis that any token reads
  from is covered automatically. The WeakMap key (the cfg
  object) is owned by `_resolvedPatchCache` and never mutated,
  so a cfg's resolved hash is stable as long as the fingerprint
  is.
- **`_funcIdCounter` and `_funcIdMap` are reset on every boot.**
  Ids are boot-scoped identifiers, not session-scoped. Without
  the reset, `inspect()` output showed `_47`-style ids whose
  value depended on how many times the preset had been reloaded.
- **`_resolvedTargetHash` is controller-set, not reset-able.**
  Set by `_applyBinding`, cleared to `undefined` on unbind.
  Not in `_bindingDefaults`, so `_auditSnapshotFields` doesn't
  classify it.
- **`SCHEMES` and `COLORS` are per-reload registries.**
  `lib-schemes.js` clears `XoneK3.SCHEMES = {}` and
  `XoneK3.COLORS = {}` on every evaluation, then re-registers
  `coMatch` and (via config files loaded after it) the preset's
  own schemes. Reloading is the way to remove a scheme you
  deleted from a config file — a scheme that's no longer defined
  in a config is gone after reload. Compiled-scheme references
  held by live bindings (`b._csScheme`, `b._csCompiledMemo`) are
  object references, not names, so they survive the clear; only
  name-based lookups during script evaluation could see a
  transient empty SCHEMES, and no render can fire mid-evaluation.

## Beat math

- **Warp is a t-remap, not a segment transform.**
- **`sampleT` order is position → curve.** `schemePosition`
  shifts the input first, the shifted and clamped input is
  warped second. This preserves the curve's shape at every
  position and holds the boundary segment colour out of range.
- **`BEAT_HOLD` is not a colour.**
- **The beat gate sits above ramp selection.**
- **`half` thins the beat level only.**
- **Marker bypasses the flat solve and does not beat-apply.**
- **Co-match rendering does not beat-apply.**
- **Beat counters are 1-based.**
- **The beat path has no timers.**
- **`st.hasBeat` is that channel's "deck is producing beats"
  test,** not `count > 0`.
- **Negative counts are legal.**
- **`Binding._beatStateFor` is the shared preamble.**

## Patches and bindings

- **Sibling layers do not inherit.**
- **`_recompute` always calls `_refreshAllLeds` internally.**
  `_reapplyByTokens` calls it internally unless the caller
  passed `{ skipRefresh: true }` (all three focus setters).
- **`_reapplyByTokens` short-circuits on resolved target.** The
  rebind is skipped when the resolved group / inKey / outKey /
  `cs.on.group` / `cs.schemeFromState.{group,co}` are identical
  to what the binding already has. Hash stored as
  `b._resolvedTargetHash` by `_applyBinding`. The hash itself is
  memoized per `(cfg, token fingerprint)` — see the Caches list.
  `_reapplyByTokens` computes the fingerprint once per pass and
  threads it through to both `_resolvedTargetHash` and
  `_applyBinding`, so a real rebind reuses the same fingerprint
  for its binding-side hash write.
- **`_refreshAllLeds` is re-entrancy-guarded.**
  `_refreshAllLedsDepth > 0` short-circuits the nested call.
  The only legitimate nested path is
  `_refreshAllLeds → _syncBeatClocks → _openBeatClocks →
  _startVirtualClock → _resolveDisplaySource →
  _refreshAllLeds('display-source')`. Skipping the inner call is
  safe: the outer call iterates every binding *after*
  `_syncBeatClocks` returns, so the new `displaySource` is
  picked up. Without the guard, a clock open during an active
  loop runs the full binding sweep twice.
- **`_safeBinding(fn, thisArg, args, warnKey, warnPrefix)` is the
  shared per-binding try/catch.** `_applyResolved` and
  `_refreshAllLeds` both route every per-binding call through it.
  One throwing binding warns once and does not stop the pass —
  later bindings still reach `_attachBeatLed` or `_refresh`. The
  method reference and its argument array are passed separately;
  the `args` array is constructed at the call site, so loop
  variables are captured by value before entering the helper.
  This makes the helper safe under any future change that makes
  it asynchronous or re-entrant — no closure over `var`-scoped
  names to go stale.
- **`_batchPatches` try/catches the mutator.** On throw, it
  restores `activePatches` in place (length 0 + repush), prints
  `[k3] _batchPatches mutator threw: <message>`, and rethrows.
  `_recompute` does not run on a failed mutation.
- **`setTopMode` preserves position.** Owned patches are
  stripped and the target's activate list is re-inserted at the
  lowest index any owned patch occupied, so non-owned patches
  keep their relative order across the top-half block.
- **Numeric `on.state` without `equals` warns once per binding,
  from `_isOn` only.** `_parseCsOn` does not read the resolved
  state — there is no bind-time check. A binding whose LED never
  renders (e.g. `noLED: true`, or never in the active stack)
  never fires the warning. `_warnOnce` dedupes so a first-render
  hit stays flagged for the session.
- **`_batchPatches` fires `_onPatchChange` once per changed
  name.** Not once total.
- **`_applyBinding` refreshes the binding at the end.** The
  recompute path also runs `_refreshAllLeds`, so the send is
  duplicated in compute but deduped by `_ledCache`. The refresh
  exists for callers that apply a binding outside a recompute
  (tests, `_reapplyByTokens` first pass, `H.bind`).
- **Hash cache relies on cfg object identity being stable.**
  `_resolvePatch` memoizes its output, so `resolved[name]`
  references are stable across recomputes over the same stack.
- **`_hashBinding` uses `\u0001` as the field separator and
  JSON-quotes string values.** A `|` inside a `group` or `inKey`
  can no longer shift the field boundary. Hashes are per-session
  only, so the change is invisible to configs.
- **`_onInput(b)` runs before the binding's func, on every
  physical event.**
- **Rate gating is per binding, not per func.**
- **`edit` and `jump` compose via the claim floor.**
- **`_lastLoopChangeMs` is the shared clock.**
- **The rate gate only fires inside an active loop.**
  `_claimRate` short-circuits via `_bindingInActiveLoop` when
  the binding's target channel has `loop_enabled = 0`, or when
  the binding doesn't target a `[ChannelN]` group at all.
  Out-of-loop claims don't touch `_lastLoopChangeMs` or
  `_lastRateClaim`, so the escape detector only sees claims
  that could actually have disturbed a loop. `_rateAccepted`
  still increments for diagnostics; `_rateGated` does not.
- **`rate: false` opts out of inference.**
- **`accel` does nothing on the default input path.**
  `_auditBindingCfg` warns once per binding per boot when `accel`
  is declared without a `func`.
- **Mod state survives rebind.**
- **Soft-takeover bridge.** When `_rearmSoftTakeover` runs on
  rebind, Mixxx is uninitialized and drops the next write unless
  it lands within Mixxx's own tolerance (~1/128) of the current
  CO. A physical already near CO at rebind — the common case when
  switching back to a deck whose fader/knob hasn't moved — can get
  stuck at the endpoint, because no physical step crosses Mixxx's
  tolerance from the endpoint. `_rearmSoftTakeover` bridges this:
  if `|CO - physical| ≤ TAKEOVER_EPSILON`, it writes CO's own
  value back to itself. Diff is zero, Mixxx's check passes,
  `initialized` flips, subsequent writes are accepted regardless
  of step size. `TAKEOVER_EPSILON = 2/127` is deliberately larger
  than `CO_MATCH_EPSILON = 1/127`: the LED claims "matched" only
  inside the smaller band, so any matched display implies the
  bridge has fired and control is live. The 1/127–2/127 gap is a
  false-negative window — LED shows unmatched while control is
  already active — harmless because the user keeps turning until
  the LED matches, at which point control has been live all along.
- **`valueCurve` doesn't touch `_normalized`.**
- **Bare partials warn and fail.**
- **Boot-white.** A deviation LED whose knob hasn't reported
  shows white at hw 127.
- **`_trimTrailingZeros` protects the selected segment.**
- **Hash is order-insensitive.**
- **LED on/off state comes from `colorScheme.on`, or `outKey`,
  or nothing.**
- **`_isOn` returns `v ? 1 : 0`** for state without `equals` or
  `contains`.
- **`_patchActive` is the source of truth.**
- **`_buildStack` puts chord last.**
- **No `base` patch.**
- **Beat clocks are lazy but effectively always open in shipped
  presets.** `_needsBeatClocks` returns `_beatLeds.length > 0`,
  with a fallback scan of `_applied` when the array is empty —
  dead code in the shipped path, present so a future
  `_applyBinding` throw doesn't silently close the clocks.
- **`on.co` gets its own connection.** `_parseCsOn` pushes an
  `engine.makeConnection` for `on.co` onto `b._conns`.
  `_bindConns` skips the `outKey` connection when `_csOn` is
  set, so this is the only listener that repaints an `on.co`
  LED.
- **Lab renderers discover cells by func reference.**
- **`track_loaded` also resets a channel's beat counter.**
- **`_paintRGB` parameter `b` is blue.**
- **Rebinding a func changes the hash.**
- **`_findCellsByFunc` keys by `_funcId`, not `fn`.**
- **Routing is token-based, not func-based.**
- **`_refreshActiveAlt` calls `_refreshDisplayFlags`.**
- **`_resolveFxPatchName` returns `undefined` for "not mine",
  `null` for "mine but missing", string for the target.**
  `_syncFxLayout` warns once per boot when it sees a `null` —
  the list of missing names goes into the warn key so a second
  scan with the same missing set dedupes.
- **`_syncFxLayout` batches all swaps into one
  `_batchPatches`.**
- **Mode swaps are chord bindings, not runtime state.**
- **Mode swaps use `_batchPatches`, not N `addPatch` calls.**
- **Group-enable cells use a single-colour scheme, not a ramp.**
- **`_warnOnce` dedupes per key per boot.**
- **`_unbind` does not read `b.softTakeover`.**
- **`_sendColor` short-circuits `mixxx`-typed LEDs when
  `isOn === 0`.**
- **`_pulseCo({ deliberateLoopOff: true })` sets
  `_expectingLoopOff[ch]` before firing.**
- **THEME is read live by every shipped emitter.** `deckSelect`
  / `fxSelect` / `routeTo` (both overlays), `slotIndicator` /
  `activeSlotButton` (press rows), `fxScheme`, `FX_SCHEME_MAP`,
  `FX_COLOR_MAP`, `slipScheme` — all wrap THEME in a function
  scheme or a deferred map entry, so a runtime mutation
  propagates on the next repaint of an affected LED. `selDeck*`
  / `selFx*` / `btnLoadA` / `btnLoadB` are still registered but
  unreferenced by shipped configs.
- **`bootCat` is the entry point for every non-lab preset.**
- **`_bootWith(devices, Ctor, label)` spawns one controller per
  entry.**
- **`_bindingDefaults()` is a standalone factory.**
- **`_hashBinding` is generated from `_BINDING_CFG_FIELDS`.**
- **`_auditBindingCfg` fires per rebind, not per boot.**
- **`_auditSnapshotFields` fires once per boot.**
- **`_snapshotBinding` is generated from `_SNAPSHOT_FIELDS`.**
- **`_emitAt` splits into `_channelEmit` + `_saturation`.**
- **`_tokenFields(cfg)` is the single field enumerator.**
- **The `_inferRateClass` and `_validateBindings` inKey
  patterns are intentionally different widths.** The classifier
  maps specific movement COs (`beatjump_forward`,
  `reloop_toggle`, `beatloop_activate`) to specific classes. The
  audit flags anything loop-adjacent
  (`/^(beatjump_|beatloop_|reloop_|loop_)/`) as a warning
  heuristic. Do not fold them into one predicate: the classifier
  must not label `beatjump_size` as `jump`.
- **Every file after `lib-core.js` throws on missing prereqs.**
- **`this.bindings` is the only name for the binding map.**
- **`_bindConns` skips the `outKey` connection when `_csOn` is
  set** — including `on: false` (`_csOn === false`). The gate
  checks `_csOn === null || _csOn === undefined` explicitly,
  not truthiness, so `on: false` correctly suppresses the
  `outKey` listener.
- **`countdownScheme` derives its A / B family from the raw
  group token,** not the resolved group.
- **Controller split means `.midi.xml` file lists must match.**
  A missing `lib-controller-*.js` in any preset's XML will throw
  at load. `test/harness.js` has the same list.
- **`_inferRateClass` matches func identity, not shape.**
  `_validateBindings` warns when a custom func + loop-adjacent
  `inKey` + no explicit `rate:` is detected — the binding has
  silently become `free`.
- **`_sendSysExLED`'s drain timer bails on an empty queue
  only.** There is no `_shuttingDown` bail — the drain is
  expected to run to completion even during shutdown, and
  `K3Controller.shutdown` relies on it (it polls
  `_sysexQueue.length === 0` before tearing down beat clocks).
  `_stopSysExDrain` is the explicit stop.
- **`_validateBindings` token warnings go through `_warnOnce`.**
  They fire once per boot regardless of `_debugPrintsOn` — a
  broken token is an error, not a hint. The rate warnings in the
  same function gate on `_debugPrintsOn`.
- **Unresolvable rate-class string names warn at bind time.**
  `_resolveRateClass` validates against `RATE_CLASSES` before
  storing the class on the binding. On a miss it warns via
  `_warnOnce('rateUnknown:' + name)` and stores `null`, so the
  binding becomes ungated — `Binding.input`'s
  `if (gateable && this._rateClass)` check short-circuits and
  `_claimRate` is never called with a bad string. The defensive
  `if (!cls) return true` inside `_claimRate` is a safety net
  for direct callers, not a live code path.
- **Unexpected `rate` types warn once and fall through to
  inference.** `rate: 5` or `rate: true` — where the author
  probably meant an object or a class name — fires
  `_warnOnce('rateBadType:' + typeof cfg.rate)`. `rate: true`
  is treated as "use inference" and does not warn.
- **`LabController.shutdown` runs the slot dump synchronously**
  before calling `K3Controller.prototype.shutdown`. Dumping from
  `_shutdownExtra` would race the async sysex drain. See §18.
- **`_selectSlot` guards against a null preview.** A null
  `_previewScheme()` while `saveArmed` is set clears the arm and
  falls through to a normal slot preview instead of writing
  `null` into `edit`.
- **`LabController._renderPreviewLED` is exception-safe.** A
  scheme function that throws paints the preview LED black and
  fires `_warnOnce`, instead of propagating out of the beat
  handler and stopping the timer chain.
- **`_evaluateScheme` warns on fresh-object identity.** A scheme
  function returning a new object each call recompiles every
  render. `_warnOnce('csSchemeFresh:<binding>')` fires once per
  binding. Fix: `XoneK3.builders.composeScheme` or hoist the
  object.

---

# 26. Debugging

Edit prints default off. Mode prints default off.

Warnings go through `XoneK3._warnOnce(key, msg)`. Each unique key
fires once per boot.

```js
XoneK3.controllers[0].inspect()             // top-level state
XoneK3.controllers[0].inspect('press0')     // one binding
XoneK3.controllers[0].inspect('patches')    // activePatches, stack
XoneK3.controllers[0].inspect('beat')       // clock, counters, timelines
XoneK3.controllers[0].inspect('tokens')     // token → bindings
XoneK3.controllers[0].inspect('dark')       // unbound bindings
XoneK3.controllers[0].inspect('rate')       // gate state, stats, escapes
XoneK3.controllers[0].inspect('rate', 'reset')   // zero counters
XoneK3.controllers[0].inspect('why', 'layer')    // pipeline walk for one binding
```

`inspect('why', name)` walks the render pipeline for a single
binding and prints where it stopped. It is read-only and safe to
call any time. Output covers: bound status, resolved COs, colour
scheme state, the last closure result of any scheme function,
the on/off source, clock presence, beat deck resolution, the
last frame written for the LED's index, and a plain-English
verdict.

| Symptom | Cause |
|---|---|
| Nothing lights | Preset not loaded. Reload. |
| `Xone K3: <file> requires <symbols>` at load | `<scriptfiles>` order in the `.midi.xml` is wrong. |
| `requires CAT` from cat.js | One of cat-schemes/fx/top/bottom/overlays didn't load. Check the `.midi.xml` or `test/harness.js`. |
| LEDs half-update on patch switch | A binding field is missing from `_BINDING_CFG_FIELDS`. |
| Soft takeover stops working after a rebind | A reset-able field is missing from `_SNAPSHOT_FIELDS`. |
| Fader stuck at endpoint after deck switch | Pre-bridge: Mixxx drops the first write because a single step exceeds its 1/128 tolerance, and a fader at max can't cross to re-enter tolerance. Now fixed by the bridge in `_rearmSoftTakeover`. |
| LED shows matched but no control | Should not happen — `CO_MATCH_EPSILON` (1/127) < `TAKEOVER_EPSILON` (2/127). If it does, the bridge in `_rearmSoftTakeover` isn't firing. Check `b._normalized !== undefined` at rebind time. |
| LED doesn't blank on unbind | Same class — `_unbind` needs a field that isn't in the snapshot. |
| Sysex queue grows without draining | Throttle timer died. |
| Beat doesn't pulse | Deck not playing, or clocks never opened. |
| Beat pulses but never goes black | `logicalOn` is true. |
| Beat doesn't follow deck selection | Token in `beat.deck` is wrong. |
| No beat after Mixxx startup until the preset is reloaded | The init-time beat-clock open raced the CO tree. Now fixed by `init`'s 250 ms reopen — if it still happens, bump the delay or check that `_shuttingDown` isn't tripping early. |
| Beat LEDs stay dark even after the 250 ms boot reopen | `_trackMeta` is caching incomplete values. Verify `_trackMeta` has the `if (meta.duration > 0) { this._trackMetaCache[ch] = meta; }` guard. If it does, check that `init`'s 250 ms timer is actually firing — a throw inside `_initExtra` before the timer is scheduled skips the reopen. |
| Loop clock doesn't resume after a preset reload during an active loop | Fixed by the catch-up loop at the end of `_openBeatClocks` — reads loop state on open and starts the clock for any channel with an already-active loop. |
| Beat colour sticks while playing; correct when jogged | A `beat_active` edge was dropped or throttled, and the position-tick guard's recent-edge branch returned before syncing the count. The LED stayed on the previous beat's colour until the next edge landed on a different level. Fixed: the guard now calls `_syncBeatCount` before returning. |
| Beat LED fires faster/slower than the audible beat on a pitched deck, loop reading only | Pre-fix bug: `_advanceVirtualClock` scaled by `[ChannelN],rate` (slider position), which a `<= 0` guard turned into unity. Now `_channelRate(ch)` reads `rate_ratio`. Track reading unaffected — `playposition` is already rate-scaled by Mixxx. |
| Two decks drift out of phase in loop mode at the same tempo | Should not happen with the accumulation model. Check that `_cascadeCount` reads `clock.pos` in loop mode, and that both decks are on the same accumulation strategy (`trackTempo`). Run `inspect('beat')` on both — the `count` fields should climb at the same rate. |
| Beat count jumps backward on tight loops | Pre-fix: `applyLoopWrapAdjust` used boundary-proximity detection and missed wraps. Now direction-based. If it still happens, check that `reversing` is being read correctly. |
| Beat LED drifts across loop iterations, both decks at unity | `duration × fileBpm / 60` is not an integer. `_beatF` is off by a small constant that accumulates. Snap `duration` in `_trackMeta` to the nearest beat-multiple, or switch the clock to `trackTempo: true`. |
| Pulse erratic in sub-beat loops | Expected — that's Mixxx's `beat_active` timing, not a bug. The cascade colour progression stays on the musical beat. |
| `prePhrase` never fires | `prePhraseBeats` clamped to `phraseLen - 1`. |
| Overlay toggle does nothing | Patch doesn't have `_host`, or host not active. |
| Mode swap does nothing | Chord not held, or the swap func doesn't see the expected base patch. |
| Mini mode won't reach focus | `setTopMode('focus')` should unwind every owned patch. Check `TOP_MODES` owns lists. |
| Mode swap flickers through intermediate stacks | Using `addPatch` / `removePatch` in a loop instead of `_batchPatches`. |
| `[k3] _batchPatches mutator threw: …` | The mutator hit an exception. `activePatches` was rolled back; check the func that called `_batchPatches`. |
| `[k3] _applyBinding(<name>) threw: …` | One binding's bind path threw. The rest of the pass continued; check the named binding's config. |
| `[k3] _refreshAllLeds: <name> threw: …` | One binding's render threw. The rest of the pass continued. |
| `[k3] colorScheme scheme function on <name> returns a fresh object each call` | Wrap with `composeScheme` or hoist the object out of the closure. |
| `[k3] lab preview render threw: …` | A lab scheme function threw. Preview LED painted black. |
| Group-enable LED is blue | Ramp scheme on a static LED. Use `FX_COLOR_MAP[n]`. |
| `[k3] _syncFxLayout: fx-pattern patch … has no matching target` | An fx-family patch name is in `activePatches` but missing from `patches:`. Typo, or the boot config references a layout index that doesn't exist. |
| `[k3] unknown rate class "…"` | A binding's `rate:` string doesn't match any registry entry. The bind is skipped for that class — the binding becomes ungated. Check `RATE_CLASSES` in `lib-core.js`, or fix the binding's `rate:` value. |
| `[k3] binding rate must be a string, object, false, or undefined — got …` | A `rate:` value of an unexpected type (`rate: 5`, `rate: 'jump'`-as-something-else). Warn-once; the binding falls through to inference. |
| Rate class isn't throttling | `inspect('rate')` — if the binding isn't listed, inference didn't classify it. Add `rate:` explicitly. |
| Rate class warning on boot | Custom func + loop-adjacent inKey. Add `rate: 'jump'` / `'edit'`, or `rate: false`. |
| `[k3] binding X declares accel but has no func` | `accel` does nothing without a custom func. Remove `accel`, or add a func. |
| Loop turned off unexpectedly | Search the log for `LOOP ESCAPE`. `inspect('rate')` shows claimed by. |
| Warning appears once, then disappears | `_warnOnce` deduped. Reload to re-arm. |
| `func:_47` style ids grow every reload | Was a `_funcIdCounter` reset bug. Now reset per boot — reload and ids start at `_0`. |
| Track colours are off, virtual is right | Intro marker isn't where you think. |
| Display doesn't switch from loop to track | Loop clock still running. Stop the loop; `_resolveDisplaySource` falls back to track. |
| `grid2_0` flashes but display doesn't change | Loop clock isn't running. Start a loop first. |
| Display toggle reads stale for one press | Pre-fix behaviour: the flag-reading LEDs repaint on the next recompute. Fixed by the three explicit `_refreshAllLeds` calls in `cycleDisplaySource`, `_resolveDisplaySource`, `_resetBeat`. |
| Beat LED flickers inside a loop | Two writers of `st.active` fighting. Both should agree now — they both read track frac. |
| Layer button dark | Not the layer indicator — it's a track-end countdown pulse on deck A. Run `inspect('why', 'layer')`. |
| Numeric `on.state` LED always lit | Missing `equals`. Warning fires on first render, once per binding. |
| Lab preview LED frozen | A scheme function threw. Check the console for `lab preview render threw`. |

---

# 27. Rate limits

Every binding can carry a rate class. The gate sits in
`Binding.input()` — checked *before* the func dispatches. See
`XoneK3.RATE_CLASSES` in `lib-core.js`.

## Registry shape

```js
XoneK3.RATE_CLASSES = {
    jump:  { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 120, claimMs: 120 },
    edit:  { selfCheckMs: 10, selfScope: 'binding', jumpBlockMs: 60,  claimMs: 60  },
    claim: { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 0,   claimMs: 60  },
    free:  { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 0,   claimMs: 0   }
};
```

## Two timestamps

| Field | Scope | Purpose |
|---|---|---|
| `ctrl._lastLoopChangeMs` | controller | shared clock |
| `b._lastGateMs` | binding | per-binding self-check stamp |

`selfScope: 'none'` classes never write `b._lastGateMs`.

## Resolution

`K3Controller._resolveRateClass(cfg)` (in `lib-controller-boot.js`):

1. `cfg.rate === false` → null (no gate)
2. `cfg.rate` is a string → lookup in `RATE_CLASSES`
3. `cfg.rate` is an object → used inline
4. otherwise → `XoneK3._inferRateClass(cfg)`

`_inferRateClass` matches on `cfg.func` first, then on `cfg.inKey`:

```
encBeatjump, beatjumpButton, reloopToggleResetAnchor,
beatloopActivateResetAnchor          → 'jump'
encLoopMove, encLoopMoveAccel        → 'edit'
encBeatjumpStepScale                 → 'claim'
pressSetValue on beatloop_size       → 'edit'
pressSetValue on beatjump_size       → 'claim'
inKey beatjump_forward               → 'jump'
inKey beatjump_backward              → 'jump'
inKey reloop_toggle                  → 'jump'
inKey beatloop_activate              → 'jump'
```

The inKey branches are narrow and specific. They are *not* the
same pattern `_validateBindings` uses for its audit — see §22
and §25. Do not fold them together.

## The gate

```js
K3Controller._claimRate(b, rateSpec) {
    // rateSpec is pre-validated by _resolveRateClass at bind
    // time — string names resolve there and warn-once there.
    // The lookup here is defensive: direct callers (tests,
    // hypothetical future code) get a silent pass-through.
    cls = (typeof rateSpec === 'string')
        ? RATE_CLASSES[rateSpec]
        : rateSpec
    if !cls: return true

    now = Date.now()

    // 0. out-of-loop bypass. The gate's whole purpose is to
    //    keep rapid loop moves from destabilising an active
    //    loop. With no loop there is nothing to escape from —
    //    skip the gate, skip the clock and _lastRateClaim
    //    writes, don't record a gate. _rateAccepted still
    //    increments so inspect('rate') sees the event.
    if !this._bindingInActiveLoop(b):
        b._recordRateAccept(now)
        return true

    gated = false

    // 1. self-check
    if (cls.selfCheckMs > 0 && cls.selfScope === 'binding')
        if (now - b._lastGateMs < cls.selfCheckMs) gated = true

    // 2. jump-block
    if (!gated && cls.jumpBlockMs > 0)
        if (now - ctrl._lastLoopChangeMs < cls.jumpBlockMs) gated = true

    if (gated) { b._recordRateGate(); return false }

    // 3. claim
    if (cls.claimMs > 0) {
        // Claim floor algebra:
        //   _lastLoopChangeMs := now - jumpMax + claimMs
        // A subsequent jump-class event gates while
        //   (now' - _lastLoopChangeMs) < jumpMax
        // Substituting:
        //   now' - (now - jumpMax + claimMs) < jumpMax
        //   now' - now < claimMs
        // So the next jump-class event is blocked for exactly
        // `claimMs` ms from this claim — the class's declared
        // tail. jump.claimMs (120ms) is the reference.
        jumpMax = RATE_CLASSES.jump.jumpBlockMs
        floor = now - (jumpMax - cls.claimMs)
        if (ctrl._lastLoopChangeMs < floor) ctrl._lastLoopChangeMs = floor
    }

    // 4. self-stamp
    if (cls.selfScope === 'binding') b._lastGateMs = now

    // 5. diagnostics
    b._recordRateAccept(now)
    ctrl._lastRateClaim = { binding: b._name, className, ts: now }

    return true
}
```

**Step 0 — the out-of-loop bypass.** `_bindingInActiveLoop(b)`
reads `loop_enabled` on the binding's target channel. Returns
false when the binding has no group, the group isn't a
`[ChannelN]` group, or the channel's loop is off. True when the
loop is on.

Reads the CO directly rather than `_decks[ch].loopActive`
because the cached state is only fresh while beat clocks are
open — a custom config that drops every beat scheme closes the
clocks and leaves the cache stale. The CO is always accurate.

With the bypass in place, `_lastLoopChangeMs` only ever
reflects in-loop activity, so the escape detector never fires
on a claim made before the loop existed.

The `floor` calculation makes the classes composable: an `edit`
at 60 ms leaves a 60 ms tail; a `jump` reads the same clock and
waits its full 120 ms from that point.

**Unresolvable class names resolve at bind time, not at event
time.** `_resolveRateClass` runs during `_applyBinding`, checks
the string against `RATE_CLASSES`, and on a miss warns via
`_warnOnce('rateUnknown:' + name)` and stores `null` on the
binding. The binding then becomes ungated — `Binding.input`'s
`if (gateable && this._rateClass)` check short-circuits and
`_claimRate` never runs. A config typo therefore leaves the
control live but unthrottled, and the warn-once names the
missing class so you can fix it. `_claimRate`'s own defensive
string lookup is unreachable by design; it exists so that a
future code path calling `_claimRate` directly with an
unresolved string still allows the event through.

**Unexpected `rate` types warn and fall through to inference.**
`rate: 5` is a probable typo. Warn-once via
`_warnOnce('rateBadType:' + typeof cfg.rate)`. `rate: true` is
treated as "use inference" and does not warn.

## Why `edit` self-gates but `jump` doesn't

`jump` moves both loop boundaries at once — Mixxx re-anchors on
every event. `edit` moves one boundary (via the anchor trick), so
Mixxx has less state to update and tolerates a faster event rate.

## `encLoopMoveAccel`

Self-accelerating, but still gated. The gate runs *first*, so its
`_loopAccelEvents` window records only accepted events. Args:

```
[side, step, cap, divisor]
```

Window length is `XoneK3.ENC_LOOP_ACCEL_WINDOW_MS` (150 ms).

## Diagnostics

Three read-only consumers:

**`ctrl._lastRateClaim`** — `{ binding, className, ts }`.

**`b._rateAccepted` / `b._rateGated`** — counters.
`_rateIntervals` is a bounded ring of accepted-event gaps.

**`ctrl._escapes`** — bounded ring of loop-escape records.

Escape path:

```
loop_enabled observer
   │
   ├── 1 → 0 transition
   │
   ├── was it deliberate?
   │       _expectingLoopOff[ch] set — the marker is consumed
   │       either way. If within 1s: return silently.
   │       If stale: fall through to escape detection.
   │       (markers set by _pulseCo({deliberateLoopOff:true})
   │       and track_loaded)
   │
   ├── was it within ESCAPE_DETECT_WINDOW_MS of a claim?
   │       no  — return silently
   │       yes — record + (maybe) log
   │
   └── every escape is pushed to _escapes (bounded ring).
       The console print is deduped by (deck, claimedBy) within a
       100ms bucket — repeat escapes from the same binding in the
       same instant collapse to one line. Full detail is always
       available via inspect('rate').
```

## Audits

- `_validateBindings` (boot) has two halves. Token warnings route
  through `_warnOnce` and fire once per boot regardless of
  `_debugPrintsOn` — a broken token is an error, not a hint. The
  rate warnings gate on `_debugPrintsOn` and cover `rate: false`
  declared on something `_inferRateClass` would have classified,
  `rate:` disagreeing with inference, and custom func +
  loop-adjacent `inKey` + no explicit `rate:`.
- The escape detector logs, but doesn't mutate state.

## Not rate-limited

Overlay toggles, `toggleTopMode`, `toggleMiniFx`,
`cycleDisplaySource`. Rapid toggling is expensive but doesn't
corrupt state.

---

# 28. Limits

- `chain_selector` only steps ±1 through the QuickFX chain
  preset list. Not a readable index.
- Markers bypass the flat solve.
- Marker and co-match do not get beat cascades.
- Boot-white is session-scoped.
- Beat requires a playing deck.
- `barBeats` / `phraseBars` clamped 1..32 in the lab editors.
- `prePhraseBeats` clamped 0..`phraseLen - 1`.
- Bake samples at 23 points.
- No BPM read for the pulse.
- `LAB_PAINTER_FUNCS` is a flat list of function refs.
- THEME changes propagate live for every shipped emitter
  (`deckSelect`, `fxSelect`, `routeTo`, `slotIndicator`,
  `activeSlotButton`, `fxScheme`, `FX_SCHEME_MAP`,
  `FX_COLOR_MAP`, `slipScheme`). The `selDeck*` / `selFx*` /
  `btnLoadA` / `btnLoadB` schemes are still registered but
  unreferenced by shipped configs.
- The four `fxLayout*` / `fxMini*` patterns are the only top-half
  layout families the runtime knows about. Adding a fifth means
  extending `_resolveFxPatchName` and the mode table.
- **One virtual clock per channel** (the loop clock). Adding a
  second means re-adding a priority model — see §22.
- **The loop clock accumulates, it doesn't read the playhead
  position directly.** Real-seconds mode by default
  (`trackTempo: false`) — wall clock × rate / duration, forward
  only. `trackTempo: true` accumulates `playposition` deltas
  with direction-based wrap correction, and handles reverse.
- **Wrap detection only exists in tempo-tracking mode.**
  Real-seconds mode never needs it. `applyLoopWrapAdjust`
  corrects at most one wrap per tick.
- **`beat_active` drives the pulse in both modes.** The cascade
  reads `clock.pos` in loop mode; the pulse reads the track
  fraction. They are separate.
- **Sub-beat loops work for the count.** The pulse may look
  erratic — that's Mixxx's `beat_active` timing on sub-beat
  loops, not a bug in the cascade.
- **`_openBeatClocks` catches up state on open.** Loop clock
  starts for any channel with an already-active loop.
- **`_hwCache` bounded at 1024.**
- **`_flatTarget` is per-controller.** `_flatCache[segs._cacheId]`
  keyed by `_calibKey`. Two controllers no longer share an
  entry.
- **`_reapplyByTokens` short-circuits on resolved target.** The
  rebind is skipped when tokens resolve identically; a real
  focus flip between different channels still rebinds every
  token-carrying binding.
- **Sibling layers don't inherit.**
- **Two layer trees.** Playback presets share `CAT_LAYERS`;
  colorLab has its own.
- **Two presets on the same MIDI channel fight over outputs.**
- **Controller split is load-order sensitive.** Five files
  extend `K3Controller.prototype`
```