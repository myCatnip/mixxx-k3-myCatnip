// xone-k3-cat-top.js — Cat's three top-half base patches and
// their shift companions.
//
//   TOP_SHARED        focus mode base
//   TWO_DECK          twoDeck mode base
//   TWO_DECK_MINI     mini mode base (inherits twoDeck)
//
// Layout patches (fxLayout<n> etc.) come from cat-fx.js. This
// file only defines the shared top-half scaffolding: encoders,
// press row, EQ columns, QFX, faders, and the mode-shift overrides
// that aren't layout-specific.
//
// Loads after cat-schemes.js (needs fxSchemeFor, FX_COLOR_MAP,
// countdownScheme).

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-cat-top.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-cat-top.js',
        ['FUNCS', 'builders', 'CAT']);

    var F = XoneK3.FUNCS;
    var B = XoneK3.builders;
    var CAT = XoneK3.CAT;

    var QFX = '[QuickEffectRack1_$DECK_ACTIVE$]';

    // Focus-mode slot button. Selects which of the two slots (A / B)
    // is active, for deck or FX. LED colour is the theme colour of
    // whatever channel / unit is currently pinned to that slot, read
    // live so a selectAB reassignment propagates on the next repaint.
    // Brightness is on when this slot is the active one.
    function activeSlotButton(kind, which) {
        var themeMap  = (kind === 'deck') ? 'deck' : 'fx';
        var selProp   = (kind === 'deck')
            ? (which === 'A' ? 'selectedDeckA' : 'selectedDeckB')
            : (which === 'A' ? 'selectedFxA'   : 'selectedFxB');
        var activeState = (kind === 'deck') ? 'activeDeck' : 'activeFx';
        var func = (kind === 'deck') ? F.setActiveDeckTo : F.setActiveFxTo;
        return {
            func: func, args: [which],
            colorScheme: {
                scheme: function() {
                    var ctrl = this._ctrl;
                    if (!ctrl) return 'off';
                    return XoneK3.THEME[themeMap][ctrl[selProp]];
                },
                on: { state: activeState, equals: which }
            }
        };
    }

    // Positional slot indicator for twoDeck / mini press0 / press3.
    // LED colour is the theme of whatever channel is pinned to the
    // slot, read live from THEME.deck so a selectAB reassignment
    // propagates on the next repaint. Bright when this slot is the
    // active deck, dim otherwise — the inactive state uses the
    // default off-ramp brightness (DEFAULT_RGB_BRIGHTNESS_OFF, 12),
    // and the active state uses whatever brightness the THEME entry
    // carries (or DEFAULT_RGB_BRIGHTNESS if none).
    function slotIndicator(slot, themeProp) {
        return {
            colorScheme: {
                scheme: function() {
                    var ctrl = this._ctrl;
                    if (!ctrl) return 'off';
                    return XoneK3.THEME.deck[ctrl[themeProp]];
                },
                on: { state: 'activeDeck', equals: slot }
            }
        };
    }

    // ============================================================
    // TOP_SHARED — focus mode base
    // ============================================================
    // Row 0 (knob1_0 / knob2_0 / knob3_0 + their buttons) is NOT
    // here — it's owned by the fxLayout<n> layout patch. Row 2
    // (knob1_2 / knob2_2 / knob3_2 + buttons) also comes from the
    // layout patch, except knob1_2 / button1_2 which are the QFX
    // cells: a plain binding here, live, LED tracks the loaded
    // chain via schemeFromState.
    var TOP_SHARED = {
        encoder0: { func: F.encPregainStep, args: [0.025], group: '$DECK_ACTIVE$', inKey: 'pregain' },
        encoder1: { func: F.encQuickFxCycle, group: QFX },
        encoder2: null,
        encoder3: null,

        press0: activeSlotButton('deck', 'A'),
        press1: activeSlotButton('deck', 'B'),
        press2: activeSlotButton('fx',   'A'),
        press3: activeSlotButton('fx',   'B'),

        knob0_0: B.eqKnob('$DECK_ACTIVE$', 'high'),
        button0_0: { group: '$DECK_ACTIVE$', inKey: 'pfl', outKey: 'pfl',
                     colorScheme: { knob: 'knob0_0', scheme: 'myCatnip' } },
        knob0_1: B.eqKnob('$DECK_ACTIVE$', 'mid'),
        button0_1: B.fxHeadphone('$FX_ACTIVE_N$',
                                 { knob: 'knob0_1', scheme: 'myCatnip', markerColor: 'orange' }),
        knob0_2: B.eqKnob('$DECK_ACTIVE$', 'low'),
        button0_2: B.fxGroupEnable('$FX_ALT_N$', '$DECK_ACTIVE$',
                                   Object.assign({ knob: 'knob0_2' },
                                                 CAT.fxSchemeFor('selectedFxAlt'))),

        knob1_2: { group: QFX, inKey: 'super1' },
        button1_2: {
            group:  QFX,
            inKey:  'enabled',
            outKey: 'enabled',
            colorScheme: {
                knob:   'knob1_2',
                scheme: XoneK3.QFX_CHAIN_LIST[0],
                schemeFromState: {
                    co:    'loaded_chain_preset',
                    group: QFX,
                    list:  XoneK3.QFX_CHAIN_LIST
                }
            }
        },

        fader0: { group: '$DECK_ACTIVE$', inKey: 'volume' },
        fader1: B.fxMix('$FX_ACTIVE_N$'),

        // Shift button pulses with Deck B's track-end countdown.
        shift: { func: F.shiftToggle,
                 group: '$DECK_B$',
                 outKey: 'track_loaded',
                 colorScheme: { scheme: CAT.countdownScheme() } },
    };
    TOP_SHARED._shift = 'topSharedShift';

    var TOP_SHARED_SHIFT = {
        press0: { group: '$DECK_A$', inKey: 'sync_enabled', outKey: 'sync_enabled',
                  colorScheme: { scheme: 'syncOn' } },
        press1: { group: '$DECK_A$', inKey: 'keylock', outKey: 'keylock',
                  colorScheme: { scheme: 'keylockOn' } },
        press2: { group: '$DECK_B$', inKey: 'keylock', outKey: 'keylock',
                  colorScheme: { scheme: 'keylockOn' } },
        press3: { group: '$DECK_B$', inKey: 'sync_enabled', outKey: 'sync_enabled',
                  colorScheme: { scheme: 'syncOn' } },
        encoder0: { func: F.encKeySync, group: '$DECK_ACTIVE$' },
        encoder1: { func: F.encKeyReset, group: '$DECK_ACTIVE$' }
        
    };

    // ============================================================
    // TWO_DECK — twoDeck mode base
    // ============================================================
    var TWO_DECK = {
        shift: { func: F.shiftToggle,
                 group: '$DECK_B$',
                 outKey: 'track_loaded',
                 colorScheme: { scheme: CAT.countdownScheme() } },

        encoder0: { func: F.encPregainStep, args: [0.025], group: '$DECK_A$', inKey: 'pregain' },
        encoder1: { func: F.encQuickFxCycle, group: '[QuickEffectRack1_$DECK_A$]' },
        encoder2: { func: F.encQuickFxCycle, group: '[QuickEffectRack1_$DECK_B$]' },
        encoder3: { func: F.encPregainStep, args: [0.025], group: '$DECK_B$', inKey: 'pregain' },

        // press0 / press3 are positional A/B slot indicators.
        // The button pins a specific channel into its slot
        // (k3Select) — or, with pressR held on the cue layer,
        // loads the selected track onto that channel. The LED
        // ignores the button action and always shows the theme
        // colour of whatever deck is *currently* in the slot.
        press0: Object.assign(
            { func: F.setActiveDeckTo, args: ['A'] },
            slotIndicator('A', 'selectedDeckA')
        ),
        press1: B.fxGroupEnable('$FX_A_N$', '[Channel$DECK_A_N$]', {
            schemeFromState: { state: 'selectedFxA', map: CAT.FX_COLOR_MAP }
        }),
        press2: B.fxGroupEnable('$FX_B_N$', '[Channel$DECK_B_N$]', {
            schemeFromState: { state: 'selectedFxB', map: CAT.FX_COLOR_MAP }
        }),
        press3: Object.assign(
            { func: F.setActiveDeckTo, args: ['B'] },
            slotIndicator('B', 'selectedDeckB')
        ),

        knob0_0: B.eqKnob('$DECK_A$', 'high'),
        knob0_1: B.eqKnob('$DECK_A$', 'mid'),
        knob0_2: B.eqKnob('$DECK_A$', 'low'),
        button0_0: { group: '$DECK_A$', inKey: 'pfl', outKey: 'pfl',
                     colorScheme: { knob: 'knob0_0', scheme: 'myCatnip' } },
        button0_1: B.fxHeadphone('$FX_A_N$', { knob: 'knob0_1', scheme: 'myCatnip', markerColor: 'orange' }),
        button0_2: B.fxGroupEnable('$FX_B_N$', '$DECK_A$',
                                   Object.assign({ knob: 'knob0_2' },
                                                 CAT.fxSchemeFor('selectedFxB'))),

        knob1_2: { group: '[QuickEffectRack1_$DECK_A$]', inKey: 'super1' },
        button1_2: {
            group:  '[QuickEffectRack1_$DECK_A$]',
            inKey:  'enabled',
            outKey: 'enabled',
            colorScheme: {
                knob:   'knob1_2',
                scheme: XoneK3.QFX_CHAIN_LIST[0],
                schemeFromState: {
                    co:    'loaded_chain_preset',
                    group: '[QuickEffectRack1_$DECK_A$]',
                    list:  XoneK3.QFX_CHAIN_LIST
                }
            }
        },

        knob2_2: { group: '[QuickEffectRack1_$DECK_B$]', inKey: 'super1' },
        button2_2: {
            group:  '[QuickEffectRack1_$DECK_B$]',
            inKey:  'enabled',
            outKey: 'enabled',
            colorScheme: {
                knob:   'knob2_2',
                scheme: XoneK3.QFX_CHAIN_LIST[0],
                schemeFromState: {
                    co:    'loaded_chain_preset',
                    group: '[QuickEffectRack1_$DECK_B$]',
                    list:  XoneK3.QFX_CHAIN_LIST
                }
            }
        },

        knob3_0: B.eqKnob('$DECK_B$', 'high'),
        knob3_1: B.eqKnob('$DECK_B$', 'mid'),
        knob3_2: B.eqKnob('$DECK_B$', 'low'),
        button3_0: { group: '$DECK_B$', inKey: 'pfl', outKey: 'pfl',
                     colorScheme: { knob: 'knob3_0', scheme: 'myCatnip' } },
        button3_1: B.fxHeadphone('$FX_B_N$', { knob: 'knob3_1', scheme: 'myCatnip', markerColor: 'orange' }),
        button3_2: B.fxGroupEnable('$FX_A_N$', '$DECK_B$',
                                   Object.assign({ knob: 'knob3_2' },
                                                 CAT.fxSchemeFor('selectedFxA'))),

        fader0: { group: '$DECK_A$', inKey: 'volume' },
        fader1: B.fxMix('$FX_A_N$'),
        fader2: B.fxMix('$FX_B_N$'),
        fader3: { group: '$DECK_B$', inKey: 'volume' }
    };
    TWO_DECK._shift = 'twoDeckShift';

    var TWO_DECK_SHIFT = {
        encoder0: { func: F.encKeySync, group: '$DECK_A$' },
        encoder1: { func: F.encKeyReset,     group: '$DECK_A$' },
        encoder2: { func: F.encKeyReset,     group: '$DECK_B$' },
        encoder3: { func: F.encKeySync, group: '$DECK_B$' },
        press0: { group: '$DECK_A$', inKey: 'sync_enabled', outKey: 'sync_enabled',
                  colorScheme: { scheme: 'syncOn' } },
        press1: { group: '$DECK_A$', inKey: 'keylock', outKey: 'keylock',
                  colorScheme: { scheme: 'keylockOn' } },
        press2: { group: '$DECK_B$', inKey: 'keylock', outKey: 'keylock',
                  colorScheme: { scheme: 'keylockOn' } },
        press3: { group: '$DECK_B$', inKey: 'sync_enabled', outKey: 'sync_enabled',
                  colorScheme: { scheme: 'syncOn' } }
    };

    // ============================================================
    // TWO_DECK_MINI — twoDeck with one focused FX unit spanning
    // both middle columns. Inherits everything from twoDeck except
    // the two group-enable presses, which now target the focused
    // unit ($FX_ACTIVE_N$) instead of pinned A / B.
    // ============================================================
    var TWO_DECK_MINI = {
        patch: ['twoDeck'],
        // Press row: focused unit into each pinned deck. Static LED,
        // theme colour follows focus.
        press1: B.fxGroupEnable('$FX_ACTIVE_N$', '[Channel$DECK_A_N$]', {
            schemeFromState: { state: 'selectedFxCurrent', map: CAT.FX_COLOR_MAP }
        }),
        press2: B.fxGroupEnable('$FX_ACTIVE_N$', '[Channel$DECK_B_N$]', {
            schemeFromState: { state: 'selectedFxCurrent', map: CAT.FX_COLOR_MAP }
        }),
        // Low-EQ cells: alt unit into each pinned deck. Deviation
        // LED — tracks the low EQ knob, colour swaps with
        // selectedFxAlt. Same shape as twoDeck's cross-route cells.
        button0_2: B.fxGroupEnable('$FX_ALT_N$', '$DECK_A$',
                                Object.assign({ knob: 'knob0_2' },
                                                CAT.fxSchemeFor('selectedFxAlt'))),
        button3_2: B.fxGroupEnable('$FX_ALT_N$', '$DECK_B$',
                                Object.assign({ knob: 'knob3_2' },
                                                CAT.fxSchemeFor('selectedFxAlt')))
    };
    TWO_DECK_MINI._shift = 'twoDeckMiniShift';

    // Shift overrides for mini: press2 / press3 set the focused
    // FX unit (A / B), matching focus mode's shift behaviour.
    // Every other shift cell inherits from twoDeckShift.
    var TWO_DECK_MINI_SHIFT = {
        press0: { group: '$DECK_ACTIVE$', inKey: 'sync_enabled', outKey: 'sync_enabled',
                  colorScheme: { scheme: 'syncOn' } },
        press1: { group: '$DECK_ACTIVE$', inKey: 'keylock', outKey: 'keylock',
                  colorScheme: { scheme: 'keylockOn' } },
        press2: { func: F.setActiveFxTo, args: ['A'],
                  colorScheme: {
                      schemeFromState: { state: 'selectedFxA', map: CAT.FX_COLOR_MAP },
                      on: { state: 'activeFx', equals: 'A' }
                  } },
        press3: { func: F.setActiveFxTo, args: ['B'],
                  colorScheme: {
                      schemeFromState: { state: 'selectedFxB', map: CAT.FX_COLOR_MAP },
                      on: { state: 'activeFx', equals: 'B' }
                  } }
    };

    // ============================================================
    // EXPORTS
    // ============================================================
    CAT.TOP_SHARED = TOP_SHARED;
    CAT.TOP_SHARED_SHIFT = TOP_SHARED_SHIFT;
    CAT.TWO_DECK = TWO_DECK;
    CAT.TWO_DECK_SHIFT = TWO_DECK_SHIFT;
    CAT.TWO_DECK_MINI = TWO_DECK_MINI;
    CAT.TWO_DECK_MINI_SHIFT = TWO_DECK_MINI_SHIFT;
})();