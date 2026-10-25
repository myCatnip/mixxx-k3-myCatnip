# Internals

Modify the runtime. Developer-only.

For concepts, see `CONCEPTS.md`. For shipped behaviour, see
`README.md`. For scheme fields, binding fields, colour spec, beat,
patches — see `CUSTOMISE.md`. This file is the engine.

---

# 1. Load order

```
xone-k3-lib-core.js               bootstrap, tunables, PATCH_NAMES,
                                  utilities, tokens, transfer curve,
                                  sysex math, beat math, K2 palette,
                                  VIRTUAL_CLOCKS, BEATJUMP_GAP_MS
xone-k3-lib-schemes.js            palette, scheme engine,
                                  LED_TRANSFERS, coMatchSample
xone-k3-lib-binding.js            Binding primitive, colour render
                                  path, snapshot field list
xone-k3-lib-controller.js         constructor, patch resolution,
                                  focus, TOP_MODES, chord, binding
                                  application, scheme resolution
xone-k3-lib-controller-colour.js  on: parser, schemeFromState
                                  closures, _setupColorScheme
xone-k3-lib-controller-beat.js    timeline, loop clock, display
                                  source, beat count, beat clocks
xone-k3-lib-controller-render.js  LED writes, sysex queue,
                                  calibration, ramp sampling,
                                  beatjump gate
xone-k3-lib-controller-boot.js    init / shutdown, MIDI wiring,
                                  boot, halt
xone-k3-lib-funcs.js              builders + XoneK3.FUNCS
xone-k3-lib-inspect.js            runtime state probes

xone-k3-cat-schemes.js            THEME, QFX_CHAIN_LIST,
                                  PHRASE_MARKER_COLORS, SCHEMES
xone-k3-cat-fx.js                 FX layout tables + emitters
xone-k3-cat-top.js                focus / twoDeck / mini bases
xone-k3-cat-bottom.js             cue / loop / oddLoop layers
xone-k3-cat-overlays.js           selectAB / fxRouting / chord
xone-k3-cat.js                    CAT_LAYERS assembler + bootCat()

xone-k3-kitten.js / -onek3.js / -onek3-minifx.js   boot overrides
```

colorLab replaces the cat-* files with its own tree:

```
xone-k3-lab.js             LabController, bakeScheme
xone-k3-colorlab.js        colorLab layers + boot
```

`lab.js` sits after `lib-funcs.js` — it references `XoneK3.FUNCS.*`
at load time for `LAB_PAINTER_FUNCS`.

**Why five controller files.** All extend `K3Controller.prototype`
— no new classes, no imports beyond `_requireLoad`. Split by
concern; each `.midi.xml` loads all five between `lib-binding.js`
and `lib-funcs.js`. Any change to the file list means editing
five `.midi.xml` plus `test/harness.js`.

| File | Concern |
|---|---|
| `lib-controller.js` | Constructor, patches, focus, modes, chord, binding application |
| `lib-controller-colour.js` | Colour-scheme parsing |
| `lib-controller-beat.js` | Timeline, loop clock, beat pipeline |
| `lib-controller-render.js` | LED writes, calibration, beatjump gate |
| `lib-controller-boot.js` | init / shutdown, MIDI wiring, boot |

**Cat split** — `cat-schemes → cat-fx → cat-top → cat-bottom →
cat-overlays → cat`. Each declares its own `_requireLoad` prereqs.

**Bootstrapping.** `lib-core.js` opens with `var XoneK3 = (typeof
XoneK3 !== 'undefined') ? XoneK3 : {};` — Mixxx's Qt engine shares
one global object across `<scriptfiles>`. Every other file opens
with `_requireLoad(file, prereqs)` which throws on missing symbols.

---

# 2. Architecture

## Request flow

```
   midi.on(note, v)
        │
        ▼
   Binding.input()
        │
        ├─ _onInput(b)
        ├─ accel / func / default write
        │
        ├─ _ledObservers[i]._refresh()

   (config change)
        │
        ▼
   _recompute() → _buildStack → _resolveStack
               → _applyResolved → _refreshAllLeds
```

## Non-obvious state

Beyond the binding map and `activePatches`, the controller carries:

- `_lastLoopTouchMs[1..4]` — per-channel timestamp of the last
  loop-touching event (beatjump gate)
- `_decks[1..4]` — per-channel timeline and beat state
- `_phraseOrigin[1..4]` — beat where "count 1" sits
- `_trackMetaCache{}` — per-channel `{duration, fileBpm, samples}`,
  cleared on `track_loaded`. Incomplete reads not cached (§6).
- `_flatCache{}` — per-controller `_flatTarget` cache, keyed by
  `segs._cacheId` then `_calibKey` (§12)
- `_calibKey` — hashes every `_emitAt` input
- `_resolvedTargetHashCache` — WeakMap<cfg, {fingerprint, value}>,
  memo for `_resolvedTargetHash` (§8)
- `_resolvedPatchCache{}` — memoized patch merges
- `_ledCache{}`, `_sysexQueue[]`, `_sysexTimer` — per-controller
  LED dedupe and drain
- `_recomputeDepth`, `_recomputeCompletedAt`,
  `_refreshAllLedsDepth` — phase tracking and re-entrancy guards

## The recompute cycle

```
_recompute()
  _buildStack       → [stack names]
  _resolveStack     → merged binding map
  _applyResolved    → hash diff; _applyBinding per changed binding
  _afterRecompute   → subclass hook
  _refreshAllLeds   → _syncBeatClocks, then b._refresh() per binding
```

`_recompute` ends with `_refreshAllLeds`. **Callers do not refresh
after.** `_reapplyByTokens` ends with the same call unless the
caller passed `{ skipRefresh: true }` (§8).

One physical control is one `Binding`.

---

# 3. Boot and multi-device

`XoneK3.boot(devices)` / `bootLab(devices)` → `_bootWith(devices,
Ctor, label)` constructs controllers and resets boot-scoped state
(`_schemeCache`, `_compiledCache`, `_warned`, `_modeSeen`,
`_funcIdCounter`, `_funcIdMap`, `_segsCacheCounter`). `ctrl.init()`
blanks LEDs, runs `_recompute`, `_initExtra`, `_validateBindings`,
and schedules a delayed beat-clock reopen.

**Boot-race catch-up.** The initial `_recompute` inside `init()`
opens the beat clocks. On Mixxx startup that first open can race
the CO tree — connections register but never fire. `init`
schedules a 250 ms one-shot that closes and reopens the clocks.
`_shuttingDown` guards a reload landing inside the delay window.
`track_loaded` also re-syncs, as belt-and-braces.

