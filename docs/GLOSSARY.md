# Glossary

One-line definitions. Alphabetical. Where a term has a longer
explanation, the doc it lives in is linked.

---

| Term | Meaning |
|---|---|
| **Active deck** | Which of the two deck slots (`A` or `B`) the top half currently points at. |
| **Active FX** | Which of the two FX slots (`A` or `B`) the top half currently points at. |
| **Alt** | The slot that *isn't* focused. `$DECK_ALT$`, `selectedFxAlt`, etc. |
| **Beat cascade** | The colour sequence driven by the beat count. Fires `prePhrase > phrase > bar > beat`. See CONCEPTS §10. |
| **Beat count** | `absolute beat − phrase origin + 1`. Drives the cascade. |
| **Binding** | One physical control's full definition: what it writes to, what its LED reads, what the LED looks like. CONCEPTS §2. |
| **Boot flavour** | Preset's starting config — MIDI channel, initial focus, initial patches. Four playback presets differ only in this. |
| **Builders** | `XoneK3.builders.*` — config-side helpers that produce binding objects (`eqKnob`, `fxEnabled`, `fxGroupEnable`, etc.). |
| **Chord** | Shift + layer, held. Reaches overlays and top-half mode swaps. CONTROLS §2. |
| **Class** | See *Rate class*. |
| **CO** | Mixxx control. `[Channel1],play`, `[EffectRack1_EffectUnit1],mix`, etc. |
| **colorLab** | Separate preset, separate layer tree, same runtime. LED ramp editor. LAB.md. |
| **Count** | See *Beat count*. |
| **Co-match** | A steering gradient shown on a deviation LED when the physical knob position differs from its bound CO by more than `CO_MATCH_EPSILON` (1/127). CONCEPTS §8. |
| **Curve** | A scheme field. Warps the boundaries between stops. |
| **Deviation LED** | An LED with a `knob:` reference in its `colorScheme`. Samples a ramp at the knob's position. |
| **Display source** | Which timeline feeds the beat count: `track` or `loop`. CONCEPTS §9, timelines.md. |
| **Escape** | A loop turning off unexpectedly, within `ESCAPE_DETECT_WINDOW_MS` (500) of a rate claim. Logged to the console. CUSTOMISE → Diagnostics. |
| **Focus** | Which slot (A or B) the top half points at. Two axes: deck focus and FX focus. CONCEPTS §7. |
| **Func** | A JavaScript function that replaces a binding's default input handling. `XoneK3.FUNCS.*`. |
| **FX layout table** | The per-unit cell mapping for the middle cells, one table per mode. CONTROLS §7. |
| **Group** | A Mixxx group string. `[Channel1]`, `[EffectRack1_EffectUnit2]`, `[EqualizerRack1_..._Effect1]`. |
| **Host** | An overlay patch's `_host` field — the list of patches it's allowed to apply over. |
| **Layer** | One of the three bottom-half grids: cue, loop, oddLoop. |
| **Layer tree** | The full set of patches a preset defines. Two exist: `CAT_LAYERS` (playback) and the lab tree. |
| **Layout cell** | A cell whose binding changes per FX unit. Comes from an FX layout table, not the base patch. |
| **Loop clock** | The virtual timeline. Advances in musical time, seeded from the playhead when a loop starts, stopped when the loop ends. CONCEPTS §9, timelines.md. |
| **Main cue** | The track's primary cue point — distinct from hotcues. Moves rather than deletes; cleared by writing `1` to `[ChannelN],cue_clear`. |
| **Marker** | A colour band on a scheme. Shown when a deviation LED samples within a target position ± width. |
| **Origin** | The beat number where "count 1" sits. Shared by both timelines. CONCEPTS §9. |
| **Overlay** | A patch with `_host`. Applies on top of its hosts while active. CONCEPTS §5. |
| **Patch** | A named bag of bindings. Can inherit from other patches. CONCEPTS §3. |
| **Patch family** | A group of patches that share a base and differ by index (`fxLayout1..4`, `fxMini1..4`). |
| **Phrase** | One full cycle of the beat cascade. Default: 4 bars × 4 beats = 16 beats. |
| **PHRASE_MARKER_COLORS** | List of hotcue colour hexes. Pressing a hotcue whose colour is in the list sets the phrase origin. `xone-k3-cat-schemes.js`. |
| **Preset** | A `.midi.xml` + a boot init. Five ship: Cat, Kitten, oneK3, oneK3 miniFX, colorLab. |
| **QFX** | Mixxx Quick Effect Rack. One per deck. |
| **Ramp** | A multi-stop scheme. Deviation LEDs sample it; static LEDs pick `ramp[0]`. |
| **Rate class** | A throttle profile: `jump`, `edit`, `claim`, or `free`. Applied at `Binding.input()`. CONCEPTS §11. |
| **Rate gate** | The check that reads a rate class and allows or rejects an event. |
| **Scheme** | An LED's appearance. Static (one colour) or deviation (a ramp sampled by position). CONCEPTS §8. |
| **Scheme registry** | `XoneK3.SCHEMES`. Named schemes usable by string. |
| **Shift companion** | A patch paired with a base via `_shift`. Applies while shift is held. CONCEPTS §5. |
| **Stack** | The flattened binding map built from `activePatches` + shift companions + chord. CONCEPTS §4. |
| **Soft takeover** | Mixxx's behaviour: an absolute control is ignored after a rebind until its physical position crosses the CO value within Mixxx's internal tolerance (~1/128). Prevents value jumps on layer switch. |
| **Static LED** | An LED with no `knob:` reference. On/off only. Picks `ramp[0]` if given a ramp. |
| **Takeover bridge** | The zero-distance write in `_rearmSoftTakeover` when physical is already near CO at rebind time. Forces Mixxx to accept subsequent writes. Uses `TAKEOVER_EPSILON` (2/127). INTERNALS §25. |
| **Timeline** | One of two sources for the beat count: track or loop clock. |
| **Token** | A `$NAME$` placeholder in a binding field that resolves at bind time. `$DECK_ACTIVE$`, `$FX_ALT_N$`, etc. CONCEPTS §6. |
| **Top-half mode** | `focus`, `twoDeck`, or `twoDeckMini`. Selected by which base patch is in `activePatches`. CONCEPTS §7. |
| **Track** | The default timeline: `playposition`, with the intro marker as beat 0. |
| **Virtual clock** | The loop clock. Advances independently of the playhead. |

---

## Where each term is explained

| Concept | Full explanation |
|---|---|
| Binding, patch, stack | CONCEPTS §2–4 |
| Shift, overlay | CONCEPTS §5 |
| Token, focus, mode | CONCEPTS §6–7 |
| Scheme | CONCEPTS §8 |
| Timeline | CONCEPTS §9, timelines.md |
| Beat cascade | CONCEPTS §10 |
| Rate class | CONCEPTS §11 |
| Rate internals | INTERNALS §27 |
| Preset deltas | CONTROLS §6 |
| FX cells | CONTROLS §7 |