# Changelog

All notable changes to the Xone K3 Mixxx mapping.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.0.6] — 2026-10-30

Modifier-state fallout, THEME mutation propagation, snake exit
ergonomics. Small config-adjacent changes; runtime touched in
five files. No .midi.xml changes.

## Correctness fixes

**`ledSelectMarker` read `ctrl.isShifted` — a property the
modifier-state rework removed.** Dead branch, so shift+press on
the colorLab marker LED behaved identically to normal press and
never cleared the marker. Switched to `ctrl.modifiers.shift`.
User-visible: shift+press now deletes the marker as `LAB.md`
advertises.

**In-place `THEME` array mutation didn't repaint.** Emitters
returned the raw `THEME.deck[n]` / `THEME.fx[n]` value; the
binding's ref-identity memo (`_evaluateScheme`) compared by
reference and skipped recompile. `THEME.deck[3][0] = 100` left
the LED stuck at the old colour. Added a content-keyed
`CAT.themeScheme(kind, n)` helper — same approach as the
existing `fxScheme` — and rerouted `slipScheme`,
`activeSlotButton`, `deckSelect`, `fxSelect`, and `FX_COLOR_MAP`
through it. Assignment-replacement worked before and still
works; in-place mutation now propagates on the next render.
User-visible: channels 3/4 deck themes and any array-valued
`THEME.fx` entry can now be recoloured at runtime without
assignment.

**`inspect('why', name)` blamed the wrong on-source.**
`_verdictFor` checked `outKey` ahead of `_csOn` conditionals,
and `state` ahead of `patchActive`, the reverse of `_evalCsOn`'s
priority. Reordered to patchActive → co → state → outKey.
Debug-only; no runtime behaviour change.

**Press dispatch used `this._func`, not the captured func.**
`Binding.input`'s press-path dispatch read the current binding's
func even after `_onBindingPress` could have rebound the binding
via a modifier-driven patch swap — so press ran the new func
while release (via `_dispatchCapturedRelease`) ran the old one.
Now reads `_transaction.func` / `funcArgs` when the transaction
is active, mirroring the release path. No shipped patch triggers
this; the constraint is now enforced in code rather than by
convention.

**Toggle-mode bounce guard missed the push→toggle rebind-mid-
hold case.** A push binding rebound to toggle while held had its
push guard skipped (the guard reads the *current* mode) so a
hardware bounce reached the toggle branch and dispatched the
captured push func a second time. The toggle guard now also
returns when `_transaction.active`. Release still routes through
`_dispatchCapturedRelease`, which ignores `_togglePressActive`.

**Snake overlay could be left stuck in `activePatches`.**
`F.snakeExit` cleared `ctrl._snake` before `_batchPatches` ran.
A throwing mutator (contract-allowed; `_batchPatches` re-throws)
left the overlay installed with `_snake === null`, and every
snake func — including `snakeExit` — was guarded by
`if (!ctrl._snake) return`. Two-part fix: null `_snake` before
the batch (so `CHORD.press2`'s `on: { state: '_snake' }` LED
reads false during the recompute — previously it stayed lit
until the next input), and restore on throw so a retry works.

## Snake exit ergonomics

**Any button except `layer` / `shift` now exits immediately.**
Previously only `press2` exited, and playfield cells exited only
when the game was dead or won. Now every button except `layer`
and `shift` — the two game controls, which stay as turn left /
turn right (and start) during play — exits on press, in any
pre-dead state. Fast-out for accidental chord + `press2` entry:
one tap on any other button. When the game is dead or won,
`layer` and `shift` also exit (press-any-key pattern unchanged).

## Hardening

**`_csOn` assigned before the CO listener is wired.**
`_parseCsOn` previously called `_wireCsOnConnection` before
setting `b._csOn`. Mixxx currently defers CO callbacks, so the
order didn't matter; a synchronous fire (future Mixxx, test
mock) would read `_csOn === null` and fall through to the
`outKey` branch. Reordered.

## Docs

- `docs/INTERNALS.md` §10 clock connection table: count
  corrected from 9 to 12; added `outro_end_position`,
  `duration`, `file_bpm` rows.
- `CHANGELOG.md` added, seeded at v1.0.6. History prior to
  v1.0.6 reconstructed from GitHub Releases.

## Compatibility

- Mixxx 2.5
- Preset `.midi.xml` schema unchanged
- No config changes required
- No shipped-preset behaviour change

---

## [v1.0.5] — 2026-10-30

