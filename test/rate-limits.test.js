'use strict';

var H = require('./helpers');

// Rate gating is external — Binding.input() calls ctrl._claimRate()
// before the func dispatches. The class comes from RATE_CLASSES,
// either declared on the binding (`rate:`) or inferred by
// XoneK3._inferRateClass from cfg.func / cfg.inKey.
//
// The gate only runs when the binding's target channel has an
// active loop. Without a loop, _claimRate short-circuits and
// leaves _lastLoopChangeMs / _lastRateClaim untouched — with
// nothing to escape from, there is nothing to protect.

// Small helper — arm the gate on a channel-bound binding.
function armGate(c, name, ch) {
    ch = ch || 1;
    c._applyBinding(name, {
        func: function() {},
        group: '[Channel' + ch + ']',
        inKey: 'beatloop_size'
    });
    engine._set('[Channel' + ch + ']', 'loop_enabled', 1);
    return c.bindings[name];
}

// ── _inferRateClass ─────────────────────────────────────────

test('_inferRateClass: encBeatjump → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.encBeatjump }), 'jump');
});

test('_inferRateClass: beatjumpButton → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.beatjumpButton }), 'jump');
});

test('_inferRateClass: reloopToggleResetAnchor → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.reloopToggleResetAnchor }), 'jump');
});

test('_inferRateClass: beatloopActivateResetAnchor → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.beatloopActivateResetAnchor }), 'jump');
});

test('_inferRateClass: encLoopMove → edit', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.encLoopMove }), 'edit');
});

test('_inferRateClass: encLoopMoveAccel → edit', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.encLoopMoveAccel }), 'edit');
});

test('_inferRateClass: encBeatjumpStepScale → claim', function(t) {
    t.eq(XoneK3._inferRateClass({ func: XoneK3.FUNCS.encBeatjumpStepScale }), 'claim');
});

test('_inferRateClass: pressSetValue + beatloop_size → edit', function(t) {
    t.eq(XoneK3._inferRateClass({
        func: XoneK3.FUNCS.pressSetValue, inKey: 'beatloop_size'
    }), 'edit');
});

test('_inferRateClass: pressSetValue + beatjump_size → claim', function(t) {
    t.eq(XoneK3._inferRateClass({
        func: XoneK3.FUNCS.pressSetValue, inKey: 'beatjump_size'
    }), 'claim');
});

test('_inferRateClass: inKey beatjump_forward → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ inKey: 'beatjump_forward' }), 'jump');
});

test('_inferRateClass: inKey beatjump_size does NOT match', function(t) {
    t.eq(XoneK3._inferRateClass({ inKey: 'beatjump_size' }), null);
});

test('_inferRateClass: reloop_toggle inKey → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ inKey: 'reloop_toggle' }), 'jump');
});

test('_inferRateClass: beatloop_activate inKey → jump', function(t) {
    t.eq(XoneK3._inferRateClass({ inKey: 'beatloop_activate' }), 'jump');
});

test('_inferRateClass: unrelated → null', function(t) {
    t.eq(XoneK3._inferRateClass({ inKey: 'volume' }), null);
});

test('_inferRateClass: custom func + loop inKey → null (unclassified)', function(t) {
    // The audit warns on this at boot; the classifier itself
    // returns null.
    var custom = function() {};
    t.eq(XoneK3._inferRateClass({ func: custom, inKey: 'beatloop_size' }), null);
});

// ── _resolveRateClass ───────────────────────────────────────

test('_resolveRateClass: rate: false → null', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({ rate: false }), null);
});

test('_resolveRateClass: string lookup', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({ rate: 'jump' }), 'jump');
});

test('_resolveRateClass: unknown string → null + warn', function(t) {
    var c = H.ctrl();
    XoneK3._warned = {};
    t.eq(c._resolveRateClass({ rate: 'nope' }), null);
    t.ok(XoneK3._warned['rateUnknown:nope']);
});

test('_resolveRateClass: inline object passthrough', function(t) {
    var c = H.ctrl();
    var spec = { selfCheckMs: 5, jumpBlockMs: 50, claimMs: 50 };
    t.eq(c._resolveRateClass({ rate: spec }), spec);
});

