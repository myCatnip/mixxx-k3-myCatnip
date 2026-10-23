## The model

Every binding that touches a loop carries a **rate class**. The
class is a small profile: how often that binding may fire, and
how long to block follow-up jumps.

```
   physical input
        │
        ▼
   Binding.input()
        │
        ├─ 1. _onInput hook
        ├─ 2. normalized update
        ├─ 3. rate gate  ←──── ctrl._claimRate(b, class)
        │                          │
        │                          ├─ accepted → continue
        │                          └─ gated    → drop the event
        ├─ 4. accel multiply
        └─ 5. func dispatch or default write
```

A gated event never reaches the func body. For knobs / faders it
still updates `_normalized`; every binding still repaints its
observing LEDs. But the write that could destabilise the loop
never happens.

The gate applies to the *action edge only*. For buttons, that's
`v > 0`. Release is cleanup, not a state change worth
throttling.

---

## The four classes

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
| `jump` | Both boundaries move (beatjump, reloop, beatloop activate). Mixxx re-anchors on every event — needs the full 120 ms on the shared clock. |
| `edit` | One boundary moves (loop-point nudge, loop-size set). Mixxx has less state to update — self-gates 10 ms per binding, and leaves a softer 60 ms tail. |
| `claim` | Doesn't move anything, but the change means a jump shouldn't fire immediately after (beatjump-size step). Leaves a 60 ms tail on the shared clock. |
| `free` | No gate. Everything else by default. |

**Two timestamps.** `ctrl._lastLoopChangeMs` is the shared clock —
every class with `jumpBlockMs > 0` reads it. `b._lastGateMs` is
the per-binding self-check stamp — only classes with
`selfScope: 'binding'` write it.

**The claim floor.** When a class claims, it forward-sets the
shared clock by `claimMs`. The floor calculation is
`now - (jump.jumpBlockMs - cls.claimMs)`, which makes classes
composable: an `edit` at 60 ms leaves a 60 ms tail; a `jump`
reads the same clock and waits its full 120 ms from that point.

**Why `edit` self-gates but `jump` doesn't.** `jump` moves both
boundaries at once. `edit` moves one boundary, using the anchor
trick (`loop_anchor` set to 1 or 0 before the write). Mixxx has
less state to reconcile and tolerates a faster event rate, so
the class trusts the encoder to spin and self-checks at 10 ms
instead of trusting the shared clock.

---

## Where the class comes from

At bind time, `ctrl._resolveRateClass(cfg)`:

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

Everything else → null (the binding is `free`).

The inKey branches are explicit string matches, not a pattern.
A `beatjump_size` inKey is *not* inferred as `jump` — that CO
sets the size the next jump uses, not a movement. The classifier
must stay narrower than `_validateBindings`' audit pattern; see
INTERNALS §22, §25.

Func identity wins over `inKey`, because a func can write COs the
config never mentions. `encBeatjumpStepScale` writes
`beatjump_size_halve` / `_double`, not `beatjump_size` — the func
name is the only signal.

**Wrapping a func breaks inference.** If you write
`func: function() { XoneK3.FUNCS.encLoopMove.call(this, ...) }`,
`_inferRateClass` sees an unknown function reference and returns
null. The binding becomes `free` silently. `_validateBindings`
warns at boot when a binding has a custom func + loop-relevant
`inKey` + no explicit `rate:`. Fix is `rate: 'edit'` (or
`'jump'`), or `rate: false` to silence.

**If a string class name doesn't resolve** in `RATE_CLASSES`,
`_resolveRateClass` (called from `_applyBinding` at bind time)
warns once via `_warnOnce('rateUnknown:' + name)` and stores
`null` on the binding. `Binding.input`'s
`if (gateable && this._rateClass)` check short-circuits on
`null`, so the binding becomes ungated — the func fires, the
rate gate is bypassed. Fix the binding's `rate:` value and
reload. `_claimRate`'s own string lookup is a safety net for
direct callers; it never sees an unresolved name in shipped
code.

**Unexpected `rate` types warn once and fall through to
inference.** `rate: 5` or a bare `true` where the author
probably meant an object or a class name — fires
`_warnOnce('rateBadType:' + typeof cfg.rate)` for the number
case. `rate: true` is treated as "use inference" and does not
warn. Anything other than `undefined` / `null` / `true` / `false`
/ a string / an object is treated as a typo and falls through to
`_inferRateClass`.

---

## Override per binding

```js
encoderL: { func: F.encLoopMove, args: ['in', 0.010],
            rate: 'jump' },           // force jump class
encoderR: { func: F.encLoopMove, args: ['out', 0.010],
            rate: { selfCheckMs: 15, jumpBlockMs: 60, claimMs: 60 } },
someBtn:  { func: F.something, rate: false }   // opt out
```

The inline object uses the same shape as a `RATE_CLASSES` entry.
It's resolved fresh at bind time; changing it needs a rebind
(patch reload).

`rate: false` opts out entirely. The boot audit still warns if
inference would have classified the binding — this is
information, not a block.