The reopen also protects `_trackMetaCache`: pre-open reads may
have returned incomplete metadata (CO tree not settled). Those
reads aren't cached (§6), so the first `playposition` tick after
reopen re-caches.

**`_funcId` reset.** `_funcIdCounter` and `_funcIdMap` are
boot-scoped. Without the reset, `inspect()` output showed `_47`-
style ids whose value depended on how many times the preset had
been reloaded.

Each controller owns its own binding map, sysex queue, beat clock
connections, LED cache, `_lastLoopTouchMs`, and caches.

`XoneK3.halt()` iterates `XoneK3.controllers`, calls `shutdown()`
on each, clears the array.

---

# 4. Patches

`activePatches` is an ordered list of patch names. The stack is
those in order (chord held aside), then shift companions, then
chord last.

- `_host` on a patch — the overlay gate. Applies only while one
  of its hosts is also active.
- `layerButton, from, to` — swap the named patch. Intercepted
  when shift is held: enters the chord instead.

Three single mutations plus one batched:

```js
addPatch(name)             // append, one recompute
removePatch(name)          // delete by name, one recompute
replacePatch(from, to)     // swap in place, one recompute
_batchPatches(mutator)     // N edits, one recompute
```

`_batchPatches(mutator)` gives the mutator a **copy** of
`activePatches`. It may mutate the copy in place or return a
fresh array — whatever ends up in the copy (or in the return)
becomes the new `activePatches`. `activePatches` is untouched
until the mutator returns cleanly, so a throw needs no rollback.

`addPatch` / `removePatch` / `replacePatch` **throw** when called
from inside a mutator. Nested `_batchPatches` throws too.

Resolution: `_resolvePatch(name, seen)` shallow-merges parents in
order, then overlays the patch's own bindings. Cycle detection via
`seen`; a repeated name throws.

**Memoization.** `_resolvePatch` caches its merged result per
name in `_resolvedPatchCache`. Patches are fixed at construction,
so a resolved patch is stable for the controller's lifetime.
Returning the cached object keeps `resolved[name]` references
identical across recomputes — that's what makes `_applyResolved`'s
`oldCfgs[name] === cfg` short-circuit fire.

**Sibling layers do not inherit.** `CUE` and `LOOP` are siblings.
`ODD` inherits from `LOOP` via `patch: ['loop']`.

## Patch name constants

`XoneK3.PATCH_NAMES` in `lib-core.js`:

```js
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
```

Layout names are built with `PN.FOCUS_LAYOUT + n`.

---

# 5. Top-half modes

```
focus mode:     topShared   + fxLayout<n>
twoDeck mode:   twoDeck     + fxLayoutA<n> + fxLayoutB<n>
mini mode:      twoDeckMini + fxMini<n>
```

`XoneK3.TOP_MODES` in `lib-controller.js`:

- `owns` — every patch name belonging to the mode, for unwind
- `activate(ctrl)` — patches to add given current focus

Mode is inferred from `activePatches` by `currentTopMode()`.
There is no `this.topMode`.

## Mode swaps

`setTopMode(mode)` unwinds every patch owned by any mode, then
re-inserts the target's activate list at the position where the
first owned patch sat. Non-owned patches keep their relative
order. One `_batchPatches`.

Wrappers:

```
F.toggleTopMode:  focus → twoDeck family → focus
F.toggleMiniFx:   twoDeck → mini / mini → twoDeck / focus → no-op
```

## `_resolveFxPatchName`

Single source of truth for fx-pattern → live patch name:

```js
m = /^fx(Layout[AB]?|Mini)(\d)$/.exec(name)
if (!m) return undefined
kind = m[1]
LayoutA → 'fxLayoutA' + selectedFxA
LayoutB → 'fxLayoutB' + selectedFxB
Mini    → 'fxMini'    + selectedFxCurrent
else    → 'fxLayout'  + selectedFxCurrent
```

Returns `undefined` (not mine), `null` (mine but missing target),
or the target name. `_syncFxLayout` warns once per boot on `null`.

Adding a new layout family: extend the regex, add a branch.

## Boot mode

Boot picks via `initialPatches`:

```
Cat / Kitten:   ['topShared', 'fxLayout1', 'cue']
oneK3:          ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
oneK3 miniFX:   ['twoDeckMini', 'fxMini1', 'cue']
```

The constructor aligns each `fx*` entry with its side's boot
selection before the first `_recompute`.

---

# 6. Timeline

Two timelines per channel. They describe *where the phrase
colouring reads from*; they don't move the playhead.

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

## Per-channel state

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

`_freshDeckState()` in `lib-controller.js` returns a fresh one.

## Origin

`_phraseOrigin[ch]` — the beat where "count 1" sits. Derived from
marker hotcues (`PHRASE_MARKER_COLORS`) by
`_deriveOriginFromPosition`. Writer runs on every throttled
playposition tick, `track_loaded`, and any hotcue colour /
position change.

Derivation: beat of the last marker at-or-before the playhead. If
no marker precedes but one exists ahead, origin anchors to the
first upcoming marker — pre-marker playback runs negative counts,
which `beatLevel` modulos through the phrase. If no marker exists
at all, origin is 0.

Frozen in loop mode. `_resetBeat` (from `track_loaded`) is the
only hard reset. No manual setter — origin follows the playhead.

## Beat maths

Metadata cache: `duration`, `fileBpm`, `samples` — fixed for a
loaded track. Content bounds are read fresh (`bounds.end` can move
mid-playback).

Incomplete reads aren't cached. `_trackMeta` writes the cache only
when `duration > 0`. A preset reloaded while a track is already
loaded would otherwise cache zeros forever — `track_loaded` fires
only on track *change*, not on preset reload.

```
_channelRate(ch)     prefers rate_ratio, falls back to 1 + rate
_readFileBpm(ch)     reads file_bpm, falls back to bpm / rate
_trackMeta(ch)       cached wrapper. Only cached when duration > 0.
_beatF(ch, pos)      (pos - bounds.start) * duration * fileBpm / 60
_trackBeatF(ch)      _beatF(ch, playposition)
```

`bounds.start` = 0 unconditionally. Beat 0 is file start.
`bounds.end` = `outro_end_position / samples` — feeds only the
track-end countdown, never the cascade or origin.

## Source selection

```js
_cascadeCount(ch, trackBeatF):
    if displaySource === 'loop' && loopClock.running:
        loopBeatF = _beatF(ch, loopClock.pos)
        if loopBeatF !== null:
            return floor(loopBeatF) - origin + 1
    return floor(trackBeatF) - origin + 1
```

