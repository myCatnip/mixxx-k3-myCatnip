```
                    ┌───────────┬───────────┬───────────┬───────────┐
  TOP               │ encoder0  │ encoder1  │ encoder2  │ encoder3  │
                    │ press0    │ press1    │ press2    │ press3    │
                    ├───────────┼───────────┼───────────┼───────────┤
                    │ knob0_0   │ knob1_0   │ knob2_0   │ knob3_0   │  row 0
                    │ button0_0 │ button1_0 │ button2_0 │ button3_0 │
                    │ knob0_1   │ knob1_1   │ knob2_1   │ knob3_1   │  row 1
                    │ button0_1 │ button1_1 │ button2_1 │ button3_1 │
                    │ knob0_2   │ knob1_2   │ knob2_2   │ knob3_2   │  row 2
                    │ button0_2 │ button1_2 │ button2_2 │ button3_2 │
                    ├───────────┼───────────┼───────────┼───────────┤
  FADERS            │ fader0    │ fader1    │ fader2    │ fader3    │
                    ├───────────┼───────────┼───────────┼───────────┤
  GRID              │ grid0_0   │ grid1_0   │ grid2_0   │ grid3_0   │  row 0
                    │ grid0_1   │ grid1_1   │ grid2_1   │ grid3_1   │  row 1
                    │ grid0_2   │ grid1_2   │ grid2_2   │ grid3_2   │  row 2
                    │ grid0_3   │ grid1_3   │ grid2_3   │ grid3_3   │  row 3
                    ├───────────┼───────────┼───────────┼───────────┤
  BOTTOM            │ layer     │ encoderL  │ encoderR  │ shift     │
                    │           │ pressL    │ pressR    │           │
                    └───────────┴───────────┴───────────┴───────────┘
```

`encoderL`/`encoderR` are separate from `encoder0`–`encoder3`, and `pressL`/`pressR` are separate from `press0`–`press3` — the L/R pair sit at the bottom, beside the layer and shift buttons, with each press-switch directly under its encoder.