Lab bake rework. Config-only change; runtime untouched. No
.midi.xml changes.

Replaces the sampled/wire bake levels with four levels that all
preserve the source stop count. Calibration is bisected into
stop brightness at bake time; export additionally bakes white
balance into rgb.

## Bake levels

| Slot | Name | Stops | interp | calibration |
|---|---|---|---|---|
| 12 | structural | source rgb+br | live (source) | live on reload |
| 13 | baked+interp | source rgb, bisected br | forced true | baked off |
| 14 | baked | source rgb, bisected br | forced false | baked off |
| 15 | export | wb-applied rgb, bisected br | live (source) | baked off |

`curve`, `schemePosition`, `ratio` stay as live fields on every
level. `brightnessScale` is live on structural, baked into the
bisect on the other three.

## Which one to paste

- **12 structural** — same stops as your edit buffer, everything
  still live. Use this to keep editing after paste.
- **13 baked+interp** — paste and forget for this runtime, smooth
  blending. Matches source for any tuning.
- **14 baked** — paste and forget, snapped bands.
- **15 export** — hand-off to a foreign script or machine. White
  balance baked in; reloading here double-applies wb — don't ship
  as a runtime scheme.

## Code

- `LAB_SLOT`: `SOURCE` / `SAMPLED` / `WIRE` gone.
  `STRUCTURAL=12`, `BAKED_INTERP=13`, `BAKED=14`, `EXPORT=15`.
- `LAB_SLOT_COLOURS`: 12 blue, 13 cyan, 14 magenta, 15 orange.
- `bakeScheme` — per-segment emit replaces the 23-point resample.
  `bakeCal` covers bakedInterp / baked / export; `bakeWb` only
  export.
- `_applyAutoBake` writes the four slots.
- `_previewLabel` returns `structural` / `baked+interp` / `baked`
  / `export`.

## Docs and tests

README and docs/LAB.md updated: cell colours, per-stage matrix,
"what each bake keeps", preview-vs-hardware, paste-which list.
Matrix "which one to paste" lives in README, not LAB.

`test/lab-bake.test.js` and `test/lab-model.test.js` updated to
the new slot keys and levels.

## Compatibility

- Mixxx 2.5
- Preset `.midi.xml` schema unchanged
- No runtime changes
- `node test/run.js` green


---

## [v1.0.4] — 2026-10-29

hotcue2 overlay. Config-only change; runtime untouched. No config
changes required beyond reloading the preset.

Replaces the hotcue916 chord + slip overlay on the cue layer.

## Layout

**Row 2** (unchanged): hotcues 9, 10, 11, 12 with
phrase-colour-on-create, clear on shift+press.

**Row 3** (new): intro_start / intro_end / outro_start /
outro_end markers, bound to Mixxx's _activate / _clear /
_enabled COs.

| Action | Behaviour |
|---|---|
| Press (unset) | Sets marker at playhead |
| Press (set) | Seeks playhead to marker |
| Shift+press | Deletes marker |
| LED | Lit while set, dark while unset |

Colours: green / lime / amber / orange. Shift layer red.

Marker activate seeks only — no jump-and-play variant. Matches
Mixxx UI.

## Renames

- `hotcue916` → `hotcue2` in CAT_LAYERS and the chord overlay.
- Helper funcs: `hotcuePhrase` / `hotcuePhraseClear` (was
  `hotcue916` / `hotcueClear916`); added `markerCell` /
  `markerCellShift`.

## Docs and tests

README, INTERNALS §9, CUSTOMISE §1.8, GLOSSARY, AI-HELPER
updated. 11 new row-3 tests.

## Compatibility

- Mixxx 2.5
- Preset `.midi.xml` schema unchanged
- No runtime changes


---

## [v1.0.3] — 2026-10-29

Correctness and defensive fixes. No config changes required.
**No shipped-preset behaviour change.**

Follow-up to v1.0.2. Sweep for edge-case bugs and defensive
guards the shipped presets don't hit but custom configs might.

## Correctness fixes

**`_refresh` outKey-only fallback sent `(127,0,0,0)` instead of
`(0,0,0,0)`.** A binding with `outKey` but no `colorScheme`
takes a fallback that reads `v ? 127 : 127` — always 127. The
LED is still dark (hw=0) but `_ledCache` dedupes against the
wrong tuple and `inspect('why')` shows a phantom R channel for
the off state. Shipped presets all have `colorScheme` on their
outKey bindings so this path never runs — custom config only.
One-character fix.

