'use strict';

var H = require('./helpers');

// Cue / loop / oddLoop layers through MIDI: hotcues, loops,
// beatjumps, layer cycle, phrase origin.

function setupCue() {
    return H.bootCat({initialPatches: ['topShared', 'fxLayout1', 'cue']});
}
function setupLoop() {
    return H.bootCat({initialPatches: ['topShared', 'fxLayout1', 'loop']});
}
function setupOdd() {
    return H.bootCat({initialPatches: ['topShared', 'fxLayout1', 'oddLoop']});
}

// ── hotcues ────────────────────────────────────────────────

test('hotcue 1 fires hotcue_1_activate', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'hotcue_1_activate', 0);
    H.press(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'hotcue_1_activate'), 1);
});

test('hotcue release sends 0', function(t) {
    var c = setupCue();
    H.press(c, 'grid0_2');
    H.release(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'hotcue_1_activate'), 0);
});

test('hotcue 8 on grid3_3', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'hotcue_8_activate', 0);
    H.press(c, 'grid3_3');
    t.eq(engine.getValue('[Channel1]', 'hotcue_8_activate'), 1);
});

test('shift+hotcue clears', function(t) {
    var c = setupCue();
    H.press(c, 'shift');
    H.press(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'hotcue_1_clear'), 1);
});

// ── play / cue ─────────────────────────────────────────────

test('play button toggles play', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'play', 0);
    H.press(c, 'grid3_1');
    t.eq(engine.getValue('[Channel1]', 'play'), 1);
});

test('cue button presses cue_default', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'cue_default', 0);
    H.press(c, 'grid3_0');
    t.eq(engine.getValue('[Channel1]', 'cue_default'), 1);
});

// ── slip ───────────────────────────────────────────────────

test('slip toggle flips slip_enabled', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'slip_enabled', 0);
    H.press(c, 'grid2_1');
    t.eq(engine.getValue('[Channel1]', 'slip_enabled'), 1);
});

// ── beatjump ───────────────────────────────────────────────

test('grid0_0 fires beatjump_1_backward pulse', function(t) {
    var c = setupCue();
    H.press(c, 'grid0_0');
    t.eq(engine.getValue('[Channel1]', 'beatjump_1_backward'), 1);
    engine._fireOneShots();
    t.eq(engine.getValue('[Channel1]', 'beatjump_1_backward'), 0);
});

test('grid1_0 fires beatjump_1_forward pulse', function(t) {
    var c = setupCue();
    H.press(c, 'grid1_0');
    t.eq(engine.getValue('[Channel1]', 'beatjump_1_forward'), 1);
});

test('grid0_1 fires beatjump_16_backward', function(t) {
    var c = setupCue();
    H.press(c, 'grid0_1');
    t.eq(engine.getValue('[Channel1]', 'beatjump_16_backward'), 1);
});

// ── loop sizes ─────────────────────────────────────────────

test('loop grid2_2 writes beatloop_size 2', function(t) {
    var c = setupLoop();
    H.press(c, 'grid2_2');
    t.eq(engine.getValue('[Channel1]', 'beatloop_size'), 2);
});

test('loop grid3_3 writes beatloop_size 1/2', function(t) {
    var c = setupLoop();
    H.press(c, 'grid3_3');
    t.eq(engine.getValue('[Channel1]', 'beatloop_size'), 0.5);
});

// ── odd loop sizes ─────────────────────────────────────────

test('oddLoop grid0_2 writes beatloop_size 7', function(t) {
    var c = setupOdd();
    H.press(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'beatloop_size'), 7);
});

test('oddLoop grid3_3 writes beatloop_size 1/2', function(t) {
    var c = setupOdd();
    H.press(c, 'grid3_3');
    t.eq(engine.getValue('[Channel1]', 'beatloop_size'), 0.5);
});

// ── layer cycle ────────────────────────────────────────────

test('layer press cycles cue → loop', function(t) {
    var c = setupCue();
    H.press(c, 'layer');
    t.ok(c.activePatches.indexOf('loop') !== -1);
    t.notOk(c.activePatches.indexOf('cue') !== -1);
});