Section labels (TOP / FADERS / GRID / BOTTOM) match the blocks in the layout table. `row N` on the right names the physical row (`knobX_N` / `buttonX_N` / `gridX_N`). `layer` and `shift` cycle and hold respectively; the L/R encoders and presses are the performance pair described in the bottom section.
```
════════════════════════════════════════════════════════════
TOP — encoder0-3 / press0-3
════════════════════════════════════════════════════════════

FOCUS  (Cat / Kitten)
enc0:  pregain act.deck       +shift: keyReset  act.deck
enc1:  QFX cycle act.deck     +shift: keySync   act.deck
enc2:  —                      +shift: —
enc3:  —                      +shift: —

press0: active deck ← A       +shift: sync A         LED: theme, bright=active
press1: active deck ← B       +shift: keylock A      LED: theme, bright=active
press2: active fx ← A         +shift: keylock B      LED: theme, bright=active
press3: active fx ← B         +shift: sync B         LED: theme, bright=active

twoDeck  (oneK3)
enc0:  pregain A              +shift: keySync  A
enc1:  QFX cycle A            +shift: keyReset A
enc2:  QFX cycle B            +shift: keyReset B
enc3:  pregain B              +shift: keySync  B

press0: active deck ← A       +shift: sync A         LED: theme deckA, bright=active
press1: FX-A → deck A         +shift: keylock A      LED: FX-A colour
press2: FX-B → deck B         +shift: keylock B      LED: FX-B colour
press3: active deck ← B       +shift: sync B         LED: theme deckB, bright=active

twoDeckMini  (oneK3 miniFX)
enc0-3: inherit twoDeck
press0: active deck ← A       +shift: sync act.deck       LED: theme deckA, bright=active
press1: focused FX → deck A   +shift: keylock act.deck    LED: FX focus colour
press2: focused FX → deck B   +shift: active fx ← A       LED: FX focus colour
press3: active deck ← B       +shift: active fx ← B       LED: theme deckB, bright=active


════════════════════════════════════════════════════════════
GRID — rows 0-1
════════════════════════════════════════════════════════════

grid0_0:  jump −1 beat             +shift: inherit       LED: ramp fader0
grid1_0:  jump +1 beat             +shift: inherit       LED: ramp fader1
grid2_0:  cycle timeline           +shift: LED only      LED: ramp fader2 · bright=track, dim=loop · shift=dim
grid3_0:  CUE: cue                 +shift: clear cue     LED: ramp fader3, tracks cue_indicator
          LOOP/ODD: —              +shift: —             LED: ramp fader3, always lit

grid0_1:  CUE: jump −16            +shift: inherit       LED: purple [69,0,127]
          LOOP/ODD: jump −size     +shift: inherit       LED: magenta
grid1_1:  CUE: jump +16            +shift: inherit       LED: purple
          LOOP/ODD: jump +size     +shift: inherit       LED: magenta
grid2_1:  toggle slip              +shift: flip deck     LED: slipScheme · theme of active-deck ch
grid3_1:  toggle play              +shift: LED only      LED: green=track, yellow=loop


════════════════════════════════════════════════════════════
GRID — rows 2-3
════════════════════════════════════════════════════════════

                         row 2                row 3
                     g0_2 g1_2 g2_2 g3_2   g0_3 g1_3 g2_3 g3_3
CUE     (hotcues)      1    2    3    4      5    6    7    8
  +shift: clear 1-8    —    —    —    —      —    —    —    —

LOOP    (loop sizes)   8    4    2    1     1/16 1/8  1/4  1/2
  +shift: beatjump
  size (same cell map) 8    4    2    1     1/16 1/8  1/4  1/2

ODD     (odd loops)    7    5    3    1     3/32 3/16 3/8  1/2
  +shift: beatjump
  size (same cell map) 7    5    3    1     3/32 3/16 3/8  1/2

LEDs
  CUE hotcues         per-hotcue colour read from Mixxx
  LOOP sizes          green · teal2 (grid3_2 / grid3_3)
  LOOP shift sizes    teal2 · green (grid3_2 / grid3_3)
  ODD sizes           cyan · sky2  (grid3_2 / grid3_3)
  ODD shift sizes     sky2 · cyan  (grid3_2 / grid3_3)

Notes
  CUE hotcue press fires hotcueWithPhraseCheck — sets phrase origin if the
  hotcue's colour is in PHRASE_MARKER_COLORS, then jumps.
  Shift + hotcue = hotcue_N_clear (clears the hotcue slot).
  Loop-size and beatjump-size cells: pressSetValue writes the CO
  (beatloop_size / beatjump_size) on press-release edge.

════════════════════════════════════════════════════════════
FADERS
════════════════════════════════════════════════════════════

FOCUS  (Cat / Kitten)
fader0: pregain act.deck — actually volume act.deck   (inKey: volume)
fader1: FX-act mix                                    (inKey: mix)
fader2: —
fader3: —

twoDeck  (oneK3)
fader0: deck A volume
fader1: FX-A mix
fader2: FX-B mix
fader3: deck B volume

twoDeckMini  (oneK3 miniFX)
inherits twoDeck — faders do NOT follow focus. fader1/fader2 always mix the
pinned A/B units, never $FX_ACTIVE_N$.

Shift / chord
No shift companion, no chord override. Faders are identical in every state.

As LED sources
fader0..fader3 are the deviation knobs for grid row 0:
  grid0_0 reads fader0 · grid1_0 reads fader1
  grid2_0 reads fader2 · grid3_0 reads fader3
Fader position drives the ramp sample; fader N's own binding writes volume/mix.

════════════════════════════════════════════════════════════
LAYER BUTTON  (cycles bottom layer)
════════════════════════════════════════════════════════════

press:  CUE → LOOP → ODD → CUE  (replacePatch swaps the active layer)
LED:    track-end countdown on DECK A (4 phases: green/yellow/amber/red)
+shift: enters the chord (layer press is intercepted)


════════════════════════════════════════════════════════════
BOTTOM — encoderL / pressL / encoderR / pressR
════════════════════════════════════════════════════════════

CUE  (base)
encL:  BPM ±0.1                +shift: master gain
       pressL held → head mix
pressL: hold: encL = head mix
       +shift release (no turn): toggle headSplit
encR:  playlist prev/next       +shift: headphone volume
pressR: hold: arm track load
       while held: TOP press0/3 and selectAB cells load onto that
       channel instead of switching focus

LOOP  (diffs from CUE)
encL:  loop in-point nudge (accel)     +shift: beatjump
pressL: reloop (anchor→0)              +shift: inherit
encR:  loop out-point nudge (accel)    +shift: halve/double beatjump_size
pressR: beatloop activate              +shift: inherit

ODD  (inherits LOOP, no diffs for these four)


════════════════════════════════════════════════════════════
SHIFT BUTTON  (top right)
════════════════════════════════════════════════════════════

press:   isShifted = true → shift layer joins the stack
release: if _chordActive → _exitChord; then isShifted = false
LED:     track-end countdown on DECK B (same phases as layer button)


════════════════════════════════════════════════════════════
CHORD  (shift + layer, both held)
════════════════════════════════════════════════════════════

Enter:  hold shift, press layer, keep both held
Exit:   release shift OR layer, OR trigger shutdown timer

Overrides (top press row only — CHORD patch declares just these):
press0: toggle fxRouting overlay (clears selectAB)
press1: toggle selectAB overlay  (clears fxRouting)
press2: —
press3: hold 2 s → shutdown
pressR: toggleTopMode  (focus ↔ twoDeck-family; mini → focus)
pressL: toggleMiniFx   (twoDeck ↔ mini; focus → no-op)

Passes through unchanged:
enc0-3:  whatever the active top mode bound them to (chord holds shift, so
         shift-layer applies if that mode defines one)
encL/R:  whatever the active bottom layer bound them to
grids:   chord requires shift held, so grid cells behave as shifted

Overlays (enter via chord, exit via layer press or toggle again):

selectAB
  grid row 0: deck A ← channel 1-4
  grid row 1: deck B ← channel 1-4
  grid row 2: fx A   ← unit 1-4
  grid row 3: fx B   ← unit 1-4
  Layer press: exit
  pressR held + tap a deck cell: load onto that channel

fxRouting
  gridN_M: toggle FX(N+1) → channel(M+1) group-enable
  Layer press: exit
```