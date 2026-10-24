'use strict';

var H = require('./helpers');

// Every remaining func. Rate-gated funcs are tested with
// `rate: false` or on their first event — see rate-gate.test.js
// for the gate itself. Tests that assert on `_lastLoopChangeMs`
// need an active loop on the channel (the gate bypasses
// out-of-loop bindings entirely).

// ── k3Select / k3SelectActive ──────────────────────────────

test('k3Select: sets selectedDeckA', function(t) {
    var c = H.ctrl();
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.k3Select, args: ['deck', 'A', 3]
    });
    H.press(c, 'press0');
    t.eq(c.selectedDeckA, 3);
});

test('k3Select: sets selectedFxA', function(t) {
    var c = H.ctrl();
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.k3Select, args: ['fx', 'A', 2]
    });
    H.press(c, 'press0');
    t.eq(c.selectedFxA, 2);
});

test('k3Select: with loadState.pressed loads track', function(t) {
    var c = H.ctrl();
    c.loadState.pressed = true;
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.k3Select, args: ['deck', 'A', 3]
    });
    H.press(c, 'press0');
    t.eq(engine.getValue('[Channel3]', 'LoadSelectedTrack'), 1);
});

test('k3Select: NaN arg is ignored', function(t) {
    var c = H.ctrl();
    c.selectedDeckA = 2;
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.k3Select, args: ['deck', 'A']
    });
    H.press(c, 'press0');
    t.eq(c.selectedDeckA, 2);
});

test('k3SelectActive: uses activeFx slot', function(t) {
    var c = H.ctrl();
    c.activeFx = 'B';
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.k3SelectActive, args: ['fx', 3]
    });
    H.press(c, 'press0');
    t.eq(c.selectedFxB, 3);
});

test('k3SelectActive: with loadState.pressed loads track', function(t) {
    var c = H.ctrl();
    c.loadState.pressed = true;
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.k3SelectActive, args: ['deck', 2]
    });
    H.press(c, 'press0');
    t.eq(engine.getValue('[Channel2]', 'LoadSelectedTrack'), 1);
});

// ── setActiveFxTo / toggleActiveFx / toggleActiveDeck ──────

test('setActiveFxTo: A', function(t) {
    var c = H.ctrl();
    c.activeFx = 'B';
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.setActiveFxTo, args: ['A']
    });
    H.press(c, 'press0');
    t.eq(c.activeFx, 'A');
});

test('setActiveFxTo: B', function(t) {
    var c = H.ctrl();
    c.activeFx = 'A';
    c._applyBinding('press0', {
        func: XoneK3.FUNCS.setActiveFxTo, args: ['B']
    });
    H.press(c, 'press0');
    t.eq(c.activeFx, 'B');
});

test('toggleActiveFx: flips A ↔ B', function(t) {
    var c = H.ctrl();
    c._applyBinding('press0', {func: XoneK3.FUNCS.toggleActiveFx});
    H.press(c, 'press0');
    t.eq(c.activeFx, 'B');
    H.release(c, 'press0');
    H.press(c, 'press0');
    t.eq(c.activeFx, 'A');
});

test('toggleActiveDeck: flips A ↔ B', function(t) {
    var c = H.ctrl();
    c._applyBinding('press0', {func: XoneK3.FUNCS.toggleActiveDeck});
    H.press(c, 'press0');
    t.eq(c.activeDeck, 'B');
});

// ── loadSelectedTrack ──────────────────────────────────────

test('loadSelectedTrack: press arms, release clears', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressR', {func: XoneK3.FUNCS.loadSelectedTrack});
    H.press(c, 'pressR');
    t.eq(c.loadState.pressed, true);
    H.release(c, 'pressR');
    t.eq(c.loadState.pressed, false);
});

// ── encPregainStep ─────────────────────────────────────────