test('_resolveRateClass: inferred from func when rate: absent', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({ func: XoneK3.FUNCS.encBeatjump }), 'jump');
});

// ── _bindingInActiveLoop ────────────────────────────────────

test('_bindingInActiveLoop: no group → false', function(t) {
    var c = H.ctrl();
    t.eq(c._bindingInActiveLoop(c.bindings.encoderL), false);
});

test('_bindingInActiveLoop: non-Channel group → false', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: function() {}, group: '[Master]', inKey: 'gain'
    });
    t.eq(c._bindingInActiveLoop(c.bindings.encoderL), false);
});

test('_bindingInActiveLoop: Channel group, no loop → false', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: function() {}, group: '[Channel1]', inKey: 'beatloop_size'
    });
    t.eq(c._bindingInActiveLoop(c.bindings.encoderL), false);
});

test('_bindingInActiveLoop: Channel group, loop on → true', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: function() {}, group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    t.eq(c._bindingInActiveLoop(c.bindings.encoderL), true);
});

// ── _claimRate: out-of-loop bypass ──────────────────────────

test('_claimRate bypass: no loop → returns true even with a recent self-stamp', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    t.eq(c._claimRate(b, 'edit'), true);
});

test('_claimRate bypass: no loop → shared clock untouched', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'edit');
    t.eq(c._lastLoopChangeMs, 0);
});

test('_claimRate bypass: no loop → _lastRateClaim untouched', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    c._lastRateClaim = null;
    c._claimRate(b, 'edit');
    t.eq(c._lastRateClaim, null);
});

test('_claimRate bypass: no loop → accepted counter still increments', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._rateAccepted = 0;
    c._claimRate(b, 'edit');
    t.eq(b._rateAccepted, 1);
});

test('_claimRate bypass: no loop → gated counter untouched', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._rateGated = 0;
    b._lastGateMs = Date.now();
    c._claimRate(b, 'edit');
    t.eq(b._rateGated, 0);
});

// ── _claimRate (with active loop) ───────────────────────────

test('_claimRate: first call always succeeds', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.beatjumpButton,
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;
    t.eq(c._claimRate(b, b._rateClass), true);
});

test('_claimRate: jump-class blocks within jumpBlockMs of the shared clock', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.beatjumpButton,
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;

    c._lastLoopChangeMs = Date.now();
    t.eq(c._claimRate(b, b._rateClass), false);
});

test('_claimRate: jump-class passes after jumpBlockMs', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.beatjumpButton,
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;

    c._lastLoopChangeMs = Date.now() - 200;   // > 120
    t.eq(c._claimRate(b, b._rateClass), true);
});

test('_claimRate: jump claim forward-sets the shared clock', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.beatjumpButton,
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;

    var before = Date.now();
    c._claimRate(b, b._rateClass);
    var after = Date.now();

    // jump.claimMs === 120, so floor === now.
    t.ok(c._lastLoopChangeMs >= before && c._lastLoopChangeMs <= after + 5,
         'shared clock should be forward-set to roughly now');
});

test('_claimRate: edit self-gates within selfCheckMs', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMove, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.encoderL;

    t.eq(c._claimRate(b, b._rateClass), true,
         'first edit should pass');
    t.eq(c._claimRate(b, b._rateClass), false,
         'second immediate edit should self-gate');
});

test('_claimRate: edit passes after selfCheckMs elapses', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMove, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.encoderL;

    c._claimRate(b, b._rateClass);
    b._lastGateMs = Date.now() - 20;         // > selfCheckMs (10)
    c._lastLoopChangeMs = Date.now() - 200;  // > jumpBlockMs (60)

    t.eq(c._claimRate(b, b._rateClass), true);
});

test('_claimRate: edit blocked by recent jump on the shared clock', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: XoneK3.FUNCS.encLoopMove, args: ['in', 0.01],
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.encoderL;

    c._lastLoopChangeMs = Date.now();   // just claimed by a jump
    t.eq(c._claimRate(b, b._rateClass), false);
});

test('_claimRate: free class never gates', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        rate: 'free', group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;

    c._lastLoopChangeMs = Date.now();
    t.eq(c._claimRate(b, b._rateClass), true);
});

