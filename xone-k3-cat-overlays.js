// xone-k3-cat-overlays.js — Cat's two routing overlays and the
// chord.
//
// Shift companions are shallow clones of their base, so grid
// cells don't get shadowed by cueShift / loopShift when shift
// is held. Chord sits on top of everything — see _buildStack.

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-cat-overlays.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-cat-overlays.js',
        ['FUNCS', 'builders', 'CAT']);

    var F = XoneK3.FUNCS;
    var CAT = XoneK3.CAT;

    // ============================================================
    // CELL EMITTERS
    // ============================================================

    // Deck select: assigns channel N to deck slot A/B. LED colour
    // is the slot's theme, read live so a THEME.deck mutation
    // propagates on the next repaint. On-state matches the current
    // assignment.
    //
    // On-brightness comes from the THEME entry (127 in the shipped
    // config). Off-brightness falls back to DEFAULT_RGB_BRIGHTNESS_OFF
    // (lib-core.js). Unselected cells render dim in their own colour,
    // not black — the whole row stays readable as a menu.
    function deckSelect(slot, n) {
        return {
            func: F.k3Select, args: ['deck', slot, n],
            colorScheme: {
                scheme: function() { return XoneK3.THEME.deck[n]; },
                on: { state: 'selectedDeck' + slot, equals: n }
            }
        };
    }

    // FX select: assigns unit N to FX slot A/B. Same shape as
    // deckSelect, live THEME.fx read, same dim-off default.
    function fxSelect(slot, n) {
        return {
            func: F.k3Select, args: ['fx', slot, n],
            colorScheme: {
                scheme: function() { return XoneK3.THEME.fx[n]; },
                on: { state: 'selectedFx' + slot, equals: n }
            }
        };
    }

    // Routing toggle: enables FX unit `unit` into channel `ch`.
    // Colour follows THEME.fx[unit] live.
    //
    // Deliberately hand-built group key rather than
    // `B.fxGroupEnable(unit, ch, ...)`:
    //   - B.fxGroupEnable is the deviation-path builder — its
    //     scheme is composed and expects a `knob:` reference. This
    //     cell is a static LED with a live-THEME function scheme.
    //   - B.fxGroupEnable's `deck` argument is normally a token
    //     ($DECK_A_N$, etc.). Passing '[Channel1]' verbatim works
    //     but reads wrong; the builder inlines it into
    //     'group_<deck>_enable' and doesn't strip brackets.
    //   - composeScheme would add per-render allocation for no
    //     gain: the scheme is a single deferred THEME lookup.
    function routeTo(unit, ch) {
        var key = 'group_[Channel' + ch + ']_enable';
        return {
            group: '[EffectRack1_EffectUnit' + unit + ']',
            inKey: key, outKey: key,
            colorScheme: { scheme: function() { return XoneK3.THEME.fx[unit]; } }
        };
    }

    // ============================================================
    // SELECT_AB — deck / FX assignment grid
    // ============================================================
    //   row 0: deck A → channel 1..4
    //   row 1: deck B → channel 1..4
    //   row 2: FX A   → unit 1..4
    //   row 3: FX B   → unit 1..4
    var SELECT_AB = {
        _host: ['twoDeck', 'twoDeckMini', 'topShared'],
        layer: { func: F.layerExitOverlay, args: ['selectAB'],
                 colorScheme: { scheme: 'overlayWhite' } },
        pressR: { func: F.loadSelectedTrack },

        grid0_0: deckSelect('A', 1), grid1_0: deckSelect('A', 2),
        grid2_0: deckSelect('A', 3), grid3_0: deckSelect('A', 4),
        grid0_1: deckSelect('B', 1), grid1_1: deckSelect('B', 2),
        grid2_1: deckSelect('B', 3), grid3_1: deckSelect('B', 4),

        grid0_2: fxSelect('A', 1),   grid1_2: fxSelect('A', 2),
        grid2_2: fxSelect('A', 3),   grid3_2: fxSelect('A', 4),
        grid0_3: fxSelect('B', 1),   grid1_3: fxSelect('B', 2),
        grid2_3: fxSelect('B', 3),   grid3_3: fxSelect('B', 4)
    };

    // ============================================================
    // FX_ROUTING — FX unit group enables
    // ============================================================
    //   row N: FX<N+1> → channel 1..4
    var FX_ROUTING = {
        _host: ['twoDeck', 'twoDeckMini', 'topShared'],
        layer: { func: F.layerExitOverlay, args: ['fxRouting'],
                 colorScheme: { scheme: 'overlayWhite' } },

        grid0_0: routeTo(1, 1), grid1_0: routeTo(1, 2),
        grid2_0: routeTo(1, 3), grid3_0: routeTo(1, 4),
        grid0_1: routeTo(2, 1), grid1_1: routeTo(2, 2),
        grid2_1: routeTo(2, 3), grid3_1: routeTo(2, 4),
        grid0_2: routeTo(3, 1), grid1_2: routeTo(3, 2),
        grid2_2: routeTo(3, 3), grid3_2: routeTo(3, 4),
        grid0_3: routeTo(4, 1), grid1_3: routeTo(4, 2),
        grid2_3: routeTo(4, 3), grid3_3: routeTo(4, 4)
    };

    // Shift companions are shallow clones so their grid cells
    // don't get shadowed by cueShift / loopShift when shift is held.
    var SELECT_AB_SHIFT  = Object.assign({}, SELECT_AB);
    var FX_ROUTING_SHIFT = Object.assign({}, FX_ROUTING);
    SELECT_AB._shift  = 'selectABShift';
    FX_ROUTING._shift = 'fxRoutingShift';

    // ============================================================
    // CHORD
    // ============================================================
    var CHORD = {
        press0: { func: F.toggleOverlay, args: ['fxRouting', ['selectAB']],
                  colorScheme: { scheme: 'overlayChord' } },
        press1: { func: F.toggleOverlay, args: ['selectAB', ['fxRouting']],
                  colorScheme: { scheme: 'overlayChord' } },
        press3: { func: F.shutdownHold },
        pressR: { func: F.toggleTopMode,
                  colorScheme: { scheme: 'overlayChord',
                                 on: { patchActive: ['twoDeck', 'twoDeckMini'] } } },
        pressL: { func: F.toggleMiniFx,
                  colorScheme: { scheme: 'overlayChord',
                                 on: { patchActive: 'twoDeckMini' } } },

        // chord + slip: layer-scoped overlay toggle.
        //   cue  → hotcue 9-16
        //   loop → odd loop sizes + yellow beatjump indicator
        grid2_1: { func: F.toggleLayerOverlay,
                   args: ['hotcue916', 'loopOdd'] }
    };

    // ============================================================
    // EXPORTS
    // ============================================================
    CAT.SELECT_AB = SELECT_AB;
    CAT.SELECT_AB_SHIFT = SELECT_AB_SHIFT;
    CAT.FX_ROUTING = FX_ROUTING;
    CAT.FX_ROUTING_SHIFT = FX_ROUTING_SHIFT;
    CAT.CHORD = CHORD;
})();