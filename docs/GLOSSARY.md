# Glossary

Alphabetical. One line each.

---

| Term | Meaning |
|---|---|
| **Active deck** | Which of the two deck slots (`A` / `B`) the top half currently points at. |
| **Active FX** | Which of the two FX slots (`A` / `B`) the top half currently points at. |
| **Alt** | The slot that isn't focused. `$DECK_ALT$`, `selectedFxAlt`, etc. |
| **Beat cascade** | The colour sequence driven by the beat count: `prePhrase > phrase > bar > beat`. |
| **Beat count** | `absolute beat - phrase origin + 1`. Drives the cascade. |
| **Beatjump gate** | Beatjumps are blocked when the target channel has an active loop and less than `BEATJUMP_GAP_MS` (130 ms) has elapsed since the last loop-touching event on that channel. |
| **Binding** | One physical control's full definition: which Mixxx CO it acts on, what its LED reads, what the LED looks like, optional custom func. |
| **Chord** | Shift + layer, held. Reaches overlays and top-half mode swaps. |
| **CO** | Mixxx control. `[Channel1],play`, `[EffectRack1_EffectUnit1],mix`, etc. |
| **Co-match** | A steering gradient shown on a deviation LED when the physical knob disagrees with its bound CO. Turn until they match. |
| **colorLab** | The LED ramp editor preset. Separate layer tree, no playback. |
| **Deviation LED** | An LED with a `knob:` reference in its `colorScheme`. Samples a ramp at the knob's position. |
| **Display source** | Which timeline feeds the beat count: `track` or `loop`. |
| **Focus** | Which slot (A / B) the top half points at. Two axes: deck and FX. |
| **Func** | A JavaScript function replacing a binding's default input handling. `XoneK3.FUNCS.*`. |
| **FX layout table** | The per-unit cell mapping for the middle cells, one table per mode. |
| **Group** | A Mixxx group string. `[Channel1]`, `[EffectRack1_EffectUnit2]`, etc. |
| **Host** | An overlay patch's `_host` field — the patches it may apply over. |
| **Loop clock** | The virtual timeline. Advances in musical time, seeded from the playhead when a loop starts, stopped when the loop ends. |
| **Main cue** | The track's primary cue point. Cleared by writing `1` to `[ChannelN],cue_clear`; a `cue_point` write moves it. |
| **Marker** | A colour band on a scheme. Shown when a deviation LED samples within `markerPosition ± markerWidth`. |
| **Origin** | The beat number where "count 1" sits. Derived from marker hotcues. |
| **Overlay** | A patch with `_host`. Applies on top of its hosts while active. |
| **Patch** | A named bag of bindings. Can inherit from other patches. |
| **Phrase** | One full cycle of the beat cascade. Default 4 bars × 4 beats = 16 beats. |
| **QFX** | Mixxx Quick Effect Rack. One per deck. |
| **Ramp** | A multi-stop scheme. Deviation LEDs sample it; static LEDs pick `ramp[0]`. |
| **Scheme** | An LED's appearance. Static (one colour) or deviation (a ramp sampled by position). |
| **Shift companion** | A patch paired with a base via `_shift`. Applies while shift is held. |
| **Stack** | The flattened binding map built from `activePatches` + shift companions + chord. |
| **Static LED** | An LED with no `knob:` reference. On/off only. Picks `ramp[0]` if given a ramp. |
| **Token** | A `$NAME$` placeholder in a binding field that resolves at bind time. |
| **Top-half mode** | `focus`, `twoDeck`, or `twoDeckMini`. Inferred from which base patch is in `activePatches`. |
| **Track** | The default timeline: `playposition`, with beat 0 = file start. |