test('encPregainStep: CW adds step', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'pregain', 0.5);
    c._applyBinding('encoder0', {
        func: XoneK3.FUNCS.encPregainStep, args: [0.1],
        group: '[Channel1]', inKey: 'pregain'
    });
    H.send(c, 'encoder0', 1);
    t.approx(engine.getValue('[Channel1]', 'pregain'), 0.6, 1e-9);
});

test('encPregainStep: CCW subtracts', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'pregain', 0.5);
    c._applyBinding('encoder0', {
        func: XoneK3.FUNCS.encPregainStep, args: [0.1],
        group: '[Channel1]', inKey: 'pregain'
    });
    H.send(c, 'encoder0', 127);
    t.approx(engine.getValue('[Channel1]', 'pregain'), 0.4, 1e-9);
});

// ── encQuickFxCycle ────────────────────────────────────────

test('encQuickFxCycle: CW advances loaded_chain_preset', function(t) {
    var c = H.ctrl();
    engine._set('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset', 0);
    c._applyBinding('encoder1', {
        func: XoneK3.FUNCS.encQuickFxCycle,
        group: '[QuickEffectRack1_[Channel1]]'
    });
    H.send(c, 'encoder1', 1);
    t.eq(engine.getValue('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset'), 1);
});

test('encQuickFxCycle: CCW decrements and wraps at index 0', function(t) {
    var c = H.ctrl();
    engine._set('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset', 0);
    c._applyBinding('encoder1', {
        func: XoneK3.FUNCS.encQuickFxCycle,
        group: '[QuickEffectRack1_[Channel1]]'
    });
    H.send(c, 'encoder1', 127);
    t.eq(engine.getValue('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset'),
         XoneK3.QFX_CHAIN_LIST.length - 1);
});

// ── encKeyShift ────────────────────────────────────────────

test('encKeyShift: CW +1 semitone', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'pitch_adjust', 0);
    c._applyBinding('encoder3', {
        func: XoneK3.FUNCS.encKeyShift, group: '[Channel1]'
    });
    H.send(c, 'encoder3', 1);
    t.eq(engine.getValue('[Channel1]', 'pitch_adjust'), 1);
});

test('encKeyShift: CCW -1', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'pitch_adjust', 0);
    c._applyBinding('encoder3', {
        func: XoneK3.FUNCS.encKeyShift, group: '[Channel1]'
    });
    H.send(c, 'encoder3', 127);
    t.eq(engine.getValue('[Channel1]', 'pitch_adjust'), -1);
});

// ── encKeySyncReset ────────────────────────────────────────

test('encKeySyncReset: CW fires sync_key', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoder2', {
        func: XoneK3.FUNCS.encKeySyncReset, group: '[Channel1]'
    });
    H.send(c, 'encoder2', 1);
    t.eq(engine.getValue('[Channel1]', 'sync_key'), 1);
});

test('encKeySyncReset: CCW fires reset_key', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoder2', {
        func: XoneK3.FUNCS.encKeySyncReset, group: '[Channel1]'
    });
    H.send(c, 'encoder2', 127);
    t.eq(engine.getValue('[Channel1]', 'reset_key'), 1);
});

// ── encStepParam ───────────────────────────────────────────

test('encStepParam: CW adds step to parameter', function(t) {
    var c = H.ctrl();
    engine.setParameter('[Master]', 'gain', 0.5);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encStepParam, args: ['[Master]', 'gain', 0.05]
    });
    H.send(c, 'encoderL', 1);
    t.approx(engine.getParameter('[Master]', 'gain'), 0.55, 1e-9);
});

test('encStepParam: clamps to [0,1]', function(t) {
    var c = H.ctrl();
    engine.setParameter('[Master]', 'gain', 0.98);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encStepParam, args: ['[Master]', 'gain', 0.05]
    });
    H.send(c, 'encoderL', 1);
    t.eq(engine.getParameter('[Master]', 'gain'), 1);
});

