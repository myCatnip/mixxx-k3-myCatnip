# Timelines

Two timelines per channel. They describe *where the phrase
colouring reads from*. They don't move the playhead.

`CONCEPTS §9` is the mental model. This file is the reference:
accumulation, lifecycle, display selection, paused behaviour, and
where each piece lives in code.

---

## The two timelines

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
                     │  in sequence, endlessly          │
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

**Track** is the default. Intro marker = beat 0. Origin sets
where "count 1" sits.

**Loop clock** engages when a loop is enabled, seeded from
wherever the playhead is. It accumulates musical progress:
every tick, the clock's accumulated position advances by the
same amount the playhead would have moved if the loop played
through uninterrupted. A 4-beat loop that plays 4 iterations
shows the phrase cascade progressing *through* the loop
iterations, not repeating the loop's own 4 beats.

**Both are rate-scaled.** Pitch changes on the deck move both
timelines at the same musical rate. Two synced decks at the
same tempo advance their cascade counts in phase, in any mix of
track / loop displays.

---

## Display source

`displaySource` picks which timeline feeds the count. Two values:

| Value | Meaning |
|---|---|
| `track` | Read `playposition`. The default. |
| `loop` | Read `loopClock.pos`. Active while the loop clock is running. |

Resolution is one line: `loopClock.running ? 'loop' : 'track'`.
There is no priority tunable and no third reading. When the loop
clock stops, display falls back to track automatically.

`_resolveDisplaySource` runs on every clock start / stop and on
`track_loaded`. Manual cycle via `cycleDisplaySource` — bound to
the **unshifted** CUE `grid2_0` and LOOP `grid2_0` — toggles
between track and loop while the loop clock is running; a stopped
clock leaves only track, so the binding is a no-op in that state.
The manual choice sticks until the next start / stop event
re-resolves.

### The pulse does not follow displaySource

`displaySource` decides **which count** the cascade reads. The
**pulse phase** — whether the LED is in the bright half or the
dim half of the beat — always comes from the track position's
fractional beat, in both modes.

This is deliberate. `beat_active` edges are the audible beat
edges; the loop clock's accumulated position is a musical
progress counter, not a phase reference. Using `clock.pos` for
the pulse would put the two decks visibly out of phase the
moment one of them looped.

---

## Origin

The beat number where "count 1" sits. Stored per channel as
`_phraseOrigin[ch]`. Absolute beat, so it survives every
downstream remap.

```
count = absolute_beat - origin + 1
```

`absolute_beat` is `floor((pos - bounds.start) * duration *
file_bpm / 60)`. `bounds.start` is the intro start marker, or 0
if unset. That's beat 0.

In loop mode the position that feeds this is `loopClock.pos`, so
"here" means here on the displayed timeline — not the raw
playhead. `_setPhraseOriginAt` handles that.

### Lifecycle

| Trigger | New origin |
|---|---|
| Track load | Intro start beat, or 0 if no intro |
| Special-colour hotcue press | That hotcue's beat |
| Everything else | Unchanged |

Rebind, mode swaps, shift, chord, scheme changes, clock teardown,
and shutdown do not touch the origin. The **outro end marker**
doesn't affect it — the outro only feeds the bars-left countdown,
not the phrase cascade.

`_phraseOrigin` is user intent. Only a track load or a user action
changes it.

**`setPhraseOriginHere` is currently unbound in shipped presets.**
The func exists in `XoneK3.FUNCS`, but the only binding that
referenced it — `grid2_0` in `shiftPhraseCells()` — has its
`func:` line commented out. The cell is currently LED-only
(deviation ramp on `fader2`). Uncomment the `func:` line to
re-enable set-here on shift + `grid2_0`.

**`phraseOffsetStep` and `beatReset` are gone.** Both funcs were
removed from `XoneK3.FUNCS`. There is no shipped nudge-by-±1 path
and no alias for set-here.

### Special-colour hotcues

`XoneK3.PHRASE_MARKER_COLORS` (in `xone-k3-cat-schemes.js`) lists
Mixxx hotcue RGB hexes. A hotcue whose stored colour is in the
list sets the origin on press. Empty list = feature off.

Purpose: drop a phrase-marker hotcue at a known downbeat, press
it mid-set, whole cascade re-anchors. No manual offset hunting.

This is the only origin-writing path bound in shipped presets.
Hotcues press through `hotcueWithPhraseCheck`, which passes
`{ rawPos: true }` to `_setPhraseOriginAt` — a hotcue is a
physical position, and the origin must land on that beat, not on
the accumulated virtual count.

---

## Paused / scrubbing