---

## Self-accelerating funcs

`encLoopMove` and `encLoopMoveAccel` both nudge a loop boundary.
Only the Accel version multiplies its step by a rate-derived
factor. Two differences that matter:

**`encLoopMove` with `accel:` on the binding doesn't work.** The
binding-level accel repeats the func call, and each repeat hits
the `edit` self-check — the 2nd through Nth calls are gated.
Net effect: no acceleration. Use `encLoopMoveAccel` instead.

**`encLoopMoveAccel` implements its own accel.** Its internal
`_loopAccelEvents` window measures accepted-event rate, not raw
physical rate, because the gate runs *first*. The multiplier it
computes therefore reflects *accepted* spin, which is what you
want. Args:

```
[side, step, cap, divisor]
   side     'in' | 'out'
   step     base step in loop fraction
   cap      maximum step multiplier (default 6)
   divisor  events/sec per multiplier step (default 12)
```

Window length is `XoneK3.ENC_LOOP_ACCEL_WINDOW_MS` (150 ms).

**Never put `accel:` on a binding that uses `encLoopMoveAccel`.**
The runtime would call the func `reps` times per event, the func
would count each call as a separate event, and the rate would
overcount. One source of acceleration per binding.

**Tuning.** K3 encoders top out around 40–80 Hz on a hard spin.
Divisor 12 reaches 2× at a normal fast turn, 6× on a hard spin.
Divisor 30 needs a very fast turn to reach 2×. Cap of 6 is the
default ceiling; raise it if you want the top end to move faster.

---

## Reading an escape

The escape detector logs when a loop turns off shortly after a
rate claim. Line:

```
[k3] LOOP ESCAPE deck=1 sinceClaim=42ms claimedBy=encoderL/edit loop=[0.2512,0.2537]
```

Read it: a binding claimed the shared clock 42 ms before the
loop died. `claimedBy` names the binding and its class. `loop`
shows the loop bounds as track-fraction, so you can see whether
the playhead landed outside.

**The throttle was too loose for that gesture.** Fixes:

- Bump the relevant class's `jumpBlockMs` for more headroom
  (waits longer after the last shared claim).
- Raise the class's `selfCheckMs` if a self-gating class is
  letting too many events through (waits longer between events
  from the same binding).
- Override per binding: `rate: 'jump'` on a specific encoder
  forces the strictest class.
- If the escape fires from a custom func, it's `free` — the
  warning at boot would have flagged it.

Escapes outside `ESCAPE_DETECT_WINDOW_MS` (500 ms) are not
logged. Late UI clicks and track loads land outside the window
by design.

A deliberate loop-off — `reloopToggleResetAnchor` and
`beatloopActivateResetAnchor` mark `_expectingLoopOff[ch]` before
firing — is consumed silently. Track load marks it too.

---

## Diagnostics

```
XoneK3.controllers[0].inspect('rate')             // gate state + stats
XoneK3.controllers[0].inspect('rate', 'reset')    // zero counters
```

`inspect('rate')` prints:

- **last claim** — binding name + class + how long ago.
- **shared clock** — how long since the last loop-move claim.
- **per class** — bindings, accepted, gated, per class.
- **per binding** — accepted, gated, plus min / p50 / max of
  accepted-event intervals. `_rateIntervals` is a bounded ring
  of the last 32 gaps.
- **escapes** — full detail from the bounded ring: channel,
  `sinceClaim`, `claimedBy`, `loop bounds`.

If a binding isn't listed, it has no class — `free`. Add
`rate:` explicitly to give it one.

If a class isn't throttling at all, check `_inferRateClass`'s
mapping. `_validateBindings` at boot tells you when `rate:`
disagrees with inference, or when `rate: false` was declared on
something inference would have classified.

---

## What is not rate-limited

Overlay toggles, `toggleTopMode`, `toggleMiniFx`,
`cycleDisplaySource`. Rapid toggling is expensive but doesn't
corrupt state. These have no inference match — `_inferRateClass`
returns null, so the binding is ungated by default.

---

## Tuning recipes

**Loop encoder feels sluggish right after a beatjump.**
The `edit` class waits 60 ms after the last shared claim. That's
intentional — the loop needs to settle. Lower
`RATE_CLASSES.edit.jumpBlockMs` if you'd rather risk it.

**Loop encoder accel never climbs above 2×.**
The divisor is too high for the encoder's event rate. Lower
`args[3]` (divisor) — try 12 or 8. The `cap` (args[2]) is the
multiplier ceiling.

**Beatjump size change followed by immediate jump skips.**
The `claim` class leaves a 60 ms tail to let the new size settle.
Raise `claim.claimMs` if the jump still reads the old size.

**Escape detector fires on a legit fast gesture.**
Either bump `jumpBlockMs` for the class, or override the specific
binding with a looser inline class. If the gesture is really
correct and the throttle is wrong, `rate: false` opts out — but
the boot audit will remind you it disagrees with inference.