test('_claimRate: records accepted/gated counters', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.beatjumpButton,
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;

    c._claimRate(b, b._rateClass);          // accepted
    c._lastLoopChangeMs = Date.now();
    c._claimRate(b, b._rateClass);          // gated

    t.eq(b._rateAccepted, 1);
    t.eq(b._rateGated, 1);
});

// ── Binding.input gate ──────────────────────────────────────

test('Binding.input: gated event never reaches the func', function(t) {
    var c = H.ctrl();
    var calls = 0;
    c._applyBinding('pressL', {
        func: function() { calls++; },
        group: '[Channel1]', inKey: 'beatjump_forward',
        rate: { selfCheckMs: 0, jumpBlockMs: 100, claimMs: 100 }
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    c._lastLoopChangeMs = Date.now();   // block the gate
    H.press(c, 'pressL');

    t.eq(calls, 0, 'gated event must not dispatch the func');
});

test('Binding.input: accepted event reaches the func', function(t) {
    var c = H.ctrl();
    var calls = 0;
    c._applyBinding('pressL', {
        func: function() { calls++; },
        group: '[Channel1]', inKey: 'beatjump_forward',
        rate: { selfCheckMs: 0, jumpBlockMs: 100, claimMs: 100 }
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    c._lastLoopChangeMs = Date.now() - 500;
    H.press(c, 'pressL');

    t.eq(calls, 1);
});

test('Binding.input: out-of-loop event reaches the func regardless of shared clock', function(t) {
    var c = H.ctrl();
    var calls = 0;
    c._applyBinding('pressL', {
        func: function() { calls++; },
        group: '[Channel1]', inKey: 'beatjump_forward',
        rate: { selfCheckMs: 0, jumpBlockMs: 100, claimMs: 100 }
    });
    // no loop_enabled — bypass
    c._lastLoopChangeMs = Date.now();   // would gate if loop were active
    H.press(c, 'pressL');

    t.eq(calls, 1, 'out-of-loop bypass must let the func fire');
});

test('Binding.input: release is not gated (only action edge)', function(t) {
    var c = H.ctrl();
    var calls = 0;
    c._applyBinding('pressL', {
        func: function() { calls++; },
        group: '[Channel1]', inKey: 'beatjump_forward',
        rate: { selfCheckMs: 0, jumpBlockMs: 100, claimMs: 100 }
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    c._lastLoopChangeMs = Date.now();   // gate would block

    H.press(c, 'pressL');
    t.eq(calls, 0, 'press should be gated');

    H.release(c, 'pressL');
    t.eq(calls, 1, 'release must not be gated');
});

test('Binding.input: rate: false skips the gate entirely', function(t) {
    var c = H.ctrl();
    var calls = 0;
    c._applyBinding('pressL', {
        func: function() { calls++; },
        group: '[Channel1]', inKey: 'beatloop_size',
        rate: false
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    c._lastLoopChangeMs = Date.now();
    H.press(c, 'pressL');

    t.eq(calls, 1, 'rate: false must not be gated');
});

// ── Diagnostics ─────────────────────────────────────────────

test('_claimRate: records last claim', function(t) {
    var c = H.ctrl();
    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.beatjumpButton,
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;

    c._claimRate(b, b._rateClass);
    t.eq(c._lastRateClaim.binding, 'pressL');
    t.eq(c._lastRateClaim.className, 'jump');
});

// ── Escape detector window ─────────────────────────────────

test('ESCAPE_DETECT_WINDOW_MS matches jump.jumpBlockMs', function(t) {
    t.eq(XoneK3.ESCAPE_DETECT_WINDOW_MS, XoneK3.RATE_CLASSES.jump.jumpBlockMs,
         'window must derive from the jump block window — after it ' +
         'expires the next action could have fired, so later loop ' +
         'deaths are not attributable to the claim');
});

test('ESCAPE_DETECT_WINDOW_MS is 120 (jump.jumpBlockMs default)', function(t) {
    t.eq(XoneK3.ESCAPE_DETECT_WINDOW_MS, 120);
});