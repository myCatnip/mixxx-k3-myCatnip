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
                                  BEATJUMP_GAP_MS, PULSE_CO_MS
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

colorLab replaces cat-fx / cat-top / cat-bottom / cat-overlays /
cat with its own tree. `cat-schemes.js` still loads — the lab's
`SCHEME_REGISTRY` references scheme names registered there.

```
xone-k3-cat-schemes.js     THEME, QFX_CHAIN_LIST,
                           PHRASE_MARKER_COLORS, SCHEMES
xone-k3-lab.js             LabController, bakeScheme
xone-k3-colorlab.js        colorLab layers + boot
```

`lab.js` sits after `lib-funcs.js` — it references
`XoneK3.FUNCS.*` at load time for `LAB_PAINTER_FUNCS`.

**Why five controller files.** All extend `K3Controller.prototype`,
split by concern. Any change to the file list means editing five
`.midi.xml` plus `test/harness.js`.

**Cat split** — `cat-schemes → cat-fx → cat-top → cat-bottom →
cat-overlays → cat`. Each declares its own `_requireLoad` prereqs.

**Bootstrapping.** `lib-core.js` opens with `var XoneK3 = (typeof
XoneK3 !== 'undefined') ? XoneK3 : {};` — Mixxx shares one global
object across `<scriptfiles>`. Every other file opens with
`_requireLoad(file, prereqs)` which throws on missing symbols.

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
        ├─ func / default write
        │
        ├─ _ledObservers[i]._refresh()

   (config change)
        │
        ▼
   _recompute() → _buildStack → _resolveStack
               → _applyResolved → _refreshAllLeds
```

## Non-obvious state

Beyond the binding map and `activePatches`:

- `_lastLoopTouchMs[1..4]` — beatjump gate timestamps
- `_decks[1..4]` — per-channel timeline and beat state (see `_freshDeckState`)
- `_phraseOrigin[1..4]` — beat where "count 1" sits
- `_trackMetaCache{}` — `{duration, fileBpm, samples, outroEnd}`,
  cleared on `track_loaded` / `track_samples` /
  `outro_end_position`. Incomplete reads not cached (§6).
- `_rateCache[1..4]` — `rate_ratio` snapshot, listener-fed
- `_reverseCache[1..4]` — reverse flag, listener-fed
- `_flatCache{}` — `_flatTarget` cache, keyed on segments id + `_calibFingerprint()`, bounded at 1024 entries (§12)
- `_calibFingerprint()` — computed at call time. See PERFORMANCE for why.
- `_resolvedTargetHashCache` — WeakMap<cfg, {fingerprint, value}> (§8)
- `_resolvedPatchCache{}` — memoized patch merges
- `_ledCache{}`, `_sysexQueue[]`, `_sysexTimer` — LED dedupe and drain
- `_recomputeDepth`, `_recomputeCompletedAt`, `_refreshAllLedsDepth` —
  phase tracking and re-entrancy guards

## The recompute cycle

```
_recompute()
  _buildStack       → [stack names]
  _resolveStack     → merged binding map
  _applyResolved    → hash diff; _applyBinding per changed binding
  _afterRecompute   → subclass hook
  _refreshAllLeds   → _syncBeatClocks, then b._refresh() per binding