test('encStepParam: missing args no-op', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {func: XoneK3.FUNCS.encStepParam, args: []});
    H.send(c, 'encoderL', 1);
});

// ── encPlaylistNav ─────────────────────────────────────────

test('encPlaylistNav: CW selects next', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderR', {func: XoneK3.FUNCS.encPlaylistNav});
    H.send(c, 'encoderR', 1);
    t.eq(engine.getValue('[Playlist]', 'SelectNextTrack'), 1);
});

test('encPlaylistNav: CCW selects prev', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderR', {func: XoneK3.FUNCS.encPlaylistNav});
    H.send(c, 'encoderR', 127);
    t.eq(engine.getValue('[Playlist]', 'SelectPrevTrack'), 1);
});

// ── encBpmPressedHeadMix ───────────────────────────────────

test('encBpmPressedHeadMix: no pressHeld → writes bpm', function(t) {
    var c = H.ctrl();
    engine._set('[InternalClock]', 'bpm', 120);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encBpmPressedHeadMix,
        group: '[InternalClock]', inKey: 'bpm'
    });
    H.send(c, 'encoderL', 1);
    t.approx(engine.getValue('[InternalClock]', 'bpm'), 120.1, 1e-9);
});

test('encBpmPressedHeadMix: pressHeld writes headMix', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encBpmPressedHeadMix,
        group: '[InternalClock]', inKey: 'bpm'
    });
    c.bindings.encoderL.pressHeld = true;
    engine._set('[Master]', 'headMix', 0.5);
    H.send(c, 'encoderL', 1);
    t.approx(engine.getValue('[Master]', 'headMix'), 0.55, 1e-9);
    t.eq(c.bindings.encoderL.turnHappened, true);
});

// ── encLoopMove ────────────────────────────────────────────

test('encLoopMove: writes loop_anchor 1 for in', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_anchor', 0);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMove, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    H.send(c, 'encoderL', 1);
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 1);
});

test('encLoopMove: writes loop_anchor 0 for out', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_anchor', 1);
    c._applyBinding('encoderR', {
        func: XoneK3.FUNCS.encLoopMove, args: ['out', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    H.send(c, 'encoderR', 1);
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 0);
});

test('encLoopMove: inferred rate class is "edit"', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMove, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    t.eq(c.bindings.encoderL._rateClass, 'edit');
});

// ── encLoopMoveAccel ───────────────────────────────────────

test('encLoopMoveAccel: writes loop_anchor 1 for in', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_anchor', 0);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMoveAccel, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size', rate: false
    });
    H.send(c, 'encoderL', 1);
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 1);
});

test('encLoopMoveAccel: writes loop_anchor 0 for out', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_anchor', 1);
    c._applyBinding('encoderR', {
        func: XoneK3.FUNCS.encLoopMoveAccel, args: ['out', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size', rate: false
    });
    H.send(c, 'encoderR', 1);
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 0);
});

test('encLoopMoveAccel: single event moves by base step', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'beatloop_size', 1);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMoveAccel, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size', rate: false
    });
    H.send(c, 'encoderL', 1);
    t.approx(engine.getValue('[Channel1]', 'beatloop_size'), 0.99, 1e-9);
});

test('encLoopMoveAccel: cap arg (args[2]) limits multiplier', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'beatloop_size', 1);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMoveAccel, args: ['in', 0.01, 2, 12],
        group: '[Channel1]', inKey: 'beatloop_size', rate: false
    });
    for (var i = 0; i < 40; i++) H.send(c, 'encoderL', 1);
    var delta = 1 - engine.getValue('[Channel1]', 'beatloop_size');
    t.ok(delta <= 0.81, 'delta=' + delta);
    t.ok(delta > 0.1, 'delta=' + delta);
});

