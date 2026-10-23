# Xone K3 — Mixxx mapping

Video intro / explanation of what it does: https://youtu.be/_tXTcp5aIzo

A custom Mixxx mapping for the Allen & Heath Xone K3. Ships five presets (Cat, Kitten, oneK3, oneK3 miniFX, and a standalone LED scheme editor called colorLab) that share one runtime. Built on a layered patch tree: physical controls are described as bindings, bindings are grouped into patches, and the active patch stack is resolved on every state change.

| Preset | Channel | Boot mode | Layer tree | Use case |
|---|---|---|---|---|
| **Cat** | 0x0E | focus | CAT_LAYERS | Main preset. Re-pointable single-deck top half. |
| **Kitten** | 0x0D | focus, slot B | CAT_LAYERS | Second unit, opposite slot by default. |
| **oneK3** | 0x0E | twoDeck | CAT_LAYERS | Single K3, both decks visible. |
| **oneK3 miniFX** | 0x0E | twoDeckMini | CAT_LAYERS | Both decks, one focused FX unit in the middle. |
| **colorLab** | 0x0D | n/a | lab | No playback. LED colour ramp editor. |

## Physical layout

```
    encoder0   encoder1   encoder2   encoder3
    press0     press1     press2     press3

    knob0_0    knob1_0    knob2_0    knob3_0    ← row 0
    button0_0  button1_0  button2_0  button3_0
    knob0_1    knob1_1    knob2_1    knob3_1    ← row 1
    button0_1  button1_1  button2_1  button3_1
    knob0_2    knob1_2    knob2_2    knob3_2    ← row 2
    button0_2  button1_2  button2_2  button3_2

    fader0     fader1     fader2     fader3

    grid0_0    grid1_0    grid2_0    grid3_0
    grid0_1    grid1_1    grid2_1    grid3_1
    grid0_2    grid1_2    grid2_2    grid3_2
    grid0_3    grid1_3    grid2_3    grid3_3

    layer      encoderL   encoderR    shift
               pressL     pressR
```

See `docs/LAYOUT.md` for control explanation.
In lab run in debug mode and move controls to see what they do :)

each one to what it does in the shipped presets.

---

## Files

```
xone-k3-lib-core.js          bootstrap, tunables, RATE_CLASSES,
                             PATCH_NAMES, utilities, tokens,
                             transfer curve, sysex math, beat
                             math, K2 palette, HARDWARE_CALIB,
                             VIRTUAL_CLOCKS, escape-detect
                             constants
xone-k3-lib-schemes.js       palette, scheme engine, LED curves,
                             co-matching
xone-k3-lib-binding.js       Binding primitive, colour render
                             path, rate gate, snapshot fields
xone-k3-lib-controller.js    K3Controller core: constructor,
                             patch resolution, focus, TOP_MODES,
                             chord, binding application,
                             render-time scheme resolution
xone-k3-lib-controller-colour.js  Colour-scheme parser: on:
                                  shapes, base scheme resolution,
                                  schemeFromState closures,
                                  _setupColorScheme
xone-k3-lib-controller-beat.js    Timeline, loop clock,
                                  display-source resolution, beat
                                  count, beat clock connections
xone-k3-lib-controller-render.js  LED writes, sysex queue,
                                  calibration, ramp sampling
xone-k3-lib-controller-boot.js    Rate gate, escape detector,
                                  init / shutdown, MIDI wiring,
                                  boot, halt
xone-k3-lib-funcs.js         builders + XoneK3.FUNCS
xone-k3-lib-inspect.js       runtime state probes

xone-k3-cat-schemes.js       THEME, QFX_CHAIN_LIST,
                             PHRASE_MARKER_COLORS, SCHEMES,
                             scheme helpers
xone-k3-cat-fx.js            FX layout tables + emitters
xone-k3-cat-top.js           focus / twoDeck / mini base patches
xone-k3-cat-bottom.js        cue / loop / oddLoop layers
xone-k3-cat-overlays.js      selectAB / fxRouting / chord
xone-k3-cat.js               CAT_LAYERS assembler + bootCat()

xone-k3-kitten.js            boot override (2 lines)
xone-k3-onek3.js             boot override (2 lines)
xone-k3-onek3-minifx.js      boot override (2 lines)
xone-k3-lab.js               colorLab runtime
xone-k3-colorlab.js          colorLab layers + boot

xone-k3-cat.midi.xml
xone-k3-kitten.midi.xml
xone-k3-onek3.midi.xml
xone-k3-onek3-minifx.midi.xml
xone-k3-colorlab.midi.xml
```
