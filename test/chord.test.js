'use strict';

var H = require('./helpers');

// Shift + layer → chord. Release order doesn't matter. Chord
// patch sits above everything in the stack.

// ── onShiftButton ────────────────────────────────────────────

test('onShiftButton: press sets isShifted', function(t) {
    var c = H.ctrl();
    c.onShiftButton(127, 0x90);
    t.eq(c.isShifted, true);
});

test('onShiftButton: release clears isShifted', function(t) {
    var c = H.ctrl();
    c.shift();
    c.onShiftButton(0, 0x80);
    t.eq(c.isShifted, false);
});

test('onShiftButton: release exits chord first if active', function(t) {
    var c = H.ctrl({patches: {chord: {}}});
    c.shift();
    c._enterChord();
    t.eq(c._chordActive, true);
    c.onShiftButton(0, 0x80);
    t.eq(c._chordActive, false);
    t.eq(c.isShifted, false);
});

// ── _enterChord / _exitChord ────────────────────────────────

test('_enterChord: adds chord patch when present', function(t) {
    var c = H.ctrl({patches: {chord: {}}});
    c._enterChord();
    t.eq(c._chordActive, true);
    t.contains(c.activePatches, 'chord');
});

test('_enterChord: no-op if already active', function(t) {
    var c = H.ctrl({patches: {chord: {}}});
    c._enterChord();
    c._enterChord();
    var count = 0;
    for (var i = 0; i < c.activePatches.length; i++)
        if (c.activePatches[i] === 'chord') count++;
    t.eq(count, 1);
});

test('_enterChord: no-op if no chord patch declared', function(t) {
    var c = H.ctrl({patches: {}});
    c._enterChord();
    t.eq(c._chordActive, false);
});

test('_exitChord: removes chord patch', function(t) {
    var c = H.ctrl({patches: {chord: {}}});
    c._enterChord();
    c._exitChord();
    t.eq(c._chordActive, false);
    t.notOk(c.activePatches.indexOf('chord') !== -1);
});

test('_exitChord: no-op if not active', function(t) {
    var c = H.ctrl({patches: {chord: {}}});
    c._exitChord();
    t.eq(c._chordActive, false);
});

// ── layerButton func behavior ────────────────────────────────

function callFunc(c, name, args, v) {
    var bl = {_ctrl: c};
    XoneK3.FUNCS[name].call(bl, args || [], 0, 0,
                            (v === undefined) ? 127 : v, 0x90);
}

test('layerButton: normal press swaps patches', function(t) {
    var c = H.ctrl({patches: {cue: {}, loop: {}}});
    c.activePatches = ['cue'];
    callFunc(c, 'layerButton', ['cue', 'loop']);
    t.eq(c.activePatches, ['loop']);
});

test('layerButton: press while shifted enters chord', function(t) {
    var c = H.ctrl({patches: {cue: {}, loop: {}, chord: {}}});
    c.activePatches = ['cue'];
    c.shift();
    callFunc(c, 'layerButton', ['cue', 'loop']);
    t.eq(c._chordActive, true);
    t.contains(c.activePatches, 'chord');
    // Layer patch did NOT change
    t.contains(c.activePatches, 'cue');
});

test('layerButton: release while chord active exits', function(t) {
    var c = H.ctrl({patches: {cue: {}, loop: {}, chord: {}}});
    c.activePatches = ['cue'];
    c.shift();
    callFunc(c, 'layerButton', ['cue', 'loop']);
    callFunc(c, 'layerButton', ['cue', 'loop'], 0);
    t.eq(c._chordActive, false);
});

test('layerButton: plain release no-op', function(t) {
    var c = H.ctrl({patches: {cue: {}, loop: {}}});
    c.activePatches = ['cue'];
    callFunc(c, 'layerButton', ['cue', 'loop'], 0);
    t.eq(c.activePatches, ['cue']);
});

// ── chord in stack ───────────────────────────────────────────

test('chord appended last even during shift', function(t) {
    var c = H.ctrl({patches: {
        topShared: {_shift: 'topSharedShift', press0: {group: 'a'}},
        topSharedShift: {press0: {group: 'b'}},
        chord: {press0: {group: 'c'}}
    }});
    c.activePatches = ['topShared'];
    c.shift();
    c._enterChord();
    var stack = c._buildStack();
    t.eq(stack[stack.length - 1], 'chord');
});

test('chord overrides shift companion on same cell', function(t) {
    var c = H.ctrl({patches: {
        topShared: {_shift: 'topSharedShift', press0: {group: 'a'}},
        topSharedShift: {press0: {group: 'b'}},
        chord: {press0: {group: 'c'}}
    }});
    c.activePatches = ['topShared'];
    c.shift();
    c._enterChord();
    var stack = c._resolveStack(c._buildStack());
    t.eq(stack.press0.group, 'c');
});

// ── shutdownHold ─────────────────────────────────────────────

test('shutdownHold: press arms a timer', function(t) {
    var c = H.ctrl();
    c._applyBinding('press3', {func: XoneK3.FUNCS.shutdownHold});
    var b = c.bindings.press3;
    b._func.call(b, [], 0, 0, 127, 0x90);
    t.ok(b._shutdownHoldTimer);
    t.notOk(c._shuttingDown);
});

test('shutdownHold: timer fires → shutdown', function(t) {
    var c = H.ctrl();
    c._applyBinding('press3', {func: XoneK3.FUNCS.shutdownHold});
    var b = c.bindings.press3;
    b._func.call(b, [], 0, 0, 127, 0x90);
    engine._fireOneShots();
    t.ok(c._shuttingDown);
});

test('shutdownHold: release cancels timer', function(t) {
    var c = H.ctrl();
    c._applyBinding('press3', {func: XoneK3.FUNCS.shutdownHold});
    var b = c.bindings.press3;
    b._func.call(b, [], 0, 0, 127, 0x90);
    b._func.call(b, [], 0, 0, 0, 0x80);
    t.eq(b._shutdownHoldTimer, null);
    engine._fireOneShots();
    t.notOk(c._shuttingDown);
});

test('shutdownHold: re-press replaces timer', function(t) {
    var c = H.ctrl();
    c._applyBinding('press3', {func: XoneK3.FUNCS.shutdownHold});
    var b = c.bindings.press3;
    b._func.call(b, [], 0, 0, 127, 0x90);
    var first = b._shutdownHoldTimer;
    b._func.call(b, [], 0, 0, 127, 0x90);
    t.ok(b._shutdownHoldTimer !== first);
});

test('shutdownHold: already shutting down → no-op', function(t) {
    var c = H.ctrl();
    c._shuttingDown = true;
    c._applyBinding('press3', {func: XoneK3.FUNCS.shutdownHold});
    var b = c.bindings.press3;
    b._func.call(b, [], 0, 0, 127, 0x90);
    t.eq(b._shutdownHoldTimer, null);
});