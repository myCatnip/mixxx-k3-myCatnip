'use strict';

var H = require('./helpers');

// Rate gate: _inferRateClass, _resolveRateClass, _claimRate,
// per-binding self-check, jump-block, claim floor, the
// out-of-loop bypass, and the Binding.input() dispatch
// integration.
//
// The gate only runs when the binding's target channel has an
// active loop. Without a loop, _claimRate short-circuits and
// leaves _lastLoopChangeMs / _lastRateClaim untouched. Tests
// that assert on gate behaviour must therefore set up a loop.

// Small helper — ensure a binding targets [Channel<ch>] and that
// channel has loop_enabled. Safe to call repeatedly.
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

// ── _inferRateClass ────────────────────────────────────────

test('_inferRateClass: encBeatjump → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encBeatjump}), 'jump');
});

test('_inferRateClass: beatjumpButton → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.beatjumpButton}), 'jump');
});

test('_inferRateClass: reloopToggleResetAnchor → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.reloopToggleResetAnchor}), 'jump');
});

test('_inferRateClass: beatloopActivateResetAnchor → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.beatloopActivateResetAnchor}), 'jump');
});

test('_inferRateClass: encLoopMove → edit', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encLoopMove}), 'edit');
});

test('_inferRateClass: encLoopMoveAccel → edit', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encLoopMoveAccel}), 'edit');
});

test('_inferRateClass: encBeatjumpStepScale → claim', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encBeatjumpStepScale}), 'claim');
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

test('_inferRateClass: inKey beatjump_forward / beatjump_backward → jump', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_forward'}),  'jump');
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_backward'}), 'jump');
});

test('_inferRateClass: inKey beatjump_size does NOT match', function(t) {
    // The classifier must not label a size-set binding as
    // movement. The audit pattern in _validateBindings is
    // deliberately wider; the classifier is exact. See
    // INTERNALS §22 / §25.
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_size'}), null);
});

test('_inferRateClass: inKey beatjump_1_backward does NOT match', function(t) {
    // Only the exact movement COs classify. Numbered variants
    // aren't reachable as direct inKey values in shipped
    // configs — beatjumpButton passes them as args to _pulseCo,
    // not as the binding's inKey.
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_1_backward'}), null);
});

test('_inferRateClass: inKey reloop_toggle → jump', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'reloop_toggle'}), 'jump');
});

test('_inferRateClass: inKey beatloop_activate → jump', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'beatloop_activate'}), 'jump');
});

test('_inferRateClass: unrelated inKey → null', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'play'}),  null);
    t.eq(XoneK3._inferRateClass({inKey: 'pfl'}),   null);
    t.eq(XoneK3._inferRateClass({}),               null);
});

test('_inferRateClass: func identity beats inKey', function(t) {
    t.eq(XoneK3._inferRateClass({
        func: XoneK3.FUNCS.encLoopMove, inKey: 'beatjump_size'
    }), 'edit');
});

// ── _resolveRateClass ──────────────────────────────────────

test('_resolveRateClass: rate false → null', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({rate: false}), null);
});

test('_resolveRateClass: explicit string honoured', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({rate: 'jump'}), 'jump');
    t.eq(c._resolveRateClass({rate: 'edit'}), 'edit');
    t.eq(c._resolveRateClass({rate: 'claim'}), 'claim');
});

test('_resolveRateClass: unknown string warns and returns null', function(t) {
    var c = H.ctrl();
    _printLog.length = 0;
    t.eq(c._resolveRateClass({rate: 'nonsense'}), null);
    t.ok(_printLog.join('\n').indexOf('unknown rate class') !== -1);
});

test('_resolveRateClass: inline object passed through', function(t) {
    var c = H.ctrl();
    var inline = {selfCheckMs: 5, selfScope: 'binding', jumpBlockMs: 30, claimMs: 30};
    t.eq(c._resolveRateClass({rate: inline}), inline);
});