**`_refreshBeatLeds` gated on the base scheme's beat deck, not
the function scheme's.** A binding with both a base `scheme`
(beat on deck A) and a `schemeFromState` function (beat on
deck B) refreshed on the wrong channel's beat edges. Now uses
`_evaluateScheme()` — the same compiled scheme the render path
uses — as the single source of truth.

**`_loadSelectedOntoChannel` had no range guard.** `args[2] =
5` with loadArm held (pressR) wrote to a nonexistent
`[Channel5]`. Guard now rejects out-of-range before the write.

**`encQuickFxCycle` divided by zero when `QFX_CHAIN_LIST` was
empty.** `% 0` → NaN → `setValue(…, NaN)`. Early return.

## Defensive fixes

- `channelPerceptual` length validated at construction. Short
  array (`[1, 1]`) silently killed the blue channel; NaN
  coerced to 0 by the bit-AND in the sysex encoder. Warns once
  at boot, falls back to `[1,1,1]`.
- `Binding.input` no longer calls `getParameter` on unbound
  pots. Focus mode's `encoder2: null` was triggering a wasted
  call per MIDI event.
- `replacePatch(from, from)` early return. Previously fired a
  full recompute and a `_onPatchChange('cue', 'cue')` event for
  a semantic no-op.
- `_recompute` wraps `_afterRecompute` and `_refreshAllLeds` in
  try/catch. A throwing subclass hook (LabController) or a
  connection error in `_syncBeatClocks` no longer skips the
  trailing state stamp (which triggered spurious
  "outside a recompute" warnings) or the LED sweep.

## Cleanup

- Duplicate comment above `encBpmOrHeadMix` removed.
- Dead `X.VIRTUAL_CLOCKS` reset removed from `test/run.js`.

## Tests

**22 new tests.** Each fix has a direct regression test; plus
contract tests for `_applyBinding` skipRefresh, `_reapplyByTokens`
resolved-hash skip, `_batchPatches` mutator restrictions,
`_evalOnCoValue` cached value, shutdown captured-release
suppression, `_dispatchCapturedRelease` throw recovery, and a
custom-func co-match cache case.

## Compatibility

- Mixxx 2.5
- Preset `.midi.xml` schema unchanged
- No new script files
- No config changes required
- No shipped-preset behaviour change


---

## [v1.0.2] — 2026-10-29

Hardening + burst CO-read elimination. No config changes
required. No user-visible behaviour change on shipped presets.

Follow-up to v1.0.1.

## Hardening

**`PHRASE_HOTCUE_SLOTS` rejects non-integer entries.** A config
like `[9.5, 10, 11]` previously passed both the runtime slot
list and the boot validator, seeded a connection to a
nonexistent CO, and had no effect — silent. Now dropped at both
layers, with a warn naming the constraint (integer between 1
and `MIXXX_HOTCUE_LIMIT`).

**Toggle-mode bounce guard.** Push-mode was already protected
by the transaction model. Toggle-mode was not: a bouncing pad
fired the action twice with no release between, flipping the CO
back — one press, no change. `_togglePressActive` now rejects
the second `v>0` until the physical release clears it. Real
double-presses (with a release between) are unaffected.

The clear runs on every button release, not just when the
current mode is toggle. This closes the toggle→push→toggle
rebind case — without it, a binding pressed as toggle, rebound
to push mid-hold, released, then rebound back to toggle would
leave the flag stuck and swallow the next press.

## Burst CO-read elimination

Every LED render sweep re-read each binding's `outKey`, `on.co`,
`schemeFromState.co`, and (for deviation LEDs) the knob's
co-match value. Those COs already had listeners — the callback
only triggered a repaint, it never cached the value. So a burst
of `_refreshAllLeds` calls issued ~55-65 CO reads per sweep,
contending with the audio thread on Mixxx's CO mutex.

Four caches:

- `Binding._lastOutKeyValue` — seeded at bind, updated by the
  outKey listener
- `Binding._lastCoValue` — seeded at bind for knob/fader
  bindings, updated by the value listener
- `_csOn.cachedValue` — seeded at bind, updated by the on.co
  listener
- `sd.cachedValue` — seeded at bind, updated by the
  schemeFromState.co listener

Each falls back to a live read when undefined (before the first
listener fire). Staleness window is one event-loop turn — the
same deferral Mixxx's `makeConnection` already has.