```

**Callers don't refresh after.** `_reapplyByTokens` ends with the
same call unless passed `{ skipRefresh: true }` (§8).

One physical control is one `Binding`.

---

# 3. Boot and multi-device

`_bootWith(devices, Ctor, label)` resets boot-scoped state
(`_schemeCache`, `_compiledCache`, `_warned`, `_modeSeen`,
`_funcIdCounter`, `_funcIdMap`, `_segsCacheCounter`), constructs
controllers, calls `init()`, wires MIDI inputs.

`init()` blanks LEDs, runs `_recompute`, `_initExtra`,
`_validateBindings`, and schedules a **250 ms beat-clock reopen**.
Mixxx's first CO tree read at startup can register connections
that never fire; the reopen lets them fire. `_shuttingDown` guards
a reload landing inside the window. `_funcIdCounter` / `_funcIdMap`
reset per boot — otherwise `inspect()` prints ids whose value
depends on reload count.

`halt()` calls `shutdown()` on every controller and clears the
array.

---

# 4. Patches

`activePatches` is an ordered list of patch names. The stack is
those (chord held aside, `_host` filtered), then shift
companions, then chord last.

- `_host` — overlay gate. Applies only while one of its hosts is active.
- `layerButton, from, to` — swap. Intercepted when shift held: enters chord.

Three single mutations plus one batched:

```js
addPatch(name), removePatch(name), replacePatch(from, to)
_batchPatches(mutator)     // N edits, one recompute
```

`_batchPatches` gives the mutator a **copy**. Nested calls throw;
`addPatch` / `removePatch` / `replacePatch` throw inside a mutator.

Resolution: `_resolvePatch(name, seen)` shallow-merges parents in
order, then overlays the patch's own bindings. Cycle detection via
`seen`.

**Memoization.** `_resolvePatch` caches per name in
`_resolvedPatchCache`. Patches are fixed at construction, so a
resolved patch is stable per controller. Returning the cached
object makes `_applyResolved`'s `oldCfgs[name] === cfg`
short-circuit fire.

**Sibling layers do not inherit.** CUE / LOOP are siblings.
`twoDeckMini` inherits from `twoDeck` via `patch: ['twoDeck']`.

## Patch name constants

`XoneK3.PATCH_NAMES` in `lib-core.js`. Layout names built with
`PN.FOCUS_LAYOUT + n`.

---

# 5. Top-half modes

```
focus mode:     topShared   + fxLayout<n>
twoDeck mode:   twoDeck     + fxLayoutA<n> + fxLayoutB<n>
mini mode:      twoDeckMini + fxMini<n>
```

`XoneK3.TOP_MODES` in `lib-controller.js`. `owns` = every patch
name for unwind; `activate(ctrl)` = the list to add.

Mode inferred from `activePatches` via `currentTopMode()`. There
is no `this.topMode`.

`setTopMode(mode)` unwinds every patch owned by any mode, then
re-inserts the target's activate list at the position where the
first owned patch sat. Non-owned patches keep relative order. One
`_batchPatches`.

`F.toggleTopMode`: focus → twoDeck family → focus.
`F.toggleMiniFx`: twoDeck ↔ mini; focus → no-op.

`_resolveFxPatchName` returns `undefined` (not mine), `null`
(mine but missing), or the target name. `_syncFxLayout` warns once
per boot on `null`.

Adding a new layout family: extend the regex, add a branch.

Boot picks via `initialPatches` — see `BOOT_DEFAULTS` in
`cat.js`.

---

# 6. Timeline

Two timelines per channel. They describe *where the phrase
colouring reads from*; they don't move the playhead.

- **TRACK** — `playposition`. Beat 0 = file start. Origin sets where "count 1" sits. Default.
- **LOOP CLOCK** — accumulates playhead movement through wraps.

Per-channel state shape: `_freshDeckState()` in `lib-controller.js`.

## Origin

Derived from marker hotcues (`PHRASE_MARKER_COLORS`) by
`_deriveOriginFromPosition`. Runs on every throttled playposition
tick, `track_loaded`, any `track_samples` change, and any hotcue
colour / position change.

**Reads only `st.hotcueState`, never the COs.** Frozen in loop
mode. `_resetBeat` is the only hard reset. No manual setter.

## Beat maths

Metadata cached per channel (`duration`, `fileBpm`, `samples`,
`outroEnd`). Content bounds now read from the cache; the
`outro_end_position` listener invalidates on drag.

**Incomplete reads aren't cached.** `_trackMeta` writes only when
`duration > 0` — the CO tree may not have settled at first read.

See `_beatF` and `_trackBeatF` in `lib-controller-beat.js` for
the formula.

`bounds.start = 0` unconditionally. `bounds.end` feeds only the
track-end countdown, never the cascade or origin.

## Source selection

`_cascadeCount(ch, trackBeatF)` — see code. The pulse is not the
count; pulse phase always comes from `playposition`'s fractional
beat, in both modes.

## Playback rate

`_channelRate(ch)` returns the deck's multiplier. Prefers
`rate_ratio`; falls back to `1 + rate`.

**`[ChannelN],rate` is the slider position (~−0.08..+0.08), not
a multiplier.** A `<= 0` guard on it silently returns unity on
every pitch-down — see §21.

## Loop clock accumulation

`clock.pos` advances by the amount the playhead would have moved
if the loop played through in sequence.

Real seconds, `dt × rate / duration`. Forward-only; the wall
clock doesn't know the playhead wrapped, and doesn't reverse when
the deck does — the loop clock is a session clock, not a position
readout. Rate-scales with the deck's effective tempo.

## Derived flags

`activeDeckVirtual`, `activeLoopVirtual`, `activeDisplaySource`.

`_refreshDisplayFlags()` is the only writer. Called from
`_refreshActiveAlt` (inside recompute), `_resolveDisplaySource`,
`_resetBeat`, and `cycleDisplaySource` when the channel is the
active deck. The latter three call `_refreshAllLeds` themselves —
flag-reading LEDs have no CO connection.

## Beat display modes

Two tunables, one per deck state:

| | Default |
|---|---|
| `XoneK3.BEAT_PLAYING_MODE` | `'pulse'` |
| `XoneK3.BEAT_PAUSED_MODE`  | `'solid'` |

`'pulse'` — bright first half, dim second (from `trackFrac < 0.5`).
`'solid'` — cascade colour held. `'off'` — off-ramp, no cascade.

`Binding._isBeatOffPhase` reads the one matching `st.playing`.
For a beat LED to light while paused, its `logicalOn` source must
read 1 while stopped. Shipped `layer` / `shift` cells use
`outKey: 'track_loaded'`; `play_indicator` blacks the LED
regardless of mode.

## Display cycle

`cycleDisplaySource` toggles track ↔ loop while the loop clock
runs. **The loop clock runs iff `loopActive && playing`.** Pause
is exit; resume is entry.

All four start/stop call sites route through `_syncVirtualClock`.
Returns `true` when state changed.

| Caller | Uses return? |
|---|---|
| `_onLoopEnabled` | No — `_resolveDisplaySource` repaints |
| `_onPlayIndicator` | Yes — no-op branch needs explicit `_refreshBeatLeds` |
| `_catchUpChannel` | No |
| `_onTrackLoaded` | No |

`displaySource` is always `'track'` while the clock is stopped.
Pausing inside a loop resets the iteration count — resume lands
on whatever loop beat the playhead is on. Jogging while paused
moves the resume point. A manual `cycleDisplaySource` to
`'track'` while playing is overwritten by resume re-seed.

---

# 7. Focus

Two independent axes: deck focus (A/B) and FX focus (A/B). Each
slot holds an assignment (`selectedDeckA/B`, `selectedFxA/B`).

`_refreshActiveAlt()` recomputes the four derived fields and calls
`_refreshDisplayFlags`. Called from the constructor,
`setSelectedFor`, `setActiveDeck`, `setActiveFx`.

## `_afterFocusChanged`

All three setters route through one helper:

```
_refreshActiveAlt()
_reapplyByTokens(tokens, { skipRefresh: true })
if !_syncFxLayout().swapped: _refreshAllLeds(reason)
```

One repaint per focus change on every path.

## `_syncFxLayout`

Scans `activePatches` for fx-pattern entries, resolves each via
`_resolveFxPatchName`, swaps via one `_batchPatches`. Returns
`{ swapped, reason }`. `swapped: false` means the caller refreshes
itself.

---

# 8. Routing via tokens

Bindings reach focus via `$TOKEN$` in their group string. Tokens
resolve at bind time; `_reapplyByTokens` re-applies any binding
whose `_usedTokens` include the changed token.

Three short-circuits keep `_reapplyByTokens` cheap:

- **Resolved-target equality.** `_resolvedTargetHash(cfg,
  fingerprint)` resolves every token-bearing field against
  current focus and hashes the result. `b._resolvedTargetHash`
  is written by `_applyBinding` at bind, cleared on unbind. A
  focus flip that resolves to the same channel skips the rebind.
- **Memoization.** `_resolvedTargetHashCache` is a WeakMap keyed
  on the cfg object, holding `{fingerprint, value}`. The
  fingerprint is a positional snapshot of every `TOKENS` state
  field. Any state change that could alter a token's value
  changes the fingerprint, invalidating the entry.
- **Shared fingerprint.** `_reapplyByTokens` computes the
  fingerprint once and passes it to `_applyOneSafe` →
  `_applyBinding` → `_resolvedTargetHash`, so the WeakMap still
  hits.

**Every rebind routes through `_applyOneSafe`.** One throwing
binding is caught and warned; the pass continues.

`_usedTokens` and `_validateBindings` both walk
`XoneK3._tokenFields(cfg)`, derived from `_BINDING_FIELDS` rows
carrying a `token:` label. `_resolvedTargetHash` walks the same
rows. Adding a token-bearing field is one row.

`skipRefresh: true` — all three focus setters use it, then
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
`chord` entry aside and appends after shift companions.

`layerButton`:

```js
if (pressed && ctrl.isShifted) { ctrl._enterChord(); return; }
if (!pressed && ctrl._chordActive) { ctrl._exitChord(); return; }
if (!pressed) return;
ctrl.replacePatch(args[0], args[1]);
```

The shipped chord declares `grid2_1` as
`toggleLayerOverlay(['hotcue916', 'loopOdd'])` — the func picks
target by `_patchActive('cue')` / `_patchActive('loop')`. Both
overlays may sit in `activePatches` simultaneously; `_host` gates
visibility.

`shutdownHold` is a 2 s hold; releasing shift, layer, or the
binding cell cancels the timer via `Binding._reset`.

`_pulseCo(group, co)` fires a CO high, clears on `PULSE_CO_MS`.

---

# 10. Beat pipeline

## Count and pulse — separate sources

- **Cascade count** — 1-based beat number. Track mode: from
  `playposition`. Loop mode: from `loopClock.pos`.
- **Pulse phase** — bright half vs dim half. Always from
  `playposition`'s fractional beat, in both modes.

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

`Binding._beatStateFor(compiled)` — shared preamble. Returns the
deck state when the deck has seen a beat, else null.

`Binding._isBeatOffPhase(compiled)` — wraps with `!st.active`.

## Two writers of `st.active`

- `beat_active` handler — high → true, low → false.
- `_repaintFromPosition` — `active = trackFrac < 0.5`.

Both write from track frac, so they agree.

The position handler skips the pulse repaint in track mode when
playing forward and a recent `beat_active` edge exists (within
1.5 s) — that's what prevents the flicker inside a loop. It still
calls `_syncBeatCount` before returning.

The guard also requires the playhead not moving backward —
`beat_active` fires irregularly on backward jog, and the guard
would freeze `st.active` while count kept moving. Backward
bypasses the guard so `_repaintFromPosition` runs.

`st.lastPlayPos` is the per-tick `playposition` snapshot;
undefined until the first tick.

## Clock connections

Nine per channel — one on `_beatConns` (`beat_active`) and eight
on `_playConns` — wired in `_openChannelBeatClocks`:

| Array | CO | Effect |
|---|---|---|
| `_beatConns` | `beat_active` | Pulse source. |
| `_playConns` | `playposition` | Advances loop clock; position-tick repaint. |
| `_playConns` | `play_indicator` | Sets `st.playing`. |
| `_playConns` | `track_loaded` | Clears `_trackMetaCache`, resets beat state. |
| `_playConns` | `loop_enabled` | Starts / stops loop clock. |
| `_playConns` | `slip_enabled` | Count resync. |
| `_playConns` | `track_samples` | Track identity changed. |
| `_playConns` | `rate_ratio` | Updates `_rateCache[ch]`. |
| `_playConns` | `reverse` | Updates `_reverseCache[ch]`. |

Plus hotcue colour / position observers when
`PHRASE_MARKER_COLORS` is non-empty (2 × `HOTCUE_MAX` per channel).
Wired once at clock-open — raising `HOTCUE_MAX` after boot extends
the per-tick derive scan but not the observer set.

Each observer updates one `st.hotcueState` field and re-derives
origin from the cache — no scan.

`_openBeatClocks` ends with a **catch-up loop**: re-reads loop
state, starts the loop clock where already active, re-reads
`play_indicator` into `st.playing`, populates `_rateCache`,
syncs count. CO connections fire on change, not on setup — a
preset reload during playback would otherwise render paused mode
on a playing deck.

`_syncBeatClocks` is the only caller of open / close. Gate is
`_needsBeatClocks` — returns `_beatLeds.length > 0`, with a
fallback scan of `_applied` when the array is empty. Dead code in
the shipped path; safety net only.

---

# 11. Scheme pipeline

`compileScheme(ref, overrides)` resolves the raw scheme (string →
`SCHEMES[name]` + defaults; object with `.colors` → as-is; object
without `.colors` → warn + null), then either builds segments and
the tmap (full scheme) or falls back to a single-colour ramp.

Bare palette names resolve to single-colour schemes. Cached by
name when `ref` is a string and no overrides were passed.

Off-ramp is either `offScheme` compiled, or `on` with brightness
dropped to `DEFAULT_RGB_BRIGHTNESS_OFF`.

## t-composer

`sampleT(compiled, t)` shifts position first, clamps, then warps.
Position-first is what makes `schemePosition` slide the whole
curve — pivot included — through knob space. Out-of-range clamps
to 0 or 1 and holds the boundary segment.

## Co-matching

`XoneK3.coMatchSample` — shared helper for both
`Binding._renderCoMatch` and `LabController._renderCoMatch`.

## `_funcId`

Boot-scoped. Reset in `_bootWith` (§3).

---

# 12. Render

Every render goes through `Binding._refresh`:

1. `_csActive`? → `_refreshColorScheme()`
2. `outKey`? → read `outKey`, send on/off
3. Neither → nothing

`_refreshColorScheme` resolves `_isOn()`, `_evaluateScheme()`,
checks the beat-off-phase gate, then dispatches to
`_renderStatic` or `_renderDeviation`. See the function for the
exact branch order.

The beat gate sits **above** the ramp selection.

`_evaluateScheme()` resolves base + closure + ref-identity memo
into one compiled scheme. A scheme function returning a fresh
object twice with identical content fires
`_warnOnce('csSchemeFresh:<binding>')` — fix is `composeScheme`
or hoisting the object.

## Calibration

`_emitAt(rgb, hw)` = white-balance × transfer × channelPerceptual,
summed to Y, `pow(Y, lumGamma)`, boosted by `hkBoost × saturation`.

## Flat target

`_flatTarget(segs)` scans stops for minimum perceived luminance.
Cached per controller in `_flatCache`, keyed by `segs._cacheId`
then `_calibFingerprint()`, bounded at 1024 entries — overflow
clears the whole cache, same discipline as `_hwCache`. The cap
matters for colorLab: every input event allocates a fresh `segs`
array (`_version++` invalidates the compile cache), so entries
accumulate during a tuning session. Misses still recompute
`_minSegmentEmit` — the cap only bounds memory, not per-render
CPU.

`_calibFingerprint()` is a method, not a stored string. Every
`_emitAt` input is included — curve name, calibrationMode,
wbActive, wbGain, channelPerceptual, hkBoost, lumGamma — so a
runtime tuning mutation invalidates the cache. See PERFORMANCE
for the rationale.

## Hardware solve

`_calibratedHw(rgb, targetLum)` bisects `_emitAt` over 12
iterations. Cached in `_hwCache`, bounded at 1024 entries.

## `_isOn`

Three sources, checked in order: `colorScheme.on` (unconditional
`true` / `false`, or `{ patchActive | state | co }` with optional
`equals` / `contains`), then `group + outKey`, else 0.

Numeric `on.state` without `equals` warns once per binding, from
`_isOn` on first render.

`on.co` gets its own `engine.makeConnection` in `_parseCsOn`,
pushed onto `b._conns`. `_bindConns` skips the `outKey` connection
when `_csOn` is set.

## `schemeFromState.list`

Uses the CO value directly (0-based). `loaded_chain_preset` is
0-based. Out-of-range clamps to the last entry.

---

# 13. Input mods

`Binding.input()` order: `_onInput(b)` → normalized update (knobs /
faders) → func dispatch or default → observer repaints.

## valueCurve

Applies at write time, after `_scaleValue`. `_normalized` stays
uncurved.

---

# 14. Binding hash

`_applyResolved` diffs hashes, not object identity.

`_BINDING_CFG_FIELDS` is derived from `_BINDING_FIELDS` — every
row with `hash: true`, in table order. Fields starting with `_`
are omitted.

`_hashBindingValue(field, v)`: `undefined` → empty;
`func` → `_funcId`; objects → key-sorted `_stableStringify`;
strings → `JSON.stringify` (quoted, so `|` inside can't shift the
field boundary); everything else → `String`.

`_hashBinding` joins parts with `\u0001` (SOH).

`_applyResolved` also caches the cfg object reference per binding
name: `oldCfgs[name] === cfg` skips the hash recompute. Works
because `_resolvePatch` memoizes its output — a repeated
recompute over the same stack returns the same `resolved[name]`
references.

Each per-binding `_applyBinding` call is wrapped via
`_applyOneSafe`, a named method with its own try/catch. Warns once
via `_warnOnce('applyBindThrow:<name>')` / `applyUnbindThrow` and
doesn't stop the pass. `_unbindRemoved` sweeps `_appliedHashes`
for missing entries.

`_safeBinding` is used by `_refreshAllLeds` and `_refreshBinding`.
`_refreshBeatLeds` has its own inline try/catch (`refreshBeatThrow:`
warn key) because it inspects each binding's scheme before
refreshing — not the same call shape.

`_auditBindingCfg` runs per rebind, gated on `_debugPrintsOn`.

---

# 15. `_bindingDefaults`

Standalone factory returning every reset-able Binding field at
default. Called by the constructor and `_reset`. Adding a reset-
able field means editing one list.

Session-scoped state lives outside the factory:

```
_normalized, pressHeld, turnHappened, _ledObservers, _held
```

---

# 16. `_snapshotBinding`

Before every `_reset`, `_applyBinding` captures fields that
`_unbind` and `_rearmSoftTakeover` need after the wipe.

`_SNAPSHOT_FIELDS` is derived from `_BINDING_FIELDS` — every row
with a `snapshot:` clause, expanded to `[source, dest, transform]`.
`_SNAPSHOT_IGNORED` is derived from `ignored: true` rows. Anything
reset-able not classified as either triggers a boot-time warning
when `_debugPrintsOn` is set.

Transform names are implemented in `XoneK3._snapshotTransform`.
Adding one means editing that function plus the table row.

`_resolvedTargetHash` is controller-set, not in `_bindingDefaults`,
so the audit doesn't see it.

---

# 17. Lab internals

`LabController extends K3Controller`.

## State

`this._lab = { slots[16], edit, previewSource, previewing,
saveArmed, previewPos, previewKnown, previewOn, selectedSegment,
ratioEdit, schemeName, beatTarget, _version }`.

- `slots[0..15]` — saved schemes. 0/1/2/3 = on/off/co/co-off.
- `edit` — working buffer. May carry `colorSet` (parallel bool
  array; real stop vs gap). Lab editing state, never persisted —
  `_cloneScheme` strips it.
- `previewSource` — `'edit'`, 0..15, or a registry name.
- `_version` — bumped on every input event, keys the preview
  compile cache.

## Gates and overrides

`_commitPreview()` returns `_lab.edit` when
`previewSource === 'edit'`, else null (warn once). Edit funcs are
no-ops while previewing.

`_selectSlot` guards against a null `_previewScheme()` — clears
the arm and falls through to normal preview.

`_renderPreviewLED` wraps in try/catch — a user scheme that
throws paints black and warns once.

`_onPatchChange` handles auto-bake when leaving `colorLab` and
the mode prints.

`_applyAutoBake()` runs when preview lands on `'edit'` or slots
0..11.

`_needsBeatClocks` is overridden to keep beat connections open
whenever `_onBeat` is set.

## Preview compile cache

Keyed on `_lab._version` and `previewSource`. Beat-driven renders
between inputs hit the cache.

## Preview LED render

`_renderPreviewLED` is a try/catch wrapper so a body throw's stack
points at the actual failing call. The body is
`_renderPreviewLedBody`: cache read, beat-state check,
stopped-beat-target branch, four-case matrix, then `_previewFrame`.

`_previewFrame` = co-match → marker → ramp. First branch to paint
wins.

## Slot-0 preview chain

When `previewSource === LAB_SLOT.ON`, `_previewCompiled` wires
slots 1/2/3 as `offScheme` / `coScheme` / co-`offScheme`
overrides. Missing slots fall through to engine defaults.

## Binding discovery

Renderers don't hardcode cells — they ask via `_findCellsByFunc`.
`LAB_PAINTER_FUNCS` lists painter-owned funcs.

## Bake

`bakeScheme(ref, ctrl, level)` — lab only. Three levels: structural
(one stop per segment), sampled (23 uniform points), wire (sampled
+ calibration solve, marks `calibration: false`). Structural
preserves `ratio`, `curve`, `schemePosition`.

## Shutdown dump

`LabController.shutdown` is overridden to run the slot dump
synchronously before the parent's async sysex drain.

## Mode prints

`XoneK3.modePrint(line)` / `modePrintFirst(mode, hint)`. Gated on
`MODE_PRINTS`, flipped on by colorLab's boot config.

---

# 18. Debugging

## Print channels

| Channel | Gate | Reset on boot |
|---|---|---|
| `debugPrint` | `_debugPrintsOn` | no |
| `modePrint` / `modePrintFirst` | `MODE_PRINTS` | via `_bootWith` |
| `_warnOnce` | none | via `_warned` |

`debugPrint` walks `PRINT_TABLES`, first matching table wins.
`_warnOnce(key, msg)` prints `[k3] <msg>` once per key.

`_syncBeatClocks` prints one diagnostic line when
`_debugPrintsOn`:

```
[k3] _syncBeatClocks want=1 have=1 _beatLeds=2 applied=45
```

Mismatch at boot = open/close decision wrong. `_beatLeds=0` with
`applied=45` = a binding threw during `_applyResolved`; safety net
carrying the load.

The beatjump gate prints when `_debugPrintsOn`:

```
[k3] beatjump gated: 87ms / 130ms
```

## Probes

See `lib-inspect.js` header. `inspect('why', name)` walks the
render pipeline for one binding and prints where it stopped.
Read-only.

## Symptom table

| Symptom | Cause |
|---|---|
| Nothing lights | Preset not loaded. Reload. |
| `Xone K3: <file> requires <symbols>` at load | `<scriptfiles>` order wrong. |
| LEDs half-update on patch switch | A binding field missing from `_BINDING_CFG_FIELDS`. |
| Soft takeover stops working after a rebind | A reset-able field missing from `_SNAPSHOT_FIELDS`. |
| Fader stuck at endpoint after deck switch | `_rearmSoftTakeover` bridge didn't fire. Check `b._normalized !== undefined` at rebind. |
| No beat after Mixxx startup until reload | Init-time beat-clock open raced the CO tree. `init`'s 250 ms reopen fixes; bump delay or check `_shuttingDown` if it still happens. |
| Beat LEDs stay dark after the 250 ms reopen | `_trackMeta` caching incomplete values. Check the `if (meta.duration > 0)` guard. |
| Loop clock doesn't resume after a preset reload during an active loop | `_openBeatClocks`'s catch-up loop reads loop state on open. |
| Beat colour sticks while playing; correct when jogged | Position-tick guard returned before syncing count. `_syncBeatCount` must run before the early return. |
| Beat LED fires faster/slower on pitched deck, loop reading only | `_advanceVirtualClock` scaled by `[ChannelN],rate`. Must read `rate_ratio`. |
| Two decks drift out of phase in loop mode at same tempo | Both decks on the same accumulation strategy? Check `_cascadeCount` reads `clock.pos`. |
| Beat count jumps backward on tight loops | Wrap detection direction-based? Check `reversing` is read correctly. |
| Beat LED drifts across loop iterations, both decks at unity | `duration × fileBpm / 60` not an integer. Snap `duration` to a beat-multiple, or switch to `trackTempo: true`. |
| Beatjump doesn't fire after touching a loop control | Gated by `_beatjumpAllowed` — less than `BEATJUMP_GAP_MS` since last loop-touching event. Set `_debugPrintsOn` for the gate line. |
| `[k3] _batchPatches mutator threw: …` | Mutator hit an exception. `activePatches` not modified (copy). |
| `[k3] _applyBinding(<name>) threw: …` | One binding's bind path threw; rest continued. |
| `[k3] _syncFxLayout: fx-pattern patch … has no matching target` | An fx-family patch is in `activePatches` but missing from `patches:`. |
| `[k3] colorScheme scheme function on X returns a fresh object each call` | Wrap with `composeScheme` or hoist the object. |
| Play doesn't respond after a hotcue pad press; recovers after mouse-seek | Held hotcue press survived a rebind. `_releaseHeldWrite` in `_applyBinding` writes 0 on both unbind and rebind. If still seen, check `Binding._held` is set for push-mode buttons. |
| `[k3] sampling a scheme containing a `mixxx` colour stop` | A `mixxx` stop sits in a sampled ramp. `mixxx` is static-only — see §22 Limits. LED falls back to the nearest valid stop's colour. |
| `[k3] colorScheme.schemeFromState on X must be an object` | `schemeFromState` is a string, number, or array. It's dropped; the base scheme (if any) renders instead. |
| `[k3] colorScheme.on on X has equals but no state/co/patchActive` | `on:` has a comparator but no source to compare. LED stays off. Add `state: '...'`, `co: '...'`, or `patchActive: '...'`. |

Full behaviour-driven symptoms: CUSTOMISE §3.

---

# 19. Adding things

## Adding a scheme field

1. Add to `SCHEME_DEFAULTS`.
2. Consume in `compileScheme`.
3. If it affects render, read in `_refreshColorScheme` or `sampleT`.
4. If bake should preserve it, add to `bakeScheme`'s output.

## Adding a binding field

1. Add a row to `_BINDING_FIELDS` in `lib-core.js`:
   - `hash: true` if it affects runtime behaviour or LED output
   - `token: '<label>'` if it can carry a `$TOKEN$`
   - `snapshot: { dest, transform? }` if `_unbind` /
     `_rearmSoftTakeover` needs it after rebind
   - `ignored: true` if reset-able but neither snapshotted nor hashed

   `_BINDING_CFG_FIELDS`, `_SNAPSHOT_FIELDS`, `_SNAPSHOT_IGNORED`,
   `_tokenFields`, `_resolvedTargetHash` all derive from this table.
2. If `_bindCore` should read it, add a branch.
3. If reset-able, add to `_bindingDefaults`.
4. Turn on `_debugPrintsOn` and reload. Boot-time audits fire if
   a reset-able field isn't classified.

## Adding a func

```js
XoneK3.FUNCS.myFunc = function(args, ch, c, v, s) {
    // this = Binding, args = cfg.args, v = MIDI value, s = status
};
```

Loop-touching funcs: `this._ctrl._touchLoop(this.group)` after
the write. Beatjump funcs: `this._ctrl._beatjumpAllowed(this.group)`
first, bail if false.

## Adding a top-half mode

1. Base patch + `_shift` in `cat-top.js`.
2. Layout patches inheriting from the base, emitters in
   `cat-fx.js`.
3. Add all to `CAT_LAYERS` in `cat.js`.
4. Entry in `XoneK3.TOP_MODES` in `lib-controller.js`.
5. Extend `_resolveFxPatchName`'s regex.
6. Swap func (or extend `toggleTopMode` / `toggleMiniFx`).
7. Bind on a chord cell.
8. Add any new files to every `.midi.xml` and to `test/harness.js`.

CUSTOMISE §1.9 has the schema detail.

## Adding a controller concern

Sixth controller file. Pattern:

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

Add filename to every `.midi.xml` (5 files) and `test/harness.js`.

---

# 20. Tests

`node test/run.js`. Files share one vm sandbox. `run.js` resets
mutable globals before every test — tunables, debug flags,
`_warned`, `_modeSeen`, `_funcIdCounter`, `_funcIdMap`,
`_schemeCache`, `_compiledCache`, `VIRTUAL_CLOCKS`, `TIME_SIG`,
`BEATJUMP_GAP_MS`, mocks, controllers array, print log.

`SCHEMES` is reset by `lib-schemes.js` on every reload — config
files re-register their own.

Adding a new mutable global on `XoneK3` means adding a reset line
to `resetGlobals()` in `run.js`.

Coverage: see test file list. Not tested: real Mixxx, real LED
bytes, config contents as data, lab round-trip state machine.

## Lint

`eslint.config.js`, flat config, no plugins. `no-implicit-globals`
on for runtime files; the single `var XoneK3` in `lib-core.js`
carries an inline disable.

---

# 21. Non-obvious

## Timelines

- **`_beatF` has no `pos < 0` guard.** Negative playposition
  returns a negative fractional beat. `_cascadeCount` floors it,
  `beatLevel` normalises via modulo. Pre-start scrub cycles
  backward through the phrase instead of freezing the LED.
- **The loop clock is a session clock, not a position readout.**
  Accumulates dt × rate / duration, forward-only. Doesn't reverse
  on deck reverse, doesn't need wrap detection.
- **`_cascadeCount(ch, trackBeatF)` is the single count
  selector.**
- **`beat_active` drives the pulse in both modes.** Cascade reads
  `clock.pos` in loop mode; pulse reads track fraction.
- **`_syncVirtualClock(ch)` is the single start/stop decision.**
  Returns `true` if state changed. Four call sites route through it.
- **`_refreshDisplayFlags` is the only writer of the three
  derived flags.**
- **All three focus setters refresh exactly once on every path.**
- **`_advanceVirtualClock` clamps `dt` to zero.** `Date.now()` is
  not monotonic; a backward NTP step would shift the loop-mode
  count backward.
- **`_advanceVirtualClock` reads zero COs.** Uses `st.playing`
  and `_channelRate` — both cached by listeners. No reverse
  read; reverse doesn't move the session clock.
- **`_onPlayposition` reads one CO per fire — `playposition`**,
  above the throttle gate so the direction check has a fresh
  value. Once past the throttle the body is CO-free.
- **`_beatF` reads zero COs.** Uses cached track metadata only.
- **`_repaintFromPosition(ch, pos)` accepts `pos`.** Saves one
  CO read per throttled tick. Falls back to live read when
  `undefined`.
- **`_syncBeatCount(ch, pos)` accepts `pos`.** Same convention.
- **The loop clock scales by `_channelRate(ch)`, not
  `[ChannelN],rate`.** Mixxx's `rate` is the slider position. A
  `<= 0` guard silently returns unity.
- **`_closeBeatClocks` preserves `_phraseOrigin`.** Playhead
  hasn't moved.
- **`hasBeat` means "position is meaningful", not "deck is
  playing".** `st.playing` mirrors `play_indicator` and picks
  `BEAT_PLAYING_MODE` / `BEAT_PAUSED_MODE`.
- **The loop clock is the only virtual timeline.**
- **Boot-time beat-clock reopen.** See §3.
- **`_openBeatClocks` catches up state on open.** See §10.
- **`st.lastPlayPos` gates the beat-edge guard.** Backward motion
  bypasses the 1.5 s guard so `_repaintFromPosition` runs.

## Beatjump gate

- **One gate, one value.** `BEATJUMP_GAP_MS` in `lib-core.js`.
- **Stamped by:** beatjump (on pass, in loop), `encLoopMove`,
  `pressSetValue` on `beatloop_size`,
  `beatloopActivateResetAnchor`, `reloopToggleResetAnchor`.
  NOT by `beatjump_size`, hotcues, play, EQ, faders.
- **Outside a loop every beatjump fires and nothing is stamped.**
- **Gate lives in `lib-controller-render.js`.**
- **No per-binding override.**

## Caches

- **`_decks[ch].hotcueState`** — per-channel hotcue snapshot.
  Seeded at clock-open, `track_loaded`, `track_samples`.
  Observers read `_decks[ch]` fresh on every fire (`_resetBeat`
  replaces the object). `_deriveOriginFromPosition` reads only
  this — zero COs per tick.
- **`_trackMetaCache`** — reset on `track_loaded`, `track_samples`,
  and `outro_end_position`. Incomplete reads (duration 0) not
  cached. `track_samples` is the reliable load-invalidation
  point; `outro_end_position` invalidates mid-track on drag
  without a repaint — the next beat edge renders with the new
  bounds. Un-invalidated cache symptom: beats advance
  at wrong rate for every track after the first, clears on restart.
- **`_rateCache[1..4]`** — `rate_ratio` snapshot. Listener-fed,
  seeded by `_catchUpChannel`. Removes a CO read from
  `_advanceVirtualClock`.
- **`_reverseCache[1..4]`** — reverse flag. Listener-fed,
  seeded by `_catchUpChannel`. Removes a per-tick CO read from
  the beat-edge guard in `_onPlayposition`.
- **`_flatCache`** — keyed on `segs._cacheId` then
  `_calibFingerprint()`. Bounded at 1024. See §12.
- **`_hwCache`** — bounded at 1024.
- **`_ledCache`** — per-controller. Packed int
  `(r<<21 | g<<14 | b<<7 | hw)`. Reversed by
  `XoneK3._decodeLedCacheValue` for inspect output.
- **`_sysexQueue` / `_sysexQueueMap`** — per-controller. Queue
  holds LED indices in drain order; map holds `idx → msg`.
  Enqueue is O(1). Cap 128 — overflow drops the oldest queue
  entry, deletes it from the map, and clears its `_ledCache`
  slot so a future render with the same frame re-enqueues.
- **`_blankLeds`** — stops drain, clears queue, sends black.
  Note-off sweep runs unconditionally (previous session may have
  left K2 notes lit).
- **`_resolvedPatchCache`** — set once at construction.
- **`_resolvedTargetHashCache`** — WeakMap keyed on cfg,
  invalidated by token fingerprint.
- **`_funcIdCounter` / `_funcIdMap`** — reset every boot.
- **`SCHEMES` / `COLORS`** — cleared by `lib-schemes.js` on every
  evaluation. Compiled-scheme references on live bindings are
  object references, not names — they survive the clear.

## Beat math

- **`sampleT` order is position → curve.** Preserves curve shape
  at every position; holds boundary segment out of range.
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
- **`_refreshAllLeds` is re-entrancy-guarded.** Only legitimate
  nested path is `_refreshAllLeds → _syncBeatClocks →
  _openBeatClocks → _startVirtualClock → _resolveDisplaySource →
  _refreshAllLeds('display-source')`.
- **`_safeBinding`** — shared per-binding try/catch. Method
  reference and args passed separately, safe under re-entrancy.
- **`_batchPatches` gives the mutator a copy and enforces the
  contract in code.**
- **`setTopMode` preserves position.** Non-owned patches keep
  relative order.
- **Numeric `on.state` without `equals` warns once per binding,
  from `_isOn` only.**
- **`_applyBinding` refreshes only when the caller asks.** Batch
  callers pass `skipRefresh: true`. `_applyResolved` gates on
  `_recomputeDepth > 0` so direct callers still get a per-binding
  refresh.
- **Hash cache relies on cfg object identity being stable.**
- **`_hashBinding` uses `\u0001` as separator and JSON-quotes
  strings.**
- **`_onInput(b)` runs before the binding's func.**
- **Soft-takeover bridge.** `_rearmSoftTakeover` writes CO's own
  value back to itself: diff zero, Mixxx's check passes,
  `initialized` flips. `TAKEOVER_EPSILON = 2/127` >
  `CO_MATCH_EPSILON = 1/127` — LED "matched" implies control
  live.
- **First bind also rearms soft takeover.**
- **Held push buttons are released on rebind.** Without it, a
  held hotcue pad swapped by patch change stays at 1, Mixxx stays
  in preview mode.
- **`valueCurve` doesn't touch `_normalized`.**
- **LED on/off state comes from `colorScheme.on`, `outKey`, or
  nothing.**
- **`_isOn` returns `v ? 1 : 0`** for state without comparators.
- **`_patchActive` is the source of truth.**
- **`_buildStack` puts chord last.**
- **Beat clocks are lazy but effectively always open in shipped
  presets.**
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
- **`_bootWith` spawns one controller per entry.**
- **`_tokenFields(cfg)` is the single field enumerator.**
- **Every file after `lib-core.js` throws on missing prereqs.**
- **`this.bindings` is the only name for the binding map.**
- **`_bindConns` skips the `outKey` connection when `_csOn` is
  set** — including `on: false`.
- **`countdownScheme` derives its A / B family from the raw
  group token,** not the resolved group.
- **`_sendSysExLED`'s drain timer bails on empty queue only.**
  Shutdown polls `_sysexQueue.length === 0`.
- **`_validateBindings` token warnings go through `_warnOnce`.**
- **`LabController.shutdown` runs the slot dump synchronously**
  before the parent's async sysex drain.
- **`_evaluateScheme` warns on fresh-object identity.**

---

# 22. Limits

Only the entries below are unique to this section. Everything
else you might expect here lives in §21 under Caches, Beat math,
or Patches and bindings.

- `chain_selector` only steps ±1. Not a readable index.
- Boot-white is session-scoped.
- Beat displays on paused decks too; `BEAT_PLAYING_MODE` /
  `BEAT_PAUSED_MODE` pick the behaviour. A beat LED whose
  `logicalOn` reads 0 while paused blacks out regardless of mode.
- `barBeats` / `phraseBars` clamped 1..32 in the lab.
- `prePhraseBeats` clamped 0..`phraseLen - 1`.
- Bake: structural samples at segment count; sampled / wire at
  23 points.
- No BPM read for the pulse.
- The four `fxLayout*` / `fxMini*` patterns are the only top-half
  layout families the runtime knows about. Adding a fifth means
  extending `_resolveFxPatchName` and the mode table.
- **Sub-beat loops work for the count.** Pulse may look erratic.
- **Two layer trees.** Playback presets share `CAT_LAYERS`;
  colorLab has its own.
- **Controller split is load-order sensitive.**
- **Loop-boundary encoders are ungated.** They stamp
  `_lastLoopTouchMs[ch]` but the gate only restricts beatjumps.
  - **`mixxx` stops are static-only.** `mixxx` resolves its rgb
  from the pad's hotcue colour at render time, and only
  `_renderStatic` handles that path. In a sampled ramp — a
  deviation LED's `knob:` scheme, a multi-stop scheme with a
  `mixxx` entry, or a calibration solve — there is no rgb to
  sample. The stop is skipped with a `sampleSegsMixxx`
  warn-once; a snap sample returns the previous valid stop's
  colour, a blend sample interpolates between the nearest valid
  stops, and the whole ramp renders black if no valid stops
  exist.