test('_resolveRateClass: no rate → inference', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({func: XoneK3.FUNCS.encBeatjump}), 'jump');
});

test('_resolveRateClass: rate field wins over inference', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({
        func: XoneK3.FUNCS.encLoopMove, rate: 'jump'
    }), 'jump');
});

// ── _bindingInActiveLoop ───────────────────────────────────

test('_bindingInActiveLoop: undefined group → false', function(t) {
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

test('_bindingInActiveLoop: Channel group, loop_enabled → true', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: function() {}, group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    t.eq(c._bindingInActiveLoop(c.bindings.encoderL), true);
});

// ── _claimRate: out-of-loop bypass ─────────────────────────
//
// The gate's purpose is to keep rapid loop moves from
// destabilising an active loop. With no loop there is nothing
// to escape from — every claim passes without touching
// _lastLoopChangeMs, _lastRateClaim, or _lastGateMs.

test('_claimRate bypass: no loop → always returns true', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();          // would gate if we reached the self-check
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate bypass: no loop → _lastLoopChangeMs untouched', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'edit');
    t.eq(c._lastLoopChangeMs, 0,
         'bypass must not claim on the shared clock');
});

test('_claimRate bypass: no loop → _lastRateClaim untouched', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    c._lastRateClaim = null;
    c._claimRate(b, 'edit');
    t.eq(c._lastRateClaim, null,
         'bypass must not set _lastRateClaim');
});

test('_claimRate bypass: no loop → _rateAccepted increments', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._rateAccepted = 0;
    c._claimRate(b, 'edit');
    t.eq(b._rateAccepted, 1,
         'bypass still records the accepted event for diagnostics');
});

test('_claimRate bypass: no loop → _rateGated does not increment', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._rateGated = 0;
    b._lastGateMs = Date.now();          // would gate if we reached the self-check
    c._claimRate(b, 'edit');
    t.eq(b._rateGated, 0,
         'bypass is not a gate');
});

test('_claimRate bypass: no loop → _lastGateMs untouched', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = 0;
    c._claimRate(b, 'edit');
    t.eq(b._lastGateMs, 0,
         'bypass must not self-stamp');
});

// ── _claimRate: self-check (with active loop) ──────────────

test('_claimRate: first claim always succeeds', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._rateClass = 'edit';
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate: second claim within selfCheckMs blocked', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._lastGateMs = Date.now();
    t.notOk(c._claimRate(b, 'edit'));
});

test('_claimRate: second claim after selfCheckMs passes', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._lastGateMs = Date.now() - 100;
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate: jump has no self-check', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._lastGateMs = Date.now();
    t.ok(c._claimRate(b, 'jump'));
});

test('_claimRate: claim writes b._lastGateMs', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._lastGateMs = 0;
    c._claimRate(b, 'edit');
    t.ok(b._lastGateMs > 0);
});

// ── _claimRate: jump-block (with active loop) ──────────────

test('_claimRate: jump-blocked right after another jump', function(t) {
    var c = H.ctrl();
    var b1 = armGate(c, 'encoderL', 1);
    var b2 = armGate(c, 'encoderR', 1);
    c._claimRate(b1, 'jump');
    t.notOk(c._claimRate(b2, 'jump'));
});

test('_claimRate: edit allowed right after jump (60 < 120)', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderR', 1);
    c._lastLoopChangeMs = Date.now() - 70;
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate: edit blocked inside jump window', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderR', 1);
    c._lastLoopChangeMs = Date.now() - 30;
    t.notOk(c._claimRate(b, 'edit'));
});

test('_claimRate: claim class has no jump-block', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    c._lastLoopChangeMs = Date.now();
    t.ok(c._claimRate(b, 'claim'));
});

// ── _claimRate: claim floor composition (with active loop) ─

test('_claimRate: edit claim leaves 60ms tail on jump clock', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'edit');
    var age = Date.now() - c._lastLoopChangeMs;
    t.ok(age >= 55 && age <= 65, 'age=' + age);
});