`_lastCoValue` is also refreshed synchronously inside `input()`
after dispatch. Without this, a knob's own write updated the CO
synchronously but the cache only on the next event-loop turn,
so a deviation LED sampling the knob flashed a spurious
co-match gradient on every MIDI event. The read-back is in
`input()` rather than `_defaultInput`, so it covers both the
default path and custom funcs that write to the binding's own
CO.

**Net reads eliminated:**
- Track load (11 sweeps): ~600
- Focus change (1 sweep): ~55
- Patch swap (1 sweep): ~55
- Steady state: unchanged (listeners only fire on change)

## Bug fix

`_evalOnCoValue` restored in `lib-binding.js`. It had been
dropped during the multi-pass edits of the cache work. Any
`colorScheme` with `on: { co: ... }` would have thrown from
`_evalCsOn` and painted the LED black. No shipped preset uses
`on.co`, so no user-visible breakage — but the API was broken
and two test files hit it.

## Behaviour-preserving cleanups

- `_resetBeat` skips the redundant `_refreshBeatLeds` call
  after `_refreshAllLeds` (beat LEDs are a strict subset of
  that sweep), with a defensive fallback for the re-entrancy-
  guard case.
- `_buildStack` computes `_patchActive(name)` once per patch
  instead of twice per `_noModifiers` patch.

## Tests

- `_validatePhraseHotcueSlots`: non-array, out-of-range,
  duplicate, non-integer
- `_phraseHotcueSlots`: non-integer rejection
- Toggle bounce: no double-flip; release-then-press toggles
  correctly; toggle→push→release→toggle does not swallow the
  next press
- All four caches: seeded, updated, `_isOn` reads cache, stale
  window recovers, `coMatchSample` fallback, synchronous
  read-back after `input()`
- Integration tests updated for the bounce guard (add
  `H.release` between back-to-back `H.press` calls on toggle
  buttons) and for cached CO semantics (`H.fireCO` /
  `engine._trigger` where a CO change must be observed)

## Debounce

The time-based `DEBOUNCE_MS` approach from an earlier
iteration is NOT re-introduced. It swallowed fast legitimate
double-taps. The state-based `_togglePressActive` guard covers
the realistic hardware-bounce case without penalising fast
user actions. The remaining `press→release→press` window is a
broken-switch scenario, already accepted as out of scope.

## Compatibility

- Mixxx 2.5
- Preset `.midi.xml` schema unchanged
- No new script files
- No config changes required


---

## [v1.0.1] — 2026-10-29

Polish and hardening release. No config changes required for
existing presets.

**No bugs in this release were observed in real use.** The fixes
are all edge cases, silent-failure paths, and configs nobody has
shipped. If v1.0.0 has been working for you, the behaviour you
see is identical.

## Behaviour shifts (narrow)

- Boot adapts to slow CO trees — catch-up reschedules up to
  `BOOT_MAX_ATTEMPTS` while boot-relevant fires are still landing
- Stale phrase origin after a track swap while beat LEDs were off
  is corrected at catch-up

## New tuneables

All defaults reproduce v1.0.0 behaviour — setting either to its
default is a no-op.

- `PHRASE_HOTCUE_SLOTS` — hotcue slots scanned for marker colours
  (default `[9, 10, 11, 12]`). Reduces observer connections from
  32 to 8 per channel. Range is fixed at boot; hotcue contents
  within those slots remain live via observers.
- `BOOT_SETTLE_MS` (100), `BOOT_MAX_ATTEMPTS` (5) — boot settle
  loop timing

## Silent-error hardening

Warns or falls back where the runtime previously misbehaved
silently:

- Uncaught throws from binding funcs, CO observers, and modifier
  hooks now warn-once and continue
- Scheme `offScheme` / `coScheme` cycle detection (was infinite
  recursion)
- `colorScheme.knob` pointing at a button/encoder (was stuck
  boot-white)
- Short `wbGain` config (was silent blue kill)
- Array scheme refs in `composeScheme` (was silent null)
- Non-finite `parseNum` results (was `Infinity` written to a CO)
- Fractional / non-finite `setTimeSig` args
- Out-of-range `initialDeckA/B` / `initialFxA/B`

## Additions

- `$DECK_ACTIVE$` support in the countdown scheme — countdown
  LEDs can follow deck focus
- Push-mode bounce guard — hardware bounce no longer resets
  per-press flags mid-hold

## Removed

- `HOTCUE_MAX` — deprecated in v1.0.0, superseded by
  `PHRASE_HOTCUE_SLOTS`

## Compatibility

- Mixxx 2.5
- Preset `.midi.xml` schema unchanged
- No new script files


---