**The pulse is not the count.** Pulse phase (bright/dim half of
the beat) always comes from `playposition`'s fractional beat, in
both modes. Reading `clock.pos` for the pulse would desync two
decks the moment one looped.

`_virtualBeatFor(ch)` — inspect accessor for the loop-mode count.

## Playback rate

`_channelRate(ch)` returns the deck's playback multiplier.
Prefers `rate_ratio`; falls back to `1 + rate`.

`[ChannelN],rate` is the slider position (~−0.08..+0.08), not a
multiplier. A `<= 0` guard on it silently returns unity on every
pitch-down — see §21.

## Loop clock accumulation

The loop clock doesn't read the playhead. It **accumulates**:
every tick, `clock.pos` advances by the amount the playhead would
have moved if the loop played through in sequence.

`clock.pos` is in track-fraction units (same as `playposition`).

Two strategies, selected by `VIRTUAL_CLOCKS.loop.trackTempo`:

**`trackTempo: false` (default)** — real seconds.

```js
if (playing && clock.lastTs > 0) {
    var dt = (now - clock.lastTs) / 1000;
    if (dt < 0) dt = 0;         // backward NTP step guard
    clock.pos += (dt * _channelRate(ch)) / duration;
}
```

No wrap detection needed — the wall clock doesn't know the
playhead wrapped. Forward-only.

**`trackTempo: true`** — playhead delta.

```js
delta = newPos - clock.lastTrackPos;
reversing = engine.getValue(group, 'reverse') > 0;
delta = applyLoopWrapAdjust(st, clock, delta, newPos, reversing);
clock.pos += delta;
```

Wrap detection is direction-based: a jump opposite the playback
direction is a wrap.

```js
function applyLoopWrapAdjust(st, clock, delta, newPos, reversing) {
    if (!st.loopActive || st.loopEndN <= st.loopStartN) return delta;
    var loopLen = st.loopEndN - st.loopStartN;
    if (!reversing) { if (delta < 0) return delta + loopLen; }
    else            { if (delta > 0) return delta - loopLen; }
    return delta;
}
```

Handles reverse playback (real-seconds mode does not). Both modes
rate-scale at the same effective tempo.

Single-wrap per tick. A loop short enough to wrap twice within a
single `playposition` update would be one loop-length off. Not
reachable in shipped configs.

## Derived flags

```js
activeDeckVirtual      = (displaySource !== 'track')
activeLoopVirtual      = loopClock.running
activeDisplaySource    = displaySource
```

`_refreshDisplayFlags()` is the only writer. Called from
`_refreshActiveAlt` (inside recompute) and from
`_resolveDisplaySource`, `_resetBeat`, `cycleDisplaySource` when
the channel is the active deck. Those three call
`_refreshAllLeds('<why>')` themselves — flag-reading LEDs have no
CO connection, so the toggle otherwise only appears at the next
recompute.

## Display cycle

`cycleDisplaySource` toggles track ↔ loop while the loop clock
runs. No-op when it doesn't. The manual choice sticks until the
next loop start/stop.

---

# 7. Focus

Two independent focus concepts.

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

`_refreshActiveAlt()` recomputes the four derived fields and calls
`_refreshDisplayFlags`. Called from the constructor, then from
`setSelectedFor`, `setActiveDeck`, `setActiveFx`.

## _afterFocusChanged

All three setters route through one helper:

```js
_afterFocusChanged(tokens, reason):
    this._refreshActiveAlt()
    this._reapplyByTokens(tokens, { skipRefresh: true })
    if (!this._syncFxLayout().swapped) this._refreshAllLeds(reason)
```

One repaint per focus change on every path.

## _syncFxLayout

Scans `activePatches` for any entry matching the fx-pattern regex,
resolves each via `_resolveFxPatchName`, swaps via one
`_batchPatches`. Returns `{ swapped, reason }`. `swapped: false`
means the caller refreshes itself.

---

# 8. Routing via tokens

Bindings reach focus via tokens in their group string. Tokens
resolve at bind time; `_reapplyByTokens` re-applies any binding
whose `_usedTokens` include the changed token.

```js
K3Controller._reapplyByTokens = function(tokens, opts) {
    var fingerprint = null;
    for (var name in this.bindings) {
        var b = this.bindings[name];
        if (!b._usedTokens || !b._rawCfg) continue;
        var hit = false;
        for (var i = 0; i < tokens.length; i++) {
            if (b._usedTokens.indexOf(tokens[i]) !== -1) { hit = true; break; }
        }
        if (!hit) continue;
        if (fingerprint === null) fingerprint = this._tokenFingerprint();
        var h = this._resolvedTargetHash(b._rawCfg, fingerprint);
        if (b._resolvedTargetHash === h) continue;
        this._applyBinding(name, b._rawCfg, fingerprint);
    }
    if (!(opts && opts.skipRefresh)) this._refreshAllLeds('token-reapply');
};
```

**Short-circuit on resolved target.** `_resolvedTargetHash(cfg,
fingerprint)` resolves every token-bearing field against current
focus and hashes the result. `b._resolvedTargetHash` is written by
`_applyBinding` on every successful bind, cleared on unbind. A
focus flip between two slots resolving to the same channel skips
the rebind.

**Memoized per (cfg, token fingerprint).** `_resolvedTargetHashCache`
is a WeakMap keyed on the cfg object, holding `{fingerprint,
value}`. The fingerprint is a positional snapshot of every field
in `XoneK3.TOKENS`. Any state change that could alter a token's
value changes the fingerprint, invalidating the entry. Adding a
token to the registry covers it automatically.

`_usedTokens` is populated in `_collectTokens`. Both it and
`_validateBindings` share `XoneK3._tokenFields(cfg)`, which
enumerates every binding field that can carry a `$TOKEN$`
(`group`, `inKey`, `outKey`, `schemeFromState.group`,
`schemeFromState.co`, `on.group`).

Adding a new token-bearing field means editing `_tokenFields` and
`_resolvedTargetHash` — the two must stay in sync.

**`skipRefresh: true`** — all three focus setters use it, then
refresh via `_syncFxLayout`'s recompute or their own trailing
`_refreshAllLeds`.

---

# 9. Chord

Two states interact: `isShifted` and `_chordActive`.

- `shift` press → `isShifted = true`
- `layer` press while `isShifted` → `_enterChord()`
- `layer` release while `_chordActive` → `_exitChord()`
- `shift` release while `_chordActive` → `_exitChord()` then `unshift()`

**Chord wins over shift companions.** `_buildStack` holds the
`chord` entry aside and appends it after shift companions.

`layerButton`:

```js
if (pressed && ctrl.isShifted) { ctrl._enterChord(); return; }
if (!pressed && ctrl._chordActive) { ctrl._exitChord(); return; }
if (!pressed) return;
ctrl.replacePatch(args[0], args[1]);
```

`shutdownHold` is a 2-second hold; releasing shift, layer, or the
binding cell cancels the timer via `Binding._reset`.

`_pulseCo(group, co)` fires a CO high, then clears it on a 1 ms
one-shot timer.

---

# 10. Beat pipeline

## Count and pulse — separate sources

- **Cascade count** — 1-based beat number. Picks which cascade
  level and colour override. Track mode: from `playposition`.
  Loop mode: from `loopClock.pos`.
- **Pulse phase** — bright half vs dim half. Always from
  `playposition`'s fractional beat, in both modes.

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

   playposition (track frac) ─────► st.active
                                    (bright / dim phase)
```

## The four-case matrix

| logicalOn | beatOffPhase | isOn | LED shows |
|---|---|---|---|
| true | false | 1 | on-ramp + cascade |
| true | true | 0 | off-ramp |
| false | false | 0 | off-ramp |
| false | true | — | black (early return) |

The gate for "is this deck producing beats" is `st.hasBeat`, not
`st.count > 0`.

## Phase helpers

`Binding._beatStateFor(compiled)` — shared preamble for every
beat-aware render path. Returns the deck state when the deck has
seen at least one beat, else null.

`Binding._isBeatOffPhase(compiled)` — wraps it with the
`!st.active` flip.

## Two writers of `st.active`

- `beat_active` handler — high → true, low → false. Fires in both
  display modes.
- `_repaintFromPosition` handler — sets `active = trackFrac < 0.5`.

Both write from track frac, so they agree.

The position handler skips *the pulse repaint* in track mode when
the deck is playing forward and a recent `beat_active` edge exists
(within 1.5 s) — that's what prevents the flicker inside a loop.
It still calls `_syncBeatCount(ch)` before returning so a dropped
or throttled edge doesn't freeze the cascade colour.

`_refreshBeatLeds(ch)` filters by resolved beat deck.

## `beatLevel`

Defined in `lib-core.js`. Counts are valid for any integer,
including zero and negatives. `beatLevel` normalises via modulo.

## Throttle

`BEAT_REPAINT_THROTTLE_MS = 30`. Two timestamps per channel,
gated independently (`lastBeatRepaint`, `lastPositionSync`).

## Clock connections

Six per channel:

| Array | Connection | What it does |
|---|---|---|
| `_beatConns` | `beat_active` | Pulse source. Drives `st.active` transitions. |
| `_playConns` | `playposition` | Advances the loop clock; position-tick repaint. |
| `_playConns` | `play_indicator` | Resyncs the clock anchor; sets `st.playing`. |
| `_playConns` | `track_loaded` | Clears `_trackMetaCache[ch]`, resets beat state, clears `_lastLoopTouchMs[ch]`, re-syncs beat clocks. |
| `_playConns` | `loop_enabled` | Starts / stops the loop clock on edge. |
| `_playConns` | `slip_enabled` | Count resync. |

Plus hotcue colour/position observers when
`PHRASE_MARKER_COLORS` is non-empty (32 per channel, i.e. 16
hotcues × 2).

`_openBeatClocks` ends with a catch-up loop: re-reads loop state
for every channel and starts the loop clock where a loop is
already active. CO connections fire on change, not on setup —
without this, a preset reload during an active loop leaves the
loop clock idle.

`_syncBeatClocks` is the only caller of open/close. Runs once per
recompute, from `_refreshAllLeds`. Gate is `_needsBeatClocks` —
returns `_beatLeds.length > 0`, with a fallback scan of `_applied`
when the array is empty. That fallback fires only when a prior
`_applyBinding` threw partway; dead code in the shipped path,
present as a safety net.

In shipped presets the clocks are effectively always open
(`countdownScheme` carries `beat:` and is on the layer/shift
buttons). Closing wipes per-channel timeline state but preserves
`_phraseOrigin`.

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

Bare palette names resolve to single-colour schemes. Cached by
name when `ref` was a string and no overrides were passed.

Off-ramp is either `offScheme` compiled, or `on` with brightness
dropped to `DEFAULT_RGB_BRIGHTNESS_OFF`.

Partial objects with no `colors` warn and return null.

## t-composer

`sampleT(compiled, t)`:

```js
t = t - m.position;
if (t < 0) t = 0;
if (t > 1) t = 1;
if (m.curve !== 0) t = _warp(t, m.curve);
```

Position first (slides the ramp and its curve pivot through knob
space), then warp. `CURVE_GAIN = 4.0`, pivot at 0.5.

Position is `(schemePosition - 63.5) / 127`.

Bounds: out-of-range clamps to 0 or 1 and holds the boundary
segment colour.

## Co-matching

`XoneK3.coMatchSample(compiled, group, key, physical, isOn)` —
shared helper for both `Binding._renderCoMatch` and
`LabController._renderCoMatch`.

## _funcId

Boot-scoped. Reset in `_bootWith` (§3).

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
into one compiled scheme or null. A scheme function returning a
fresh object twice with identical content fires
`_warnOnce('csSchemeFresh:<binding>')` — fix is `composeScheme`
or hoisting the object out of the closure.

## Calibration

`_emitAt` splits into:

```
_channelEmit(rgb, hw)     → [r, g, b] linear emissions
                              white-balance × transfer × channelPerceptual