`hasBeat` means **"position is meaningful"**. Set by:

- `beat_active` high
- Any `playposition` tick
- `_syncBeatCount` calls

It is **independent of play state**. A paused deck that's been
jogged once has `hasBeat = true`, and its beat-scheme LEDs show
the cascade for the parked position. Scrub updates them at the
30 ms position throttle.

`playing` mirrors `play_indicator`. Only the lab reads it — to
distinguish "pulse" from "solid preview". Playback LEDs ignore
it.

The pulse (active true → false → true) fires only on
`beat_active` edges, i.e. only on a running deck. A paused deck's
LED is static — it shows the colour for wherever the playhead
is, not a pulse.

---

## The count

`count = abs - origin + 1`. 1-based. `count 1` is a phrase.
`count 17` is the next phrase, for 4/4 with `phraseBars: 4`.

`abs` is derived from whichever timeline `displaySource` points
at:

- **Track mode** — `abs = floor(_beatF(ch, playposition))`.
- **Loop mode** — `abs = floor(_beatF(ch, loopClock.pos))`.

The beat math is identical. Only the position source differs.
`_beatF` converts a track-fraction position to fractional beats
from `bounds.start`.

Counts below the origin are legal — they resolve to positions in
the previous phrase iteration. `beatLevel` normalises negative
counts into `0..phraseLen-1` before picking the cascade level.

---

## Accumulation — why the loop clock stays in sync

When a loop is engaged, the playhead wraps from the out-point
back to the in-point. A naive reading of `playposition` jumps
backward every iteration, so the count would flicker.

The loop clock fixes this by *accumulating progress* instead of
reading position directly:

```
clock.pos += (per-tick progress)
```

Progress is always the same amount the playhead *would* have
moved if the loop played through in sequence. Two accumulation
strategies, both correct:

### Real-seconds mode (default, `trackTempo: false`)

```js
dt = (now - lastTs) / 1000
rate = _channelRate(ch)
clock.pos += (dt * rate) / duration
```

Accumulates musical time. Self-correcting — no wrap detection
needed, because the wall clock doesn't know the playhead
wrapped. Rate changes propagate through `rate`.

This is the default because it's the most robust: it works
correctly even when `playposition` ticks are irregular or
missing, and it never accidentally mis-detects a wrap.

### Tempo-tracking mode (`trackTempo: true`)

```js
delta = newPos - lastTrackPos
if forward and delta < 0:  delta += loopLen    // wrap correction
if reverse and delta > 0:  delta -= loopLen
clock.pos += delta
```

Accumulates playhead movement directly. Wrap detection is
direction-based: a jump in the direction opposite to playback
is a wrap. This handles reverse playback (which real-seconds
mode does not) and pitch changes propagate exactly, because the
delta comes from Mixxx's own rate-scaled position.

Set with `XoneK3.VIRTUAL_CLOCKS.loop.trackTempo`.

### Both advance in phase

Both strategies produce the same *rate* of accumulation at the
same effective tempo. Two decks in any mix of track and loop
displays advance their counts at the same musical rate. This is
the entire reason the loop clock exists: the count keeps
marching musically through loop wraps, without a wall-clock
timer and without the playhead's backward jumps.

### Sub-beat loops

Sub-beat loops (1/8, 3/16, odd fractions) work correctly. The
loop wraps many times per beat; the accumulation adds the loop
length back on each wrap, so the count still advances one beat
per beat. The pulse will look erratic — that's Mixxx's
`beat_active` timing on sub-beat loops, and it's honest. The
cascade colour progression stays musical.

---

## Clock lifecycle

Six connections per channel, opened by `_openBeatClocks`:

| Connection | What it does |
|---|---|
| `beat_active` | Pulse source. Drives `st.active` transitions. |
| `playposition` | Advances the loop clock on every tick; position-tick repaint. |
| `play_indicator` | Resyncs clock anchor; sets `st.playing`. |
| `track_loaded` | Clears `_trackMetaCache`, resets beat, reads loop state, re-opens clocks if they raced the CO tree at boot. |
| `loop_enabled` | Starts / stops the loop clock, escape detection. |
| `slip_enabled` | Count resync. |

`_syncBeatClocks` is the only caller of open / close. It runs
once per recompute cycle from `_refreshAllLeds`. The gate is
`_needsBeatClocks` — true while any binding is attached as a
beat LED.

Attach happens at bind time: any binding whose `colorScheme`
carries a function scheme or a `schemeFromState` gets attached,
since the resolved scheme might carry `beat:`. In shipped
presets, `countdownScheme` is on the layer and shift buttons and
always in the stack, so clocks open on boot and stay open.

