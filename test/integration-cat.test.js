'use strict';

var H = require('./helpers');

// Full Cat workflows through MIDI: deck select, focus flips,
// shift overrides, QFX cycle, faders.

// ── focus-mode press row ───────────────────────────────────
//
// In focus mode press0..press3 are activeSlotButton bindings:
//   press0 → setActiveDeckTo('A')
//   press1 → setActiveDeckTo('B')
//   press2 → setActiveFxTo('A')
//   press3 → setActiveFxTo('B')
//
// They change activeDeck / activeFx, not selectedDeckA/B or
// selectedFxA/B. Pinning a channel into a slot lives in the
// selectAB overlay (chord + press1).

test('press0 sets activeDeck to A', function(t) {
    var c = H.bootCat();
    c.setActiveDeck('B');
    t.eq(c.activeDeck, 'B');
    H.press(c, 'press0');
    t.eq(c.activeDeck, 'A');
});

test('press1 sets activeDeck to B', function(t) {
    var c = H.bootCat();
    t.eq(c.activeDeck, 'A');
    H.press(c, 'press1');
    t.eq(c.activeDeck, 'B');
});

test('press2 sets activeFx to A', function(t) {
    var c = H.bootCat();
    c.setActiveFx('B');
    t.eq(c.activeFx, 'B');
    H.press(c, 'press2');
    t.eq(c.activeFx, 'A');
});

test('press3 sets activeFx to B', function(t) {
    var c = H.bootCat();
    t.eq(c.activeFx, 'A');
    H.press(c, 'press3');
    t.eq(c.activeFx, 'B');
});

test('deck select rewires $DECK_ACTIVE$ bindings', function(t) {
    var c = H.bootCat();
    var chB = c.selectedDeckB;
    H.press(c, 'press1');
    t.eq(c.bindings.encoder0.group, '[Channel' + chB + ']');
});

test('deck select button LED follows selection', function(t) {
    var c = H.bootCat();
    H.clearLeds(c);
    H.press(c, 'press1');
    var led = H.led(c, 'press1');
    t.ok(led.hw > 0, 'press1 should be lit');
});

// ── shift overrides ────────────────────────────────────────
//
// TOP_SHARED_SHIFT maps shifted press cells to:
//   press0 → [selectedDeckA] sync_enabled
//   press1 → [selectedDeckA] keylock
//   press2 → [selectedDeckB] keylock
//   press3 → [selectedDeckB] sync_enabled

test('shift+press0 enables sync_enabled on deck A', function(t) {
    var c = H.bootCat();
    engine._set('[Channel1]', 'sync_enabled', 0);
    H.press(c, 'shift');
    H.press(c, 'press0');
    t.eq(engine.getValue('[Channel1]', 'sync_enabled'), 1);
});

test('shift+press1 enables keylock on deck A', function(t) {
    var c = H.bootCat();
    engine._set('[Channel1]', 'keylock', 0);
    H.press(c, 'shift');
    H.press(c, 'press1');
    t.eq(engine.getValue('[Channel1]', 'keylock'), 1);
});

test('shift+press2 enables keylock on deck B', function(t) {
    var c = H.bootCat();
    var chB = c.selectedDeckB;
    engine._set('[Channel' + chB + ']', 'keylock', 0);
    H.press(c, 'shift');
    H.press(c, 'press2');
    t.eq(engine.getValue('[Channel' + chB + ']', 'keylock'), 1);
});

test('shift+press3 enables sync_enabled on deck B', function(t) {
    var c = H.bootCat();
    var chB = c.selectedDeckB;
    engine._set('[Channel' + chB + ']', 'sync_enabled', 0);
    H.press(c, 'shift');
    H.press(c, 'press3');
    t.eq(engine.getValue('[Channel' + chB + ']', 'sync_enabled'), 1);
});

// ── QFX cycle ──────────────────────────────────────────────

test('encoder1 turns cycle QFX chain preset', function(t) {
    var c = H.bootCat();
    engine._set('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset', 0);
    H.send(c, 'encoder1', 1);
    t.eq(engine.getValue('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset'), 1);
    engine._set('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset', 1);
    H.send(c, 'encoder1', 127);
    t.eq(engine.getValue('[QuickEffectRack1_[Channel1]]', 'loaded_chain_preset'), 0);
});

test('encoder1 follows active deck', function(t) {
    var c = H.bootCat();
    H.press(c, 'press1');
    var chB = c.selectedDeckB;
    engine._set('[QuickEffectRack1_[Channel' + chB + ']]', 'loaded_chain_preset', 0);
    H.send(c, 'encoder1', 1);
    t.eq(engine.getValue('[QuickEffectRack1_[Channel' + chB + ']]', 'loaded_chain_preset'), 1);
});

// ── pre-gain encoder ───────────────────────────────────────

test('encoder0 writes pregain on active deck', function(t) {
    var c = H.bootCat();
    engine._set('[Channel1]', 'pregain', 0.5);
    H.send(c, 'encoder0', 1);
    t.approx(engine.getValue('[Channel1]', 'pregain'), 0.525, 1e-9);
});

// ── key sync / reset ───────────────────────────────────────
//
// Unshifted encoder3 is unbound. Key sync / reset moved to the
// shifted encoders, any-direction:
//   shift + encoder0 → encKeySync  (pulses sync_key on every turn)
//   shift + encoder1 → encKeyReset (pulses reset_key on every turn)

test('shifted encoder0 syncs key on CW', function(t) {
    var c = H.bootCat();
    H.press(c, 'shift');
    engine._set('[Channel1]', 'sync_key', 0);
    H.send(c, 'encoder0', 1);
    t.eq(engine.getValue('[Channel1]', 'sync_key'), 1);
});