sum → Y                   total linear luminance
Math.pow(Y, lumGamma)     perceptual compression
× (1 + hkBoost × sat)     saturation boost
```

## Flat target (cached)

`_flatTarget(segs)` scans the ramp's stops for minimum perceived
luminance. Cached per-controller in `_flatCache`, keyed by
`segs._cacheId` then `_calibKey` on read:

```js
if (segs._cacheId === undefined) segs._cacheId = ++_segsCacheCounter;
var entry = this._flatCache[segs._cacheId];
if (entry && entry.key === this._calibKey) return entry.value;
// compute value
this._flatCache[segs._cacheId] = { key: this._calibKey, value: value };
```

Two controllers with different `_calibKey` don't share entries.
Segments arrays are owned by `_compiledCache`, reset per boot, so
entries per controller per boot are bounded by distinct schemes.

## Hardware solve (cached)

`_calibratedHw(rgb, targetLum)` bisects `_emitAt` over 12
iterations. Cached in `_hwCache`, bounded at 1024 entries.

## _isOn

Three sources, checked in order:

```js
if (this._csOn !== null && this._csOn !== undefined) {
    if (this._csOn === true)  return 1;
    if (this._csOn === false) return 0;
    // conditional: patchActive / state / co
}
if (this.group && this.outKey) return engine.getValue(this.group, this.outKey) > 0 ? 1 : 0;
return 0;
```

| Shape | Fields |
|---|---|
| `true` / `false` | Boolean unconditional |
| `{ patchActive }` | Respects `_host` |
| `{ state }` | Dot-path, truthy check |
| `{ state, equals }` | Strict equality |
| `{ state, contains }` | Array/string membership |
| `{ co, group }` | Mixxx CO |

Numeric `on.state` without `equals` warns once per binding, from
`_isOn` on first render — not at bind time.

`on.co` gets its own `engine.makeConnection` in `_parseCsOn`,
pushed onto `b._conns`. `_bindConns` skips the `outKey` connection
when `_csOn` is set.

## schemeFromState list branch

`schemeFromState.list` uses the CO value directly. The CO that
feeds QFX (`loaded_chain_preset`) is 0-based. Out-of-range clamps
to the last entry.

---

# 13. Input mods

`Binding.input()`:

```
1. _onInput(b)                  subclass hook
2. normalized update            knobs / faders only
3. accel multiply               only when _accel is set
4. func dispatch or default
```

Then repaints every observer LED.

## Accel

`_parseAccel` normalises to `{ amount, curve, window, fullAt }`:

```js
rate = ev.length * 1000 / window;
t = Math.min(1, rate / fullAt);
t = Math.pow(t, curve);
reps = 1 + (amount - 1) * t;
```

`_accelEvents` persists across rebinds.

**Inert without `func`.** The default path writes an absolute
value once per MIDI event; repeating is a no-op.
`_auditBindingCfg` warns once per binding per boot when `accel`
is declared without `func`.

## valueCurve

Applies at write time, after `_scaleValue`. `_normalized` stays
uncurved.

## Self-accelerating funcs

A func can implement its own acceleration by tracking event rate
on `this`. The binding must NOT also carry `accel:`. One source
of acceleration per binding.

---

# 14. Binding hash

`_applyResolved` diffs hashes, not object identity.

`_BINDING_CFG_FIELDS` enumerates every field that affects runtime
behaviour or LED output. Fields starting with `_` are structural
metadata and deliberately omitted.

`_hashBindingValue`:

- `undefined` → empty string
- `func` → resolved through `_funcId`
- Objects / arrays → `_stableStringify` (key-sorted)
- Strings → `JSON.stringify` (quoted, so a `|` inside a value
  can't shift the field boundary)
- Everything else → `String`

`_hashBinding` joins parts with `\u0001` (SOH). JSON-quoted
strings escape `\u0001`, so values can't inject the delimiter.

`_applyResolved` also caches the cfg object reference per binding
name: `oldCfgs[name] === cfg` skips the hash recompute. Works
because `_resolvePatch` memoizes its output — a repeated
recompute over the same stack returns the same `resolved[name]`
references.

Each per-binding `_applyBinding` call is wrapped via `_safeBinding`.
A throwing binding warns once via `_warnOnce('applyBindThrow:<name>')`
and doesn't stop the pass.

`_auditBindingCfg` runs per rebind, gated on `_debugPrintsOn`.
Warns about cfg keys not in `_BINDING_CFG_FIELDS` (hash will miss
them) and `accel` without `func`.

---

# 15. _bindingDefaults

Standalone factory returning every reset-able Binding field at
its default value. Called by the `Binding` constructor and
`_reset`. Adding a reset-able field means editing one list.

Session-scoped state lives outside the factory:

```
_normalized        knob/fader position
_accelEvents       accel rate window
_loopAccelEvents   self-accelerating func rate window
pressHeld          BPM tap state
turnHappened       BPM tap state
_ledObservers      LED observers
```

---

# 16. _snapshotBinding

Before every `_reset`, `_applyBinding` captures fields that
`_unbind` and `_rearmSoftTakeover` need after the wipe.

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
don't read. Anything reset-able not in either list triggers a
boot-time warning (gated on `_debugPrintsOn`).

`_resolvedTargetHash` is controller-set, not in
`_bindingDefaults`, so the snapshot audit doesn't see it.

---

# 17. Lab internals

`LabController extends K3Controller`.

## State

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
_lab.schemeName       registry cursor
_lab.beatTarget       target level or null
_lab._version         monotonic, bumped on every input event
_onBeat               fires on every beat edge
```

## Gates and overrides

`_commitPreview()` returns `_lab.edit` when
`previewSource === 'edit'`, else null (with
`_warnOnce('labEditWhilePreviewing')`). Preview mode is
preview-only — the edit funcs are no-ops while previewing. The
only paths from a preview into `_lab.edit` are `_loadPreview()`
(shift+R), `_editThis()` (slots mode), and the armed-slot save
in `_selectSlot`.

`_selectSlot` guards against a null `_previewScheme()`: clears
the arm and falls through to normal preview rather than writing
`null` into `edit`.

`_renderPreviewLED` wraps its render path in try/catch — a
user-authored scheme function that throws paints the preview
black and fires `_warnOnce('labPreviewThrow')`.

`_onPatchChange(from, to)` handles the auto-bake when leaving
`colorLab` and the mode prints.

`_applyAutoBake()` runs when preview lands on `'edit'` or slots
0..11.

`_needsBeatClocks` is overridden to keep beat connections open
whenever `_onBeat` is set.

## Preview compile cache

Keyed on `_lab._version` (bumped by `_onInput`) and `previewSource`.
Beat-driven renders between inputs hit the cache.

## Slot-0 preview chain

When `previewSource === LAB_SLOT.ON`, `_previewCompiled` wires
slots 1–3 as compile overrides:

| Slot | Wired as |
|---|---|
| 1 | `offScheme` |
| 2 | `coScheme` |
| 3 | `offScheme` on the co ramp |

Missing slots fall through to engine defaults. Only
`_previewCompiled` does this; a normal `compileScheme` ignores
slots 1–3.

## Binding discovery

Renderers don't hardcode which cell shows what. Every lab painter
asks for its cells by func reference via `_findCellsByFunc`.
`XoneK3.LAB_PAINTER_FUNCS` lists every func owned by a painter.

## Bake

`bakeScheme(ref, ctrl, level)` — lab-only.

Three levels, sampled at 23 points (structural samples at the
segment count):

- **structural** — one stop per segment; `ratio`, `curve`, and
  `schemePosition` emitted alongside so `compileScheme`
  reproduces the source spans and shifts.
- **sampled** — sample at 23 uniform points, tmap applied
- **wire** — the above, plus the calibration solve. Marks
  `calibration: false`

## Shutdown dump

