'use strict';

var H = require('./helpers');

// Focus-mode, twoDeck, and mini layout patch generation from the
// real Cat config.

// ── fxCells emitter (focus mode) ─────────────────────────────

test('fxCells: unit 1 produces all cells', function(t) {
    var c = H.bootCat();
    var expected = [
        'knob1_0','knob2_0','knob3_0','button1_0','button2_0','button3_0',
        'knob1_1','knob2_1','knob3_1','button1_1','button2_1','button3_1',
        'knob2_2','knob3_2','button2_2','button3_2'
    ];
    for (var i = 0; i < expected.length; i++) {
        t.hasKey(c._applied, expected[i], expected[i] + ' missing');
    }
});

test('fxCells: unit 2 remap', function(t) {
    var c = H.bootCat();
    c.setSelectedFor('fx', 'A', 2);
    c._syncFxLayout();
    // knob1_0 override → e2 p1.
    t.eq(c.bindings.knob1_0.group, '[EffectRack1_EffectUnit2_Effect2]');
    t.eq(c.bindings.knob1_0.inKey, 'parameter1');
    // knob2_0 override → e1 p1.
    t.eq(c.bindings.knob2_0.group, '[EffectRack1_EffectUnit2_Effect1]');
    t.eq(c.bindings.knob2_0.inKey, 'parameter1');
    // knob3_0 override → e1 p2.
    t.eq(c.bindings.knob3_0.group, '[EffectRack1_EffectUnit2_Effect1]');
    t.eq(c.bindings.knob3_0.inKey, 'parameter2');
    // button3_0 override keeps e1 enable.
    t.eq(c.bindings.button3_0.group, '[EffectRack1_EffectUnit2_Effect1]');
    t.eq(c.bindings.button3_0.inKey, 'enabled');
});

test('fxCells: unit 2 button3_1 inherits base → EffectUnit2_Effect2 enable', function(t) {
    var c = H.bootCat();
    c.setSelectedFor('fx', 'A', 2);
    c._syncFxLayout();
    t.eq(c.bindings.button3_1.group, '[EffectRack1_EffectUnit2_Effect2]');
    t.eq(c.bindings.button3_1.inKey, 'enabled');
});

test('fxCells: unit 4 remap', function(t) {
    var c = H.bootCat();
    c.setSelectedFor('fx', 'A', 4);
    c._syncFxLayout();
    // knob1_0 override → e2 p1.
    t.eq(c.bindings.knob1_0.group, '[EffectRack1_EffectUnit4_Effect2]');
    t.eq(c.bindings.knob1_0.inKey, 'parameter1');
    // knob2_0 override → e1 p1.
    t.eq(c.bindings.knob2_0.group, '[EffectRack1_EffectUnit4_Effect1]');
    t.eq(c.bindings.knob2_0.inKey, 'parameter1');
    // knob3_0 override → e1 p3.
    t.eq(c.bindings.knob3_0.group, '[EffectRack1_EffectUnit4_Effect1]');
    t.eq(c.bindings.knob3_0.inKey, 'parameter3');
});

// ── twoDeckFxColumn ─────────────────────────────────────────

test('twoDeckFxColumn: col 1 follows $FX_A_N$', function(t) {
    var c = H.bootCat({
        initialPatches: ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
    });
    // TWO_DECK_FX_LAYOUTS: knob0 → e1 meta, knob1 → e2 meta.
    t.eq(c.bindings.knob1_0.group, '[EffectRack1_EffectUnit1_Effect1]');
    t.eq(c.bindings.knob1_0.inKey, 'meta');
    t.eq(c.bindings.knob1_1.group, '[EffectRack1_EffectUnit1_Effect2]');
    t.eq(c.bindings.knob1_1.inKey, 'meta');
});

test('twoDeckFxColumn: col 2 follows $FX_B_N$', function(t) {
    var c = H.bootCat({
        initialPatches: ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
    });
    c.setSelectedFor('fx', 'B', 3);
    c._syncFxLayout();
    t.eq(c.bindings.knob2_0.group, '[EffectRack1_EffectUnit3_Effect1]');
    t.eq(c.bindings.knob2_0.inKey, 'meta');
});

test('twoDeckFxColumn: A and B columns swap independently', function(t) {
    var c = H.bootCat({
        initialPatches: ['twoDeck', 'fxLayoutA1', 'fxLayoutB1', 'cue']
    });
    c.setSelectedFor('fx', 'A', 3);
    c.setSelectedFor('fx', 'B', 4);
    c._syncFxLayout();
    t.eq(c.bindings.knob1_0.group, '[EffectRack1_EffectUnit3_Effect1]');
    t.eq(c.bindings.knob2_0.group, '[EffectRack1_EffectUnit4_Effect1]');
});

// ── twoDeckMiniFxCells ──────────────────────────────────────

test('twoDeckMiniFxCells: all 8 cells follow $FX_ACTIVE$', function(t) {
    var c = H.bootCat({initialPatches: ['twoDeckMini', 'fxMini1', 'cue']});
    var cells = ['knob1_0','knob2_0','knob1_1','knob2_1',
                 'button1_0','button2_0','button1_1','button2_1'];
    for (var i = 0; i < cells.length; i++) {
        t.contains(c.bindings[cells[i]].group, 'EffectUnit1', cells[i]);
    }
});

test('twoDeckMiniFxCells: knob1_0 → EffectUnit1_Effect1 param1', function(t) {
    var c = H.bootCat({initialPatches: ['twoDeckMini', 'fxMini1', 'cue']});
    t.eq(c.bindings.knob1_0.group, '[EffectRack1_EffectUnit1_Effect1]');
    t.eq(c.bindings.knob1_0.inKey, 'parameter1');
});

test('twoDeckMiniFxCells: swaps follow selectedFxCurrent', function(t) {
    var c = H.bootCat({initialPatches: ['twoDeckMini', 'fxMini1', 'cue']});
    c.setSelectedFor('fx', 'B', 3);
    c.setActiveFx('B');
    c._syncFxLayout();
    t.contains(c.bindings.knob1_0.group, 'EffectUnit3');
});

// ── cross-route cells in mini ────────────────────────────────

test('mini: button0_2 routes $FX_ALT$ into deck A', function(t) {
    // Force initialFxB=2 so alt (2) differs from active (1).
    var c = H.bootCat({
        initialPatches: ['twoDeckMini', 'fxMini1', 'cue'],
        initialFxB: 2
    });
    t.eq(c.bindings.button0_2.group, '[EffectRack1_EffectUnit2]');
    t.eq(c.bindings.button0_2.inKey, 'group_[Channel1]_enable');
});

test('mini: button3_2 routes $FX_ALT$ into deck B', function(t) {
    // Force initialFxB=2 (alt) and initialDeckB=2 so we exercise
    // the cross-route cells with distinct values.
    var c = H.bootCat({
        initialPatches: ['twoDeckMini', 'fxMini1', 'cue'],
        initialFxB: 2,
        initialDeckB: 2
    });
    t.eq(c.bindings.button3_2.group, '[EffectRack1_EffectUnit2]');
    t.eq(c.bindings.button3_2.inKey, 'group_[Channel2]_enable');
});

test('mini: press1 routes $FX_ACTIVE$ into deck A', function(t) {
    var c = H.bootCat({initialPatches: ['twoDeckMini', 'fxMini1', 'cue']});
    c.setSelectedFor('fx', 'A', 3);
    c.setActiveFx('A');
    t.eq(c.bindings.press1.group, '[EffectRack1_EffectUnit3]');
    t.eq(c.bindings.press1.inKey, 'group_[Channel1]_enable');
});