test('encLoopMoveAccel: higher cap allows faster climb', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'beatloop_size', 5);
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMoveAccel, args: ['in', 0.01, 6, 12],
        group: '[Channel1]', inKey: 'beatloop_size', rate: false
    });
    for (var i = 0; i < 40; i++) H.send(c, 'encoderL', 1);
    var delta = 5 - engine.getValue('[Channel1]', 'beatloop_size');
    t.ok(delta > 0.5, 'delta=' + delta);
});

test('encLoopMoveAccel: inferred rate class is "edit"', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMoveAccel, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    t.eq(c.bindings.encoderL._rateClass, 'edit');
});

// ── encBeatjump ────────────────────────────────────────────

test('encBeatjump: CW → beatjump_forward pulse', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encBeatjump, group: '[Channel1]'
    });
    H.send(c, 'encoderL', 1);
    t.eq(engine.getValue('[Channel1]', 'beatjump_forward'), 1);
    engine._fireOneShots();
    t.eq(engine.getValue('[Channel1]', 'beatjump_forward'), 0);
});

test('encBeatjump: CCW → beatjump_backward pulse', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encBeatjump, group: '[Channel1]'
    });
    H.send(c, 'encoderL', 127);
    t.eq(engine.getValue('[Channel1]', 'beatjump_backward'), 1);
});

test('encBeatjump: inferred rate class is "jump"', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encBeatjump, group: '[Channel1]'
    });
    t.eq(c.bindings.encoderL._rateClass, 'jump');
});

// ── encBeatjumpStepScale ───────────────────────────────────

test('encBeatjumpStepScale: CW doubles', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'beatjump_size', 1);
    c._applyBinding('encoderR', {
        func: XoneK3.FUNCS.encBeatjumpStepScale, args: ['1/32', 16],
        group: '[Channel1]'
    });
    H.send(c, 'encoderR', 1);
    t.eq(engine.getValue('[Channel1]', 'beatjump_size_double'), 1);
});

test('encBeatjumpStepScale: CCW halves', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'beatjump_size', 1);
    c._applyBinding('encoderR', {
        func: XoneK3.FUNCS.encBeatjumpStepScale, args: ['1/32', 16],
        group: '[Channel1]'
    });
    H.send(c, 'encoderR', 127);
    t.eq(engine.getValue('[Channel1]', 'beatjump_size_halve'), 1);
});

test('encBeatjumpStepScale: inferred rate class is "claim"', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderR', {
        func: XoneK3.FUNCS.encBeatjumpStepScale, args: ['1/32', 16],
        group: '[Channel1]'
    });
    t.eq(c.bindings.encoderR._rateClass, 'claim');
});

// ── pressSetValue ──────────────────────────────────────────

test('pressSetValue: writes value', function(t) {
    var c = H.ctrl();
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.pressSetValue, args: ['1/4'],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    H.press(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'beatloop_size'), 0.25);
});

test('pressSetValue: beatloop_size claims shared clock via rate gate', function(t) {
    var c = H.ctrl();
    c._lastLoopChangeMs = 0;
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.pressSetValue, args: ['1/4'],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    // Gate is only active with an active loop on the target
    // channel. Without this the out-of-loop bypass short-
    // circuits before _lastLoopChangeMs is touched.
    engine._set('[Channel1]', 'loop_enabled', 1);
    t.eq(c.bindings.grid0_2._rateClass, 'edit');
    H.press(c, 'grid0_2');
    t.ok(c._lastLoopChangeMs > 0);
});

test('pressSetValue: beatloop_size does NOT claim out-of-loop', function(t) {
    var c = H.ctrl();
    c._lastLoopChangeMs = 0;
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.pressSetValue, args: ['1/4'],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    // no loop_enabled set — bypass fires
    H.press(c, 'grid0_2');
    t.eq(c._lastLoopChangeMs, 0,
         'out-of-loop bypass must not touch the shared clock');
    t.eq(engine.getValue('[Channel1]', 'beatloop_size'), 0.25,
         'func must still run');
});