test('shifted encoder0 syncs key on CCW too', function(t) {
    var c = H.bootCat();
    H.press(c, 'shift');
    engine._set('[Channel1]', 'sync_key', 0);
    H.send(c, 'encoder0', 127);
    t.eq(engine.getValue('[Channel1]', 'sync_key'), 1);
});

test('shifted encoder1 resets key on CW', function(t) {
    var c = H.bootCat();
    H.press(c, 'shift');
    engine._set('[Channel1]', 'reset_key', 0);
    H.send(c, 'encoder1', 1);
    t.eq(engine.getValue('[Channel1]', 'reset_key'), 1);
});

test('shifted encoder1 resets key on CCW too', function(t) {
    var c = H.bootCat();
    H.press(c, 'shift');
    engine._set('[Channel1]', 'reset_key', 0);
    H.send(c, 'encoder1', 127);
    t.eq(engine.getValue('[Channel1]', 'reset_key'), 1);
});

test('unshifted encoder3 is unbound', function(t) {
    var c = H.bootCat();
    engine._set('[Channel1]', 'sync_key', 0);
    engine._set('[Channel1]', 'reset_key', 0);
    H.send(c, 'encoder3', 1);
    H.send(c, 'encoder3', 127);
    t.eq(engine.getValue('[Channel1]', 'sync_key'), 0);
    t.eq(engine.getValue('[Channel1]', 'reset_key'), 0);
});

// ── QFX enable button ──────────────────────────────────────

test('button1_2 toggles QuickFX enabled', function(t) {
    var c = H.bootCat();
    engine._set('[QuickEffectRack1_[Channel1]]', 'enabled', 0);
    H.press(c, 'button1_2');
    t.eq(engine.getValue('[QuickEffectRack1_[Channel1]]', 'enabled'), 1);
});

// ── faders ─────────────────────────────────────────────────

test('fader0 writes deck volume', function(t) {
    var c = H.bootCat();
    engine._set('[Channel1]', 'volume', 0);
    H.send(c, 'fader0', 64);
    t.approx(engine.getParameter('[Channel1]', 'volume'), 0.5, 1e-9);
});

test('fader1 writes FX mix', function(t) {
    var c = H.bootCat();
    engine._set('[EffectRack1_EffectUnit1]', 'mix', 0);
    H.send(c, 'fader1', 64);
    t.approx(engine.getParameter('[EffectRack1_EffectUnit1]', 'mix'), 0.5, 1e-9);
});

// ── FX route cells ─────────────────────────────────────────

test('button2_2 routes focused FX into active deck', function(t) {
    var c = H.bootCat();
    engine._set('[EffectRack1_EffectUnit1]', 'group_[Channel1]_enable', 0);
    H.press(c, 'button2_2');
    t.eq(engine.getValue('[EffectRack1_EffectUnit1]', 'group_[Channel1]_enable'), 1);
});

test('button0_2 routes alt FX into active deck', function(t) {
    // Force initialFxB=2 so alt (2) differs from active (1).
    var c = H.bootCat({initialFxB: 2});
    engine._set('[EffectRack1_EffectUnit2]', 'group_[Channel1]_enable', 0);
    H.press(c, 'button0_2');
    t.eq(engine.getValue('[EffectRack1_EffectUnit2]', 'group_[Channel1]_enable'), 1);
});

// ── FX headphone ───────────────────────────────────────────

test('button0_1 toggles FX group headphone enable', function(t) {
    var c = H.bootCat();
    engine._set('[EffectRack1_EffectUnit1]', 'group_[Headphone]_enable', 0);
    H.press(c, 'button0_1');
    t.eq(engine.getValue('[EffectRack1_EffectUnit1]', 'group_[Headphone]_enable'), 1);
});

// ── PFL ────────────────────────────────────────────────────

test('button0_0 toggles pfl on active deck', function(t) {
    var c = H.bootCat();
    engine._set('[Channel1]', 'pfl', 0);
    H.press(c, 'button0_0');
    t.eq(engine.getValue('[Channel1]', 'pfl'), 1);
    H.press(c, 'button0_0');
    t.eq(engine.getValue('[Channel1]', 'pfl'), 0);
});

// ── shift release drops overrides ──────────────────────────
//
// While shifted, press1 toggles keylock on deck A (no activeDeck
// change). After shift release, press1 goes back to the base
// binding, setActiveDeckTo('B').

test('shift release restores base press1 binding', function(t) {
    var c = H.bootCat();
    c.setActiveDeck('A');
    H.press(c, 'shift');
    H.press(c, 'press1');   // keylock on Channel1; activeDeck unchanged
    t.eq(c.activeDeck, 'A');
    H.release(c, 'shift');
    H.press(c, 'press1');   // base: setActiveDeckTo('B')
    t.eq(c.activeDeck, 'B');
});

// ── inspect integration ────────────────────────────────────

test('inspect: root prints without error', function(t) {
    var c = H.bootCat();
    _printLog.length = 0;
    c.inspect();
    t.ok(_printLog.length > 0);
});

test('inspect: patches prints patch tree', function(t) {
    var c = H.bootCat();
    _printLog.length = 0;
    c.inspect('patches');
    var joined = _printLog.join('\n');
    t.contains(joined, 'topShared');
    t.contains(joined, 'cue');
});

test('inspect: tokens lists $DECK_ACTIVE$ usage', function(t) {
    var c = H.bootCat();
    _printLog.length = 0;
    c.inspect('tokens');
    var joined = _printLog.join('\n');
    t.contains(joined, '$DECK_ACTIVE$');
});

test('inspect: dark lists unbound cells', function(t) {
    var c = H.bootCat();
    _printLog.length = 0;
    c.inspect('dark');
    t.ok(_printLog.length > 0);
});