test('layer press cycles loop → oddLoop', function(t) {
    var c = setupLoop();
    H.press(c, 'layer');
    t.ok(c.activePatches.indexOf('oddLoop') !== -1);
    t.notOk(c.activePatches.indexOf('loop') !== -1);
});

test('layer press cycles oddLoop → cue', function(t) {
    var c = setupOdd();
    H.press(c, 'layer');
    t.ok(c.activePatches.indexOf('cue') !== -1);
});

// ── reloop / beatloop activate via encoder presses ─────────

test('pressL reloop resets anchor and pulses', function(t) {
    var c = setupLoop();
    engine._set('[Channel1]', 'loop_anchor', 1);
    H.press(c, 'pressL');
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 0);
    t.eq(engine.getValue('[Channel1]', 'reloop_toggle'), 1);
});

test('pressR beatloop activate resets anchor', function(t) {
    var c = setupLoop();
    engine._set('[Channel1]', 'loop_anchor', 1);
    H.press(c, 'pressR');
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 0);
    t.eq(engine.getValue('[Channel1]', 'beatloop_activate'), 1);
});

// ── phrase origin via shifted cells ────────────────────────
//
// shiftPhraseCells() no longer declares grid0_0 / grid1_0
// (phrase ±1 nudge removed) and grid2_0 is LED-only (set-here
// func commented out). Pressing shift+grid0_0 / shift+grid1_0
// now falls through to the base beatjump1 bindings; shift+grid2_0
// is a no-op. No integration test covers the origin writer —
// hotcueWithPhraseCheck is tested in timelines.test.js.

// ── display cycle from LOOP layer ──────────────────────────

test('grid2_0 on LOOP cycles display source', function(t) {
    var c = setupLoop();
    engine._set('[Channel1]', 'duration', 300);
    engine._set('[Channel1]', 'file_bpm', 120);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'playposition', 0.5);

    c._startVirtualClock(1);
    c._decks[1].displaySource = 'track';

    H.press(c, 'grid2_0');
    t.eq(c._decks[1].displaySource, 'loop');
});

// ── display cycle from CUE layer ───────────────────────────

test('CUE grid2_0 cycles display source when loop clock running', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'duration', 300);
    engine._set('[Channel1]', 'file_bpm', 120);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'playposition', 0.5);

    c._startVirtualClock(1);
    c._decks[1].displaySource = 'track';

    H.press(c, 'grid2_0');
    t.eq(c._decks[1].displaySource, 'loop');
});

test('CUE grid2_0 no-op when loop clock stopped', function(t) {
    var c = setupCue();
    engine._set('[Channel1]', 'duration', 300);
    engine._set('[Channel1]', 'file_bpm', 120);
    engine._set('[Channel1]', 'track_samples', 1000);

    H.press(c, 'grid2_0');
    t.eq(c._decks[1].displaySource, 'track');
});

// ── BPM tap via pressL ─────────────────────────────────────

test('pressL sets encoderL pressHeld', function(t) {
    var c = setupCue();
    H.press(c, 'pressL');
    t.eq(c.bindings.encoderL.pressHeld, true);
    H.release(c, 'pressL');
    t.eq(c.bindings.encoderL.pressHeld, false);
});

// ── playlist nav ───────────────────────────────────────────

test('encoderR navigates playlist', function(t) {
    var c = setupCue();
    H.send(c, 'encoderR', 1);
    t.eq(engine.getValue('[Playlist]', 'SelectNextTrack'), 1);
});

// ── track load shortcut ───────────────────────────────────

test('pressR arms loadSelectedTrack', function(t) {
    var c = setupCue();
    H.press(c, 'pressR');
    t.eq(c.loadState.pressed, true);
    H.release(c, 'pressR');
    t.eq(c.loadState.pressed, false);
});

test('pressR + deck select loads track', function(t) {
    var c = H.bootCat({
        initialPatches: ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
    });
    H.press(c, 'pressR');
    H.press(c, 'press0');
    t.eq(engine.getValue('[Channel1]', 'LoadSelectedTrack'), 1);
});