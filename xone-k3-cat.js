// xone-k3-cat.js — Cat preset assembler.
//
// Loads LAST of the cat-* files. Does two things:
//   1. Assembles XoneK3.CAT_LAYERS from the pieces built by the
//      earlier cat files (schemes, fx layouts, top, bottom,
//      overlays).
//   2. Defines XoneK3.bootCat() and the default init / shutdown
//      entry points.
//
// Kitten / oneK3 / oneK3 miniFX load this file last and override
// XoneK3.init with their own bootCat() call. colorLab loads this
// file, then lab.js, then colorlab.js — colorlab.js overrides
// init.
//
// Top-half modes (focus / twoDeck / twoDeckMini) share one layer
// tree. The mode itself is inferred from activePatches — see
// XoneK3.TOP_MODES in lib-controller.js.

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-cat.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-cat.js', ['CAT']);

    var CAT = XoneK3.CAT;

    // ============================================================
    // LAYER TREE
    // ============================================================
    XoneK3.CAT_LAYERS = {
        // Top — focus mode
        topShared:        CAT.TOP_SHARED,
        topSharedShift:   CAT.TOP_SHARED_SHIFT,
        fxLayout1:        CAT.fxLayout(1),
        fxLayout2:        CAT.fxLayout(2),
        fxLayout3:        CAT.fxLayout(3),
        fxLayout4:        CAT.fxLayout(4),

        // Top — twoDeck mode
        twoDeck:          CAT.TWO_DECK,
        twoDeckShift:     CAT.TWO_DECK_SHIFT,
        fxLayoutA1:       CAT.twoDeckFxLayout('A', 1),
        fxLayoutA2:       CAT.twoDeckFxLayout('A', 2),
        fxLayoutA3:       CAT.twoDeckFxLayout('A', 3),
        fxLayoutA4:       CAT.twoDeckFxLayout('A', 4),
        fxLayoutB1:       CAT.twoDeckFxLayout('B', 1),
        fxLayoutB2:       CAT.twoDeckFxLayout('B', 2),
        fxLayoutB3:       CAT.twoDeckFxLayout('B', 3),
        fxLayoutB4:       CAT.twoDeckFxLayout('B', 4),

        // Top — twoDeck mini FX mode
        twoDeckMini:      CAT.TWO_DECK_MINI,
        twoDeckMiniShift: CAT.TWO_DECK_MINI_SHIFT,
        fxMini1:          CAT.twoDeckMiniFxLayout(1),
        fxMini2:          CAT.twoDeckMiniFxLayout(2),
        fxMini3:          CAT.twoDeckMiniFxLayout(3),
        fxMini4:          CAT.twoDeckMiniFxLayout(4),

        // Bottom
        cue:              CAT.CUE,
        cueShift:         CAT.CUE_SHIFT,
        hotcue916:        CAT.CUE_916,
        hotcue916Shift:   CAT.CUE_916_SHIFT,
        loop:             CAT.LOOP,
        loopShift:        CAT.LOOP_SHIFT,
        loopOdd:          CAT.LOOP_ODD,
        loopOddShift:     CAT.LOOP_ODD_SHIFT,

        // Overlays
        selectAB:         CAT.SELECT_AB,
        selectABShift:    CAT.SELECT_AB_SHIFT,
        fxRouting:        CAT.FX_ROUTING,
        fxRoutingShift:   CAT.FX_ROUTING_SHIFT,

        chord:            CAT.CHORD
    };

    // ============================================================
    // BOOT
    // ============================================================
    var BOOT_DEFAULTS = {
        label: 'Cat',
        midiChannel: 0x0E,
        initialDeckA: 1, initialDeckB: 2,
        initialFxA: 1,   initialFxB: 2,
        initialActiveDeck: 'A',
        initialActiveFx:   'A',
        initialPatches: ['topShared', 'fxLayout1', 'cue'],
        sysex: true,
        timeSig: null
    };

    XoneK3.bootCat = function(overrides) {
        var cfg = Object.assign({}, XoneK3.HARDWARE_CALIB, BOOT_DEFAULTS, overrides);
        if (!cfg.patches) cfg.patches = XoneK3.CAT_LAYERS;
        XoneK3.boot([cfg]);
    };

    XoneK3.init = function() { XoneK3.bootCat({}); };
    XoneK3.shutdown = function() { XoneK3.halt(); };
})();