`LabController.shutdown` is overridden to run the slot dump
synchronously, before the parent's async sysex drain. Dumping
from `_shutdownExtra` would race the caller.

## Mode prints

```js
XoneK3.MODE_PRINTS = false;
XoneK3.modePrint(line)
XoneK3.modePrintFirst(mode, hint)
```

Flipped on by colorLab's boot config (`modePrints: true`).

---

# 18. Debugging

## Print channels

| Channel | Gate | Reset on boot |
|---|---|---|
| `debugPrint` | `_debugPrintsOn` | no (persists) |
| `modePrint` / `modePrintFirst` | `MODE_PRINTS` | `MODE_PRINTS = false` in `_bootWith`; `_modeSeen` reset |
| `_warnOnce` | none — fires first occurrence | via `_warned` |

`debugPrint` walks `PRINT_TABLES`, uses the first table that has
the key.

`_warnOnce(key, msg)` prints `[k3] <msg>` the first time a `key`
is seen. Cleared in `_bootWith`.

`_syncBeatClocks` prints one line when `_debugPrintsOn` is set:

```
[k3] _syncBeatClocks want=1 have=1 _beatLeds=2 applied=45
```

`want` = `_needsBeatClocks()`, `have` = connections open,
`_beatLeds` = fast-path array length, `applied` = resolved binding
count. Mismatch at boot means the open/close decision is wrong;
`_beatLeds=0` with `applied=45` means a binding threw during
`_applyResolved` and the safety net is carrying the load.

The beatjump gate prints when `_debugPrintsOn` is set:

```
[k3] beatjump gated: 87ms / 130ms
```

`87ms` = time since last loop-touching event; `130ms` =
`BEATJUMP_GAP_MS`.

## Probes

```js
XoneK3.controllers[0].inspect()             // top-level state
XoneK3.controllers[0].inspect('press0')     // one binding
XoneK3.controllers[0].inspect('patches')    // activePatches, stack
XoneK3.controllers[0].inspect('beat')       // clock, counters, timelines
XoneK3.controllers[0].inspect('tokens')     // token → bindings
XoneK3.controllers[0].inspect('dark')       // unbound bindings
XoneK3.controllers[0].inspect('why', 'layer')    // pipeline walk for one binding
```

`inspect('rate')` is a stub — prints one line pointing at
`BEATJUMP_GAP_MS`.

`inspect('why', name)` walks the render pipeline for a single
binding and prints where it stopped. Read-only.

## Symptom table

| Symptom | Cause |
|---|---|
| Nothing lights | Preset not loaded. Reload. |
| `Xone K3: <file> requires <symbols>` at load | `<scriptfiles>` order in the `.midi.xml` is wrong. |
| LEDs half-update on patch switch | A binding field is missing from `_BINDING_CFG_FIELDS`. |
| Soft takeover stops working after a rebind | A reset-able field is missing from `_SNAPSHOT_FIELDS`. |
| Fader stuck at endpoint after deck switch | `_rearmSoftTakeover` bridge didn't fire. Check `b._normalized !== undefined` at rebind. |
| No beat after Mixxx startup until reload | Init-time beat-clock open raced the CO tree. `init`'s 250 ms reopen fixes; if it still happens, bump the delay or check `_shuttingDown`. |
| Beat LEDs stay dark after the 250 ms reopen | `_trackMeta` caching incomplete values. Verify the `if (meta.duration > 0)` guard is present. |
| Loop clock doesn't resume after a preset reload during an active loop | `_openBeatClocks`'s catch-up loop reads loop state on open. |
| Beat colour sticks while playing; correct when jogged | Position-tick guard returned before syncing count. `_syncBeatCount` must run before the early return. |
| Beat LED fires faster/slower on pitched deck, loop reading only | `_advanceVirtualClock` scaled by `[ChannelN],rate` (slider). Must read `rate_ratio`. |
| Two decks drift out of phase in loop mode at same tempo | Both decks on the same accumulation strategy? Check `_cascadeCount` reads `clock.pos`. |
| Beat count jumps backward on tight loops | Wrap detection direction-based? Check `reversing` is read correctly. |
| Beat LED drifts across loop iterations, both decks at unity | `duration × fileBpm / 60` not an integer. Snap `duration` to nearest beat-multiple, or switch to `trackTempo: true`. |
| Beatjump doesn't fire after touching a loop control | Gated by `_beatjumpAllowed` — less than `BEATJUMP_GAP_MS` since last loop-touching event on that channel. Set `_debugPrintsOn = true` for the gate line. |
| `[k3] _batchPatches mutator threw: …` | The mutator hit an exception. `activePatches` was not modified (mutator edits a copy). |
| `[k3] _applyBinding(<name>) threw: …` | One binding's bind path threw; rest of the pass continued. |
| `[k3] _syncFxLayout: fx-pattern patch … has no matching target` | An fx-family patch name is in `activePatches` but missing from `patches:`. |
| `[k3] colorScheme scheme function on X returns a fresh object each call` | Wrap with `composeScheme` or hoist the object. |