They close only if a custom config removes every beat-carrying
scheme. Closing wipes per-channel timeline state but preserves
`_phraseOrigin`.

---

## Playback rate

`_channelRate(ch)` returns the deck's playback multiplier, ~1.0
at unity.

- Prefers `[ChannelN],rate_ratio` — the actual ratio, `1.0` at
  unity, `0.93` at −7% pitch.
- Falls back to `1 + [ChannelN],rate` on builds that don't
  expose `rate_ratio`.
- Returns `1` if neither reads cleanly.

**Do not read `[ChannelN],rate` directly.** That CO is the rate
*slider position*, roughly `−0.08..+0.08`. It is `≤ 0` on every
pitch-down AND at unity. A `<= 0` guard on it ("default to 1 if
the rate is zero or negative") silently converts the multiplier
to `1` and disables the scaling entirely — which is what caused
the pitched-deck beat-LED desync that lived in this codebase for
a while. `_channelRate` exists so the mistake can't be
reintroduced by accident.

---

## Gotchas

- **`beat_active` is the pulse source in both modes.** The loop
  clock's accumulation is a musical progress counter, not a
  phase reference. Do not read `clock.pos` for the pulse.
- **The loop clock is seeded from `playposition`, not from 0.**
  Start a loop at bar 17 → cascade continues from bar 17.
- **`track_loaded` resets the origin.** Load a new track → origin
  snaps to intro start. (Internally: `track_loaded` →
  `_resetBeat` → `_phraseOrigin[ch] = 0`. The `_resetBeat`
  method is not the same as the deleted `beatReset` func.)
- **Clocks are lazy but effectively always open in shipped
  presets.** See §Clock lifecycle.
- **`clock.pos` is track-fraction, not beats.** Same units as
  `playposition`.
- **The loop clock scales by the deck's playback multiplier,
  read via `_channelRate(ch)`.** Prefers `[ChannelN],rate_ratio`
  (1.0 = unity); falls back to `1 + [ChannelN],rate`. Do not read
  `[ChannelN],rate` directly — that CO is the rate slider
  position (~−0.08..+0.08), and a `<= 0` guard on it silently
  turns the multiplier into unity.
- **Intro marker = beat 0, by definition of `bounds.start`.** If
  you move the intro, `abs` for every position changes. The
  origin is a stored number, so it lands on a different physical
  beat — the cascade follows where the number lands, not where
  the intro used to be. It resets on the next track load.
- **`count 1` is where the origin sits, not the intro.** These
  coincide right after load. They diverge as soon as the user
  hits a phrase-marker hotcue (or, if enabled, presses set-here).
  There is no shipped ±1 nudge — the `phraseOffsetStep` func is
  gone.
- **Wrap detection is direction-based, not boundary-based.** A
  jump opposite to playback direction is a wrap, regardless of
  how close the endpoints are to the loop boundaries. The old
  boundary-proximity test missed wraps on tight loops.
- **`trackTempo: false` handles no wrap detection at all.**
  Because it accumulates wall-clock time, not playhead delta,
  the playhead's backward jump at wrap never reaches `clock.pos`.
  This is why it's the default.
- **The loop clock is the only virtual timeline.** There used to
  be a metronome clock; it's gone. `displaySource` has two
  values, `VIRTUAL_PRIORITY` does not exist, and there is no
  "which clock displays when both run" question to answer.

---

## Where to look in the code

| Concern | File |
|---|---|
| Clock start / stop / advance | `lib-controller-beat.js` |
| Accumulation, wrap adjustment | `lib-controller-beat.js`, `_advanceVirtualClock`, `applyLoopWrapAdjust` |
| Playback multiplier | `lib-controller-beat.js`, `_channelRate` |
| Display source resolution | `lib-controller-beat.js`, `_resolveDisplaySource` |
| Cascade count | `lib-controller-beat.js`, `_cascadeCount` |
| Beat maths | `lib-controller-beat.js`, `_beatF`, `_computeBeatState` |
| Origin writer (bound) | `lib-funcs.js` — `hotcueWithPhraseCheck` |
| Origin writer (unbound in shipped presets) | `lib-funcs.js` — `setPhraseOriginHere` |
| Origin setter | `lib-controller-beat.js`, `_setPhraseOriginAt` |
| Track-load origin reset | `lib-controller-beat.js`, `_resetBeat` |
| Lifecycle state | `lib-controller.js`, `freshDeckState` |
| Clock connections | `lib-controller-beat.js`, `_openBeatClocks`, `_syncBeatClocks` |
| Loop clock config | `lib-core.js`, `XoneK3.VIRTUAL_CLOCKS.loop` |