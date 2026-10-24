// xone-k3-cat-bottom.js — Cat's cue / loop / oddLoop layers and
// their shift companions.
//
// CUE and LOOP are siblings. ODD inherits from LOOP via
// patch: ['loop']. Any cell that must work in both CUE and LOOP
// is defined in both — sibling inheritance is not a thing.
//
// Loads after cat-schemes.js (needs countdownScheme, slipScheme,
// PLAY_LED_SCHEME).

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-cat-bottom.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-cat-bottom.js',
        ['FUNCS', 'builders', 'CAT']);

    var F = XoneK3.FUNCS;
    var B = XoneK3.builders;
    var CAT = XoneK3.CAT;

    // ============================================================
    // SHARED CELL FACTORIES
    // ============================================================
    // Cells that must exist in every bottom layer. CUE and LOOP
    // both call these; ODD inherits from LOOP.

    function eqRamp() {
        return B.composeScheme({ scheme: 'myCatnipSpread', markerWidth: 0 });
    }

    function beatjump1(dir) {
        return { func: F.beatjumpButton, args: ['beatjump_1_' + dir],
                 group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                 colorScheme: { knob: (dir === 'backward') ? 'fader0' : 'fader1',
                                scheme: eqRamp() } };
    }

    function slipCell() {
        return { group: '$DECK_ACTIVE$', inKey: 'slip_enabled', outKey: 'slip_enabled',
                 colorScheme: CAT.slipScheme() };
    }

    function playCell() {
        return { group: '$DECK_ACTIVE$', inKey: 'play', outKey: 'play_indicator',
                 colorScheme: CAT.PLAY_LED_SCHEME };
    }

    function layerButton(from, to) {
        return { func: F.layerButton, args: [from, to],
                 group: '$DECK_A$',
                 outKey: 'play_indicator',
                 colorScheme: { scheme: CAT.countdownScheme() } };
    }

    // Hotcues and loop / beatjump size buttons.
    function hotcue(n) {
        return {
            group: '$DECK_ACTIVE$',
            inKey: 'hotcue_' + n + '_activate',
            outKey: 'hotcue_' + n + '_status',
            colorScheme: { scheme: 'mixxx' },
            type: 'push'
        };
    }
    function hotcueClear(n) {
        return {
            group: '$DECK_ACTIVE$',
            inKey: 'hotcue_' + n + '_clear',
            outKey: 'hotcue_' + n + '_status',
            colorScheme: { scheme: 'red, 93, 0' },
            type: 'push'
        };
    }
    function loopSize(size, scheme) {
        return { func: F.pressSetValue, args: [size],
                 group: '$DECK_ACTIVE$', inKey: 'beatloop_size', outKey: 'beatloop_size',
                 colorScheme: { scheme: scheme } };
    }
    function beatjumpSize(size, scheme) {
        return { func: F.pressSetValue, args: [size],
                 group: '$DECK_ACTIVE$', inKey: 'beatjump_size', outKey: 'beatjump_size',
                 colorScheme: { scheme: scheme } };
    }

    // The four shift overrides shared by CUE_SHIFT and LOOP_SHIFT:
    // phrase origin nudge / set-here, and toggle active deck.
    // ODD_SHIFT gets the two nudge cells through LOOP_SHIFT via the
    // parent chain, and re-declares the other two for clarity.
    function shiftPhraseCells() {
        return {
            grid2_0: { group: '$DECK_ACTIVE$',
                       colorScheme: { knob: 'fader2', scheme: eqRamp(), on: false } },
            grid2_1: { func: F.toggleActiveDeck,
                       group: '$DECK_ACTIVE$',
                       outKey: 'slip_enabled',
                       colorScheme: CAT.slipScheme() }
        };
    }

    // ============================================================
    // CUE
    // ============================================================
    var CUE = {
        layer: layerButton('cue', 'loop'),
        encoderL: { func: F.encBpmPressedHeadMix, group: '[InternalClock]', inKey: 'bpm' },
        pressL:   { func: F.bpmPress, args: ['encoderL'] },
        encoderR: { func: F.encPlaylistNav },
        pressR:   { func: F.loadSelectedTrack },

        grid0_0: beatjump1('backward'),
        grid1_0: beatjump1('forward'),
        grid2_0: { func: F.cycleDisplaySource,
                   group: '$DECK_ACTIVE$',
                   colorScheme: {
                       knob: 'fader2',
                       scheme: eqRamp(),
                       on: { state: 'activeDeckVirtual', equals: false }
                   } },
        grid2_1: slipCell(),
        grid3_1: playCell(),
        grid3_0: { group: '$DECK_ACTIVE$', inKey: 'cue_default', outKey: 'cue_indicator',
                   colorScheme: { knob: 'fader3', scheme: eqRamp() }, type: 'push' },

        grid0_1: { func: F.beatjumpButton, args: ['beatjump_16_backward'],
                   group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                   colorScheme: { scheme: [69, 0, 127, 127] } },
        grid1_1: { func: F.beatjumpButton, args: ['beatjump_16_forward'],
                   group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                   colorScheme: { scheme: [69, 0, 127, 127] } },

        grid0_2: hotcue(1), grid1_2: hotcue(2), grid2_2: hotcue(3), grid3_2: hotcue(4),
        grid0_3: hotcue(5), grid1_3: hotcue(6), grid2_3: hotcue(7), grid3_3: hotcue(8)
    };

    var CUE_SHIFT = Object.assign({}, shiftPhraseCells(), {
        encoderL: { func: F.encStepParam, args: ['[Master]', 'gain', 0.01] },
        encoderR: { func: F.encStepParam, args: ['[Master]', 'headVolume', 0.01] },

        // NO CUE FUNCTION IF SHIFTED (not in the phrase overlay becaause cue is only in cue layer)
        grid3_0: { group: '$DECK_ACTIVE$', inKey: 'cue_clear', outKey: 'cue_indicator',
                   colorScheme: { knob: 'fader3', scheme: eqRamp() }, type: 'push' },
        //could also: grid3_1: Object.assign({}, playCell(), { inKey: undefined }), //same thing
        // NO PLAY FUNCTION IF SHIFTED
        grid3_1: { group: '$DECK_ACTIVE$', outKey: 'play_indicator', colorScheme: CAT.PLAY_LED_SCHEME },

        grid0_2: hotcueClear(1), grid1_2: hotcueClear(2), grid2_2: hotcueClear(3), grid3_2: hotcueClear(4),
        grid0_3: hotcueClear(5), grid1_3: hotcueClear(6), grid2_3: hotcueClear(7), grid3_3: hotcueClear(8)
    });
    CUE._shift = 'cueShift';

    // ============================================================
    // LOOP
    // ============================================================
    var LOOP = {
        layer: layerButton('loop', 'oddLoop'),
        encoderL: { func: F.encLoopMoveAccel, args: ['in', 0.010],
                    group: '$DECK_ACTIVE$', inKey: 'beatloop_size' },
        pressL:   { func: F.reloopToggleResetAnchor, group: '$DECK_ACTIVE$' },
        encoderR: { func: F.encLoopMoveAccel, args: ['out', 0.010],
                    group: '$DECK_ACTIVE$', inKey: 'beatloop_size' },
        pressR:   { func: F.beatloopActivateResetAnchor, group: '$DECK_ACTIVE$' },

        grid0_0: beatjump1('backward'),
        grid1_0: beatjump1('forward'),
        // Display toggle. Switches between the track reading and
        // the loop-clock reading. No-op when the loop clock isn't
        // running — track is the only reading then. Manual override
        // sticks until the next start / stop event re-resolves.
        grid2_0: { func: F.cycleDisplaySource,
                   group: '$DECK_ACTIVE$',
                   colorScheme: {
                       knob: 'fader2',
                       scheme: eqRamp(),
                       on: { state: 'activeDeckVirtual', equals: false }
                   } },

        grid0_1: { func: F.beatjumpButton, args: ['beatjump_backward'],
                   group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                   colorScheme: { scheme: 'magenta' } },
        grid1_1: { func: F.beatjumpButton, args: ['beatjump_forward'],
                   group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                   colorScheme: { scheme: 'magenta' } },
        grid2_1: slipCell(),
        grid3_1: playCell(),

        grid3_0: { colorScheme: {
                    knob: 'fader3',
                    scheme: eqRamp(),
                    on: true
                } },

        grid0_2: loopSize('8', 'green'),  grid1_2: loopSize('4',   'green'),
        grid2_2: loopSize('2', 'green'),  grid3_2: loopSize('1',   'teal2'),
        grid0_3: loopSize('1/16', 'green'),  grid1_3: loopSize('1/8',   'green'),
        grid2_3: loopSize('1/4','green'),  grid3_3: loopSize('1/2',   'teal2')
    };

    var LOOP_SHIFT = Object.assign({}, shiftPhraseCells(), {
        encoderL: { func: F.encBeatjump, group: '$DECK_ACTIVE$' },
        pressL:   { func: F.reloopToggleResetAnchor, group: '$DECK_ACTIVE$' },
        encoderR: { func: F.encBeatjumpStepScale, args: ['1/32', 16], group: '$DECK_ACTIVE$' },
        pressR:   { func: F.beatloopActivateResetAnchor, group: '$DECK_ACTIVE$' },

        //could also: grid3_1: Object.assign({}, playCell(), { inKey: undefined }), //same thing
        grid3_1: { group: '$DECK_ACTIVE$', outKey: 'play_indicator', colorScheme: CAT.PLAY_LED_SCHEME },

        grid0_2: beatjumpSize('8', 'teal2'), grid1_2: beatjumpSize('4',   'teal2'),
        grid2_2: beatjumpSize('2', 'teal2'), grid3_2: beatjumpSize('1',   'green'),
        grid0_3: beatjumpSize('1/16', 'teal2'), grid1_3: beatjumpSize('1/8',   'teal2'),
        grid2_3: beatjumpSize('1/4','teal2'), grid3_3: beatjumpSize('1/2',   'green')
    });
    LOOP._shift = 'loopShift';

    // ============================================================
    // ODD — inherits from LOOP
    // ============================================================
    var ODD = {
        patch: ['loop'],
        layer: layerButton('oddLoop', 'cue'),
        grid0_1: { func: F.beatjumpButton, args: ['beatjump_backward'],
                   group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                   colorScheme: { scheme: 'magenta' } },
        grid1_1: { func: F.beatjumpButton, args: ['beatjump_forward'],
                   group: '$DECK_ACTIVE$', outKey: 'track_loaded',
                   colorScheme: { scheme: 'magenta' } },
        grid2_1: slipCell(),
        grid3_1: playCell(),
        grid0_2: loopSize('7',  'cyan'), grid1_2: loopSize('5',    'cyan'),
        grid2_2: loopSize('3',  'cyan'), grid3_2: loopSize('1',    'sky2'),
        grid0_3: loopSize('3/32', 'cyan'), grid1_3: loopSize('3/16', 'cyan'),
        grid2_3: loopSize('3/8', 'cyan'), grid3_3: loopSize('1/2',    'sky2')
    };

    var ODD_SHIFT = Object.assign({}, shiftPhraseCells(), {
        // Shift companions collect LOOP_SHIFT first (because ODD
        // inherits LOOP), so grid0_0 / grid1_0 come through even
        // if not declared here.
        
        grid0_2: beatjumpSize('7',  'sky2'), grid1_2: beatjumpSize('5',   'sky2'),
        grid2_2: beatjumpSize('3',  'sky2'), grid3_2: beatjumpSize('1',   'cyan'),
        grid0_3: beatjumpSize('3/32', 'sky2'), grid1_3: beatjumpSize('3/16',   'sky2'),
        grid2_3: beatjumpSize('3/8', 'sky2'), grid3_3: beatjumpSize('1/2',   'cyan')
    });
    ODD._shift = 'oddLoopShift';

    // ============================================================
    // EXPORTS
    // ============================================================
    CAT.CUE = CUE;
    CAT.CUE_SHIFT = CUE_SHIFT;
    CAT.LOOP = LOOP;
    CAT.LOOP_SHIFT = LOOP_SHIFT;
    CAT.ODD = ODD;
    CAT.ODD_SHIFT = ODD_SHIFT;
})();