Full behaviour-driven symptoms (config author's view): CUSTOMISE §3.

---

# 19. Adding things

## Adding a scheme field

1. Add to `SCHEME_DEFAULTS`.
2. Consume in `compileScheme`.
3. If it affects render, read in `_refreshColorScheme` or `sampleT`.
4. If bake should preserve it, add to `bakeScheme`'s output.

## Adding a binding field

1. If it affects runtime behaviour or LED output, add it to
   `_BINDING_CFG_FIELDS`.
2. If `_bindCore` should read it, add a branch there.
3. If it can carry a `$TOKEN$`, add it to `_tokenFields` AND
   `_resolvedTargetHash`. The two must stay in sync.
4. If reset-able, add it to `XoneK3._bindingDefaults`.
5. If reset-able and `_unbind` / `_rearmSoftTakeover` should
   read it, add it to `_SNAPSHOT_FIELDS`. Otherwise add it to
   `_SNAPSHOT_IGNORED`.
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

**If your func touches a loop** (moves a boundary, engages a
loop, changes loop size, or jumps the playhead), call
`this._ctrl._touchLoop(this.group)` after the write. **If your
func is a beatjump**, call `this._ctrl._beatjumpAllowed(this.group)`
first and bail if it returns `false`.

## Adding a top-half mode

1. Define the base patch and its `_shift` companion in
   `xone-k3-cat-top.js`.
2. Define layout patches that inherit from the base; emitters
   live in `xone-k3-cat-fx.js`.
3. Add all of them to `CAT_LAYERS` in `xone-k3-cat.js`.
4. Add an entry to `XoneK3.TOP_MODES` in `lib-controller.js`
   with `owns` and `activate(ctrl)`.
5. Extend `_resolveFxPatchName`'s regex in `lib-controller.js`.
6. Write a swap func (or extend `toggleTopMode` / `toggleMiniFx`)
   that calls `ctrl.setTopMode(mode)`.
7. Bind it on a chord cell.
8. Add any new files to every `.midi.xml` and to
   `test/harness.js`.

CUSTOMISE §1.16 has the schema detail.

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

# 20. Tests

`node test/run.js` from the controllers directory.

```
test/
  run.js               runner + assertions + per-test reset
  harness.js           loads lib + cat files into a vm sandbox
  helpers.js           ctrl(), bootCat(), bootLab(), bind(), send()
  mocks/engine.js      CO values, connections, timers
  mocks/midi.js        sysex + short msg capture
  ... test files
```

Test files share one vm sandbox. `run.js` resets mutable globals
before every test: tunables, debug flags, `_warned`, `_modeSeen`,
`_funcIdCounter`, `_funcIdMap`, `_schemeCache`, `_compiledCache`,
`VIRTUAL_CLOCKS`, `TIME_SIG`, `BEATJUMP_GAP_MS`, mocks, controllers
array, print log.

`SCHEMES` is reset by `lib-schemes.js` on every reload — the
config files re-register their own schemes. A scheme removed from
a config is gone after reload.

Adding a new mutable global on `XoneK3` means adding a reset line
to `resetGlobals()` in `run.js`. `_funcIdCounter` /
`_funcIdMap` are in this list — a test booting two controllers
in sequence expects the second's ids to start from `_0`.

Coverage: see the test file list. Not tested: real Mixxx, real
LED bytes, config contents as data, lab round-trip state machine.

## Lint

`eslint.config.js` at the project root. Flat config, no plugins.
`no-implicit-globals` on for runtime files; the single `var
XoneK3` in `lib-core.js` carries an inline disable.

---

# 21. Non-obvious

## Timelines

- **`_beatF` has no `pos < 0` guard.** Negative playposition
  returns a negative fractional beat. `_cascadeCount` floors it,
  `beatLevel` normalises via modulo. Pre-start scrub cycles
  backward through the phrase instead of freezing the LED.
- **The loop clock accumulates, it doesn't read the playhead
  directly.** Both accumulation modes rate-scale at the same
  effective tempo.
- **Real-seconds mode needs no wrap detection.** Forward only.
- **Wrap detection is direction-based, not boundary-based.**
- **`_cascadeCount(ch, trackBeatF)` is the single count
  selector.**
- **`beat_active` drives the pulse in both modes.** The cascade
  reads `clock.pos` in loop mode; the pulse reads the track
  fraction.
- **`_refreshDisplayFlags` is the only writer of the three
  derived flags.**
- **All three focus setters refresh exactly once on every path**
  — via `_afterFocusChanged`.
- **`_advanceVirtualClock` clamps `dt` to zero.** Date.now() is
  not monotonic; a backward NTP step would shift the loop-mode
  count backward.
- **The loop clock scales by `_channelRate(ch)`, not
  `[ChannelN],rate`.** Mixxx's `rate` CO is the slider position
  (~−0.08..+0.08). A `<= 0` guard on it silently turns the
  multiplier into unity and disables scaling on every pitch-down.
  `_channelRate` reads `rate_ratio` and falls back to `1 + rate`
  for older builds.
- **`_closeBeatClocks` preserves `_phraseOrigin`.** Playhead
  hasn't moved; the derivation would produce the same value on
  the next tick anyway.
- **`hasBeat` means "position is meaningful", not "deck is
  playing".** `st.playing` mirrors `play_indicator` and is
  diagnostic-only.
- **The loop clock is the only virtual timeline.**
- **Boot-time beat-clock reopen.** See §3.
- **`_openBeatClocks` catches up state on open.** See §10.

## Beatjump gate

- **One gate, one value.** `BEATJUMP_GAP_MS = 130` in
  `lib-core.js`. Gated: `beatjumpButton`, `encBeatjump`.
- **Stamped by:** beatjump (on pass, in loop), `encLoopMove`,
  `encLoopMoveAccel`, `pressSetValue` on `beatloop_size`,
  `beatloopActivateResetAnchor`, `reloopToggleResetAnchor`.
  NOT stamped by `beatjump_size`, hotcues, play, EQ, faders.
- **Outside a loop every beatjump fires and nothing is stamped.**
- **Gate lives in `lib-controller-render.js`**
  (`_beatjumpAllowed`, `_touchLoop`).
- **No per-binding override.**

## Caches

- **`_trackMetaCache`** — per-channel, reset on `track_loaded`.
  Incomplete reads (duration 0) not cached. See §6.
- **`_flatCache`** — keyed by `segs._cacheId` then `_calibKey`.
  Two controllers with different `_calibKey` don't share entries.
- **`_hwCache`** — bounded at 1024.
- **`_ledCache`, `_sysexQueue`** — per-controller.
- **`_blankLeds`** — stops the sysex drain timer, clears the
  queue, sends black. Note-off sweep runs unconditionally — a
  previous session may have left K2 notes lit, and sysex blanks
  can't reach them.
- **`_resolvedPatchCache`** — set once at construction, no
  invalidation needed.
- **`_resolvedTargetHashCache`** — WeakMap keyed on cfg,
  invalidated by token fingerprint. See §8.
- **`_funcIdCounter` / `_funcIdMap`** — reset every boot. See §3.
- **`SCHEMES` / `COLORS`** — cleared by `lib-schemes.js` on every
  evaluation, re-registered by the config files that follow.
  Compiled-scheme references on live bindings are object
  references, not names — they survive the clear.

## Beat math

- **`sampleT` order is position → curve.** Preserves the curve's
  shape at every position and holds the boundary segment colour
  out of range.
- **The beat gate sits above ramp selection.**
- **Marker bypasses the flat solve but DOES beat-apply.**
  Co-match does not — cascade flashes defeat its purpose.
- **`st.hasBeat` is that channel's "deck is producing beats"
  test,** not `count > 0`.
- **`Binding._beatStateFor` is the shared preamble.**

## Patches and bindings

- **Sibling layers do not inherit.**
- **`_recompute` always calls `_refreshAllLeds` internally.**
- **`_reapplyByTokens` short-circuits on resolved target.** See §8.
- **`_refreshAllLeds` is re-entrancy-guarded.**
  `_refreshAllLedsDepth > 0` short-circuits the nested call. The
  only legitimate nested path is `_refreshAllLeds →
  _syncBeatClocks → _openBeatClocks → _startVirtualClock →
  _resolveDisplaySource → _refreshAllLeds('display-source')`.
  Skipping the inner call is safe: the outer call iterates every
  binding *after* `_syncBeatClocks` returns.
- **`_safeBinding(fn, thisArg, args, warnKey, warnPrefix)`** is
  the shared per-binding try/catch. The method reference and its
  argument array are passed separately — no closure over
  `var`-scoped names, safe under re-entrancy.
- **`_batchPatches` gives the mutator a copy and enforces the
  contract in code.** See §4.
- **`setTopMode` preserves position.** Non-owned patches keep
  their relative order across the top-half block.
- **Numeric `on.state` without `equals` warns once per binding,
  from `_isOn` only.** A binding whose LED never renders never
  fires the warning.
- **`_applyBinding` refreshes at the end.** The recompute path
  also runs `_refreshAllLeds` — duplicate wire send deduped by
  `_ledCache`. The refresh exists for callers outside a
  recompute.
- **Hash cache relies on cfg object identity being stable.**
- **`_hashBinding` uses `\u0001` as the separator and
  JSON-quotes strings.** A `|` inside a `group` can't shift the
  boundary.
- **`_onInput(b)` runs before the binding's func, on every
  physical event.**
- **`accel` does nothing on the default input path.**
- **Mod state survives rebind.**
- **Soft-takeover bridge.** `_rearmSoftTakeover` runs on rebind;
  Mixxx is uninitialised and drops the next write unless it lands
  within its own tolerance (~1/128) of the current CO. A physical
  already near CO at rebind — switching back to a deck whose
  fader hasn't moved — would otherwise get stuck at the endpoint.
  The bridge writes CO's own value back to itself: diff is zero,
  Mixxx's check passes, `initialized` flips, subsequent writes
  are accepted regardless of step size. `TAKEOVER_EPSILON = 2/127`
  is deliberately larger than `CO_MATCH_EPSILON = 1/127` — LED
  "matched" implies control is live.
- **First bind also rearms soft takeover.** `type` is fixed at
  construction, so `_snapshotBinding` sets `wasPot = true`; on
  first bind `prev.group` is `undefined` while `b.group` is set,
  so the `b.group === prev.group && b.inKey === prev.inKey`
  short-circuit fails and `engine.softTakeover(g, k, false)` +
  `true` runs. Soft takeover is enabled from the first bind. The
  bridge is skipped because `_normalized` is `undefined` at that
  moment.
- **`valueCurve` doesn't touch `_normalized`.**
- **`_trimTrailingZeros` protects the selected segment.**
- **LED on/off state comes from `colorScheme.on`, `outKey`, or
  nothing.**
- **`_isOn` returns `v ? 1 : 0`** for state without `equals` or
  `contains`.
- **`_patchActive` is the source of truth.**
- **`_buildStack` puts chord last.**
- **Beat clocks are lazy but effectively always open in shipped
  presets.** `_needsBeatClocks` returns `_beatLeds.length > 0`,
  with a fallback scan of `_applied` when the array is empty —
  dead code in the shipped path.
- **`on.co` gets its own connection.**
- **Lab renderers discover cells by func reference.**
- **`track_loaded` also resets a channel's beat counter and
  `_lastLoopTouchMs[ch]`.**
- **Routing is token-based, not func-based.**
- **`_resolveFxPatchName` returns `undefined` for "not mine",
  `null` for "mine but missing", string for the target.**
- **`_syncFxLayout` batches all swaps into one `_batchPatches`.**
- **Group-enable cells use a single-colour scheme, not a ramp.**
- **`_warnOnce` dedupes per key per boot.**
- **`_sendColor` short-circuits `mixxx`-typed LEDs when
  `isOn === 0`.**
- **THEME is read live by every shipped emitter.**
- **`_bootWith(devices, Ctor, label)` spawns one controller per
  entry.**
- **`_tokenFields(cfg)` is the single field enumerator.**
- **Every file after `lib-core.js` throws on missing prereqs.**
- **`this.bindings` is the only name for the binding map.**
- **`_bindConns` skips the `outKey` connection when `_csOn` is
  set** — including `on: false`. The gate checks
  `_csOn === null || _csOn === undefined` explicitly, not
  truthiness, so `on: false` correctly suppresses the `outKey`
  listener.
- **`countdownScheme` derives its A / B family from the raw
  group token,** not the resolved group.
- **`_sendSysExLED`'s drain timer bails on empty queue only.**
  Shutdown relies on this — it polls `_sysexQueue.length === 0`
  before tearing down beat clocks.
- **`_validateBindings` token warnings go through `_warnOnce`.**
  Fire once per boot regardless of `_debugPrintsOn`.
- **`LabController.shutdown` runs the slot dump synchronously**
  before the parent's async sysex drain. See §17.
- **`_evaluateScheme` warns on fresh-object identity.**

---

# 22. Limits

- `chain_selector` only steps ±1. Not a readable index.
- Markers bypass the flat solve but DO get beat cascades.
- Co-match does not get beat cascades.
- Boot-white is session-scoped.
- Beat requires a playing deck.
- `barBeats` / `phraseBars` clamped 1..32 in the lab.
- `prePhraseBeats` clamped 0..`phraseLen - 1`.
- Bake: structural samples at segment count; sampled / wire at
- 23 points.
- No BPM read for the pulse.
- THEME changes propagate live for every shipped emitter.
- The four `fxLayout*` / `fxMini*` patterns are the only top-half
  layout families the runtime knows about. Adding a fifth means
  extending `_resolveFxPatchName` and the mode table.
- **One virtual clock per channel.** Adding a second means
  re-adding a priority model.
- **The loop clock accumulates, it doesn't read the playhead.**
  See §6.
- **Wrap detection only exists in tempo-tracking mode.**
  `applyLoopWrapAdjust` corrects at most one wrap per tick.
- **`beat_active` drives the pulse in both modes.**
- **Sub-beat loops work for the count.** Pulse may look erratic.
- **`_hwCache` bounded at 1024.**
- **`_flatTarget` is per-controller.**
- **`_reapplyByTokens` short-circuits on resolved target.**
- **Sibling layers don't inherit.**
- **Two layer trees.** Playback presets share `CAT_LAYERS`;
  colorLab has its own.
- **Controller split is load-order sensitive.**
- **Beatjump gate is a global rule.** No per-binding override.
- **Loop-boundary encoders are ungated.** They stamp
  `_lastLoopTouchMs[ch]` but the gate only restricts beatjumps.
- **`pressSetValue` on `beatjump_size` does not stamp
  `_lastLoopTouchMs`.** Only `beatloop_size` writes stamp.