test('_claimRate: jump claim leaves 120ms tail', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'jump');
    var age = Date.now() - c._lastLoopChangeMs;
    t.ok(age <= 2, 'age=' + age);
});

test('_claimRate: claim class leaves 60ms tail', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'claim');
    var age = Date.now() - c._lastLoopChangeMs;
    t.ok(age >= 55 && age <= 65, 'age=' + age);
});

test('_claimRate: claim never moves clock backwards', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    c._claimRate(b, 'jump');
    var firstTs = c._lastLoopChangeMs;
    c._claimRate(b, 'edit');
    t.ok(c._lastLoopChangeMs >= firstTs);
});

// ── _claimRate: diagnostics ────────────────────────────────

test('_claimRate: accepted increments counter', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._rateAccepted = 0;
    c._claimRate(b, 'edit');
    t.eq(b._rateAccepted, 1);
});

test('_claimRate: gated increments counter', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    b._lastGateMs = Date.now();
    b._rateGated = 0;
    c._claimRate(b, 'edit');
    t.eq(b._rateGated, 1);
});

test('_claimRate: sets controller _lastRateClaim', function(t) {
    var c = H.ctrl();
    var b = armGate(c, 'encoderL', 1);
    c._claimRate(b, 'edit');
    t.eq(c._lastRateClaim.binding, 'encoderL');
    t.eq(c._lastRateClaim.className, 'edit');
});

test('_claimRate: no rate class → always passes', function(t) {
    var c = H.ctrl();
    var b = c.bindings.button0_0;
    t.ok(c._claimRate(b, null));
});

// ── Binding.input() integration ────────────────────────────

test('input: gated event does not fire func', function(t) {
    var c = H.ctrl();
    var fired = 0;
    c._applyBinding('encoderL', {
        func: function() { fired++; },
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    H.send(c, 'encoderL', 1);
    t.eq(fired, 0);
});

test('input: gated event still updates _normalized (knob)', function(t) {
    var c = H.ctrl();
    c._applyBinding('knob0_0', {
        func: function() {},
        group: '[Channel1]', inKey: 'volume'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.knob0_0;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    H.send(c, 'knob0_0', 64);
    t.ok(b._normalized !== undefined);
});

test('input: gated event still repaints observers', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: function() {},
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();

    var fired = 0;
    b.addObserver({_refresh: function() { fired++; }});
    H.send(c, 'encoderL', 1);
    t.eq(fired, 1);
});

test('input: out-of-loop encoder is not gated', function(t) {
    var c = H.ctrl();
    var fired = 0;
    c._applyBinding('encoderL', {
        func: function() { fired++; },
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    // no loop_enabled — bypass
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();          // would gate inside a loop
    H.send(c, 'encoderL', 1);
    t.eq(fired, 1,
         'out-of-loop bypass must let the func fire');
});

test('input: button release is never gated', function(t) {
    var c = H.ctrl();
    var pressCount = 0, releaseCount = 0;
    c._applyBinding('pressL', {
        func: function(args, ch, cc, v) {
            if (v > 0) pressCount++;
            else       releaseCount++;
        },
        group: '[Channel1]', inKey: 'beatjump_forward'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.pressL;
    b._rateClass = 'jump';
    c._lastLoopChangeMs = Date.now();    // block jumps

    H.press(c, 'pressL');
    t.eq(pressCount, 0);                 // gated
    t.eq(releaseCount, 0);

    H.release(c, 'pressL');
    t.eq(pressCount, 0);                 // still gated (no press fired)
    t.eq(releaseCount, 1);               // release always dispatches
});

test('input: encoder CCW is gated same as CW', function(t) {
    var c = H.ctrl();
    var fired = 0;
    c._applyBinding('encoderL', {
        func: function() { fired++; },
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    engine._set('[Channel1]', 'loop_enabled', 1);
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    H.send(c, 'encoderL', 127);
    t.eq(fired, 0);
}); 