test('pressSetValue: beatjump_size uses "claim" class', function(t) {
    var c = H.ctrl();
    c._lastLoopChangeMs = 0;
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.pressSetValue, args: ['1/2'],
        group: '[Channel1]', inKey: 'beatjump_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    t.eq(c.bindings.grid0_2._rateClass, 'claim');
    H.press(c, 'grid0_2');
    t.ok(c._lastLoopChangeMs > 0);
});

// ── beatjumpButton ─────────────────────────────────────────

test('beatjumpButton: pulses the given CO', function(t) {
    var c = H.ctrl();
    c._applyBinding('grid0_0', {
        func: XoneK3.FUNCS.beatjumpButton, args: ['beatjump_1_backward'],
        group: '[Channel1]'
    });
    H.press(c, 'grid0_0');
    t.eq(engine.getValue('[Channel1]', 'beatjump_1_backward'), 1);
    engine._fireOneShots();
    t.eq(engine.getValue('[Channel1]', 'beatjump_1_backward'), 0);
});

test('beatjumpButton: inferred rate class is "jump"', function(t) {
    var c = H.ctrl();
    c._applyBinding('grid0_0', {
        func: XoneK3.FUNCS.beatjumpButton, args: ['beatjump_1_backward'],
        group: '[Channel1]'
    });
    t.eq(c.bindings.grid0_0._rateClass, 'jump');
});

// ── reloopToggleResetAnchor ────────────────────────────────

test('reloopToggleResetAnchor: anchor 0 + reloop pulse', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_anchor', 1);
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.reloopToggleResetAnchor, group: '[Channel1]'
    });
    H.press(c, 'pressL');
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 0);
    t.eq(engine.getValue('[Channel1]', 'reloop_toggle'), 1);
});

test('reloopToggleResetAnchor: sets deliberateLoopOff marker', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.reloopToggleResetAnchor, group: '[Channel1]'
    });
    H.press(c, 'pressL');
    t.ok(c._expectingLoopOff[1] > 0);
});

// ── beatloopActivateResetAnchor ────────────────────────────

test('beatloopActivateResetAnchor: anchor 0 + activate pulse', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_anchor', 1);
    c._applyBinding('pressR', {
        func: XoneK3.FUNCS.beatloopActivateResetAnchor, group: '[Channel1]'
    });
    H.press(c, 'pressR');
    t.eq(engine.getValue('[Channel1]', 'loop_anchor'), 0);
    t.eq(engine.getValue('[Channel1]', 'beatloop_activate'), 1);
});

// ── bpmPress ───────────────────────────────────────────────

test('bpmPress: press sets pressHeld on target encoder', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.bpmPress, args: ['encoderL']
    });
    H.press(c, 'pressL');
    t.eq(c.bindings.encoderL.pressHeld, true);
    t.eq(c.bindings.encoderL.turnHappened, false);
});

test('bpmPress: release clears pressHeld', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.bpmPress, args: ['encoderL']
    });
    H.press(c, 'pressL');
    H.release(c, 'pressL');
    t.eq(c.bindings.encoderL.pressHeld, false);
});

test('bpmPress: shift+release toggles headSplit', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.bpmPress, args: ['encoderL']
    });
    c.isShifted = true;
    engine._set('[Master]', 'headSplit', 0);
    H.press(c, 'pressL');
    H.release(c, 'pressL');
    t.eq(engine.getValue('[Master]', 'headSplit'), 1);
});

test('bpmPress: turn during press suppresses headSplit toggle', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.bpmPress, args: ['encoderL']
    });
    c.isShifted = true;
    engine._set('[Master]', 'headSplit', 0);
    H.press(c, 'pressL');
    c.bindings.encoderL.turnHappened = true;
    H.release(c, 'pressL');
    t.eq(engine.getValue('[Master]', 'headSplit'), 0);
});

test('bpmPress: missing encoder arg no-op', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.bpmPress, args: ['nonexistent']
    });
    H.press(c